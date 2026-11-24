//! The tick loop both modes share, and its two outlets: the bus's, and `--print`'s stdout.

use std::io::{self, Write};
use std::ops::ControlFlow;
use std::thread;
use std::time::Duration;

use crate::bus::{BusEvent, StreamEnd};
use crate::log_line::{write_log_line, LinePriority};
use crate::tick_schedule::next_tick_at_usec;
use crate::watchdog::Notification;

use super::calls::{
    answer_call, answer_failed_message, drop_vanished_caller, send_sample, ProgramBus,
};
use super::ending::{serving_line, LoopEnd};
use super::sampler_service::SamplerService;
use super::{BUS_LINK_FAILURE_LOG_KEY, WATCHDOG_FAILURE_LOG_KEY};

/// Where the tick loop sends each tick's Sample and what it does while it waits: the bus, or
/// `--print`'s stdout.
pub(super) trait TickLoopOutlet {
    /// After the first tick, sampling has started (the bus says it is serving).
    fn after_first_tick(&mut self);
    /// Sends a tick's Sample, when the tick made one; the bus's outlet also tells systemd the
    /// program is alive.
    fn finish_tick(
        &mut self,
        service: &mut SamplerService,
        sample_text: Option<&str>,
    ) -> ControlFlow<LoopEnd>;
    /// Waits up to `wait` for anything else to do (a call to answer), and does it.
    fn wait_for_work(
        &mut self,
        service: &mut SamplerService,
        wait: Duration,
    ) -> ControlFlow<LoopEnd>;
}

/// The tick loop, shared by both modes, for a service whose sampler is initialized already: the first
/// tick at once, then a tick on each whole interval after it, doing the outlet's work in between,
/// until the outlet ends it. A tick that runs late is followed by the next slot of the first tick's
/// grid, and slots missed in a stall are skipped.
pub(super) fn run_tick_loop(
    service: &mut SamplerService,
    tick_interval_usec: u64,
    outlet: &mut dyn TickLoopOutlet,
) -> LoopEnd {
    let first_tick_at_usec = service.monotonic_usec();
    if let ControlFlow::Break(loop_end) = run_one_tick(service, outlet) {
        return loop_end;
    }
    outlet.after_first_tick();
    loop {
        let next_tick_at = next_tick_at_usec(
            first_tick_at_usec,
            tick_interval_usec,
            service.monotonic_usec(),
        );
        if let ControlFlow::Break(loop_end) = work_until(service, outlet, next_tick_at) {
            return loop_end;
        }
        if let ControlFlow::Break(loop_end) = run_one_tick(service, outlet) {
            return loop_end;
        }
    }
}

/// Runs one tick and hands its Sample to the outlet.
pub(super) fn run_one_tick(
    service: &mut SamplerService,
    outlet: &mut dyn TickLoopOutlet,
) -> ControlFlow<LoopEnd> {
    let sample_text = service.run_tick();
    outlet.finish_tick(service, sample_text.as_deref())
}

/// Does the outlet's work until the monotonic clock reaches `tick_at_usec`.
pub(super) fn work_until(
    service: &mut SamplerService,
    outlet: &mut dyn TickLoopOutlet,
    tick_at_usec: u64,
) -> ControlFlow<LoopEnd> {
    loop {
        let remaining_usec = tick_at_usec.saturating_sub(service.monotonic_usec());
        if remaining_usec == 0 {
            return ControlFlow::Continue(());
        }
        outlet.wait_for_work(service, Duration::from_micros(remaining_usec))?;
    }
}

/// `--print`'s outlet: each Sample a line, flushed at once; it waits by sleeping.
pub(super) struct PrintOutlet<Output: Write> {
    pub(super) output: Output,
}

impl<Output: Write> TickLoopOutlet for PrintOutlet<Output> {
    /// Nothing to say: `--print` serves nobody.
    fn after_first_tick(&mut self) {}

    /// Writes the Sample as one line; a write that fails ends the loop.
    fn finish_tick(
        &mut self,
        _service: &mut SamplerService,
        sample_text: Option<&str>,
    ) -> ControlFlow<LoopEnd> {
        let Some(sample_text) = sample_text else {
            return ControlFlow::Continue(());
        };
        let written = writeln!(self.output, "{sample_text}").and_then(|()| self.output.flush());
        match written {
            Ok(()) => ControlFlow::Continue(()),
            Err(error) => ControlFlow::Break(LoopEnd::OutputFailed(error)),
        }
    }

    /// Sleeps: there are no calls to answer.
    fn wait_for_work(
        &mut self,
        _service: &mut SamplerService,
        wait: Duration,
    ) -> ControlFlow<LoopEnd> {
        thread::sleep(wait);
        ControlFlow::Continue(())
    }
}

/// Tells systemd the program is alive: [`notify_alive`](crate::watchdog::notify_alive) in the program; the rows count the calls.
pub(super) type NotifyWatchdog = Box<dyn FnMut() -> io::Result<Notification>>;

/// The bus's outlet: Samples as signals, the watchdog on each tick, and calls and vanished callers
/// handled between ticks.
pub(super) struct BusOutlet<Bus: ProgramBus> {
    pub(super) bus: Bus,
    pub(super) notify_watchdog: NotifyWatchdog,
}

impl<Bus: ProgramBus> TickLoopOutlet for BusOutlet<Bus> {
    /// The "serving" line (the gjs service's, word for word), once the name is owned and the first
    /// tick has run: routine.
    fn after_first_tick(&mut self) {
        write_log_line(LinePriority::Info, &serving_line());
    }

    /// Sends the tick's Sample, then tells systemd the program is alive, whatever the tick did.
    fn finish_tick(
        &mut self,
        service: &mut SamplerService,
        sample_text: Option<&str>,
    ) -> ControlFlow<LoopEnd> {
        if let Some(sample_text) = sample_text {
            send_sample(&self.bus, service, sample_text);
        }
        if let Err(error) = (self.notify_watchdog)() {
            service.log_failure(
                &format!("cannot notify the watchdog: {error}"),
                WATCHDOG_FAILURE_LOG_KEY,
            );
        }
        ControlFlow::Continue(())
    }

    /// Handles one bus event, or none if `wait` passes first; the bus going away ends the loop.
    fn wait_for_work(
        &mut self,
        service: &mut SamplerService,
        wait: Duration,
    ) -> ControlFlow<LoopEnd> {
        match self.bus.next_event(wait) {
            Ok(None) => {}
            Ok(Some(BusEvent::Call(call))) => answer_call(&self.bus, service, &call),
            Ok(Some(BusEvent::NameVanished(unique_name))) => {
                drop_vanished_caller(&self.bus, service, &unique_name);
            }
            Ok(Some(BusEvent::MessageFailed(failure))) => {
                answer_failed_message(&self.bus, service, failure);
            }
            Ok(Some(BusEvent::Disconnected(stream_end))) => {
                return ControlFlow::Break(loop_end_of_stream_end(stream_end));
            }
            Ok(Some(BusEvent::ReceivingThreadEnded)) => {
                return ControlFlow::Break(LoopEnd::ReceivingThreadEnded);
            }
            Err(error) => service.log_failure(&format!("bus: {error}"), BUS_LINK_FAILURE_LOG_KEY),
        }
        ControlFlow::Continue(())
    }
}

/// How the loop ends when the stream of bus messages ended: the bus going away when its connection
/// closed, else a failed stream, with the error's kind when an error ended it.
pub(super) fn loop_end_of_stream_end(stream_end: StreamEnd) -> LoopEnd {
    match stream_end {
        StreamEnd::ConnectionClosed => LoopEnd::BusGone,
        StreamEnd::Failed(error_kind) => LoopEnd::BusStreamFailed(Some(error_kind)),
        StreamEnd::EndedWithoutClose => LoopEnd::BusStreamFailed(None),
    }
}
