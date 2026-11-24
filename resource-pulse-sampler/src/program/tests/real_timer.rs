//! A real 1 s timer through `--print`'s own outlet, and what it does once its reader goes away.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use super::*;
use crate::program::ending::LoopEnd;
use crate::real_ports::{SystemClock, SystemWallClock};

/// The real timer row's interval, run length, wait after the stop, and fewest Samples while it runs
/// (the first at once, then at least one each second): the numbers the gjs row used.
const REAL_TIMER_INTERVAL_USEC: u64 = SECOND_USEC;
const REAL_TIMER_RUN: Duration = Duration::from_millis(2_500);
const AFTER_STOP_WAIT: Duration = Duration::from_millis(1_500);
const MIN_SAMPLES_WHILE_REAL_TIMER_RUNS: usize = 2;
/// The writes the loop may try after the stop: the one that finds the reader gone, and no more.
const WRITE_ATTEMPTS_AFTER_STOP: usize = 1;

/// Standard output as the real timer row sees it: each flushed line is recorded with its time, until
/// the row stops it; from then on every write fails as a closed pipe does, and is counted, so the
/// row sees what the loop tried after the stop.
#[derive(Clone)]
struct StoppableOutput {
    line_times: Arc<Mutex<Vec<Instant>>>,
    is_stopped: Arc<AtomicBool>,
    write_attempts_after_stop: Arc<AtomicUsize>,
    unflushed_bytes: usize,
}

impl Write for StoppableOutput {
    /// Takes the bytes, or, once stopped, counts the attempt and fails as a closed pipe.
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.is_stopped.load(Ordering::SeqCst) {
            self.write_attempts_after_stop
                .fetch_add(1, Ordering::SeqCst);
            return Err(io::Error::from(io::ErrorKind::BrokenPipe));
        }
        self.unflushed_bytes += bytes.len();
        Ok(bytes.len())
    }

    /// Records one line for what was written since the last flush.
    fn flush(&mut self) -> io::Result<()> {
        if self.unflushed_bytes > 0 {
            self.line_times.lock().unwrap().push(Instant::now());
            self.unflushed_bytes = 0;
        }
        Ok(())
    }
}

///
/// `--print`'s own outlet on the real clocks, ticking each second. The gjs row had two halves:
/// within 2.5 s at least two Samples (the first at once); and after the stop (the reader going
/// away, which the loop learns at its next write) none for 1.5 s: the loop makes exactly one
/// attempt, the one that finds the output closed, and has ended by the end of the wait. A loop that
/// went on ticking, or tried again, would make more than one.
#[test]
fn a_real_1_s_timer_sends_samples_and_none_for_1_5_s_after_it_is_stopped() {
    let output = StoppableOutput {
        line_times: Arc::new(Mutex::new(Vec::new())),
        is_stopped: Arc::new(AtomicBool::new(false)),
        write_attempts_after_stop: Arc::new(AtomicUsize::new(0)),
        unflushed_bytes: 0,
    };
    let loop_output = output.clone();
    let loop_thread = thread::spawn(move || {
        let settings = SamplerSettings {
            fs_root: fixture_root("root-a"),
            tick_interval_usec: REAL_TIMER_INTERVAL_USEC,
        };
        let mut service = SamplerService::new(
            Sampler::new(
                settings.fs_root.clone(),
                SamplerPorts {
                    reader: Box::new(FileSystemReader),
                    lister: Box::new(FileSystemLister),
                    clock: Box::new(SystemClock),
                    resolve_app_name: Box::new(|_| None),
                    log: Box::new(|_| {}),
                },
            ),
            Box::new(SystemClock),
            Box::new(SystemWallClock),
            Box::new(|_| {}),
        );
        let mut outlet = PrintOutlet {
            output: loop_output,
        };
        service.initialize();
        let loop_end = run_tick_loop(&mut service, settings.tick_interval_usec, &mut outlet);
        matches!(loop_end, LoopEnd::OutputFailed(error) if error.kind() == io::ErrorKind::BrokenPipe)
    });
    thread::sleep(REAL_TIMER_RUN);
    output.is_stopped.store(true, Ordering::SeqCst);
    let samples_at_stop = output.line_times.lock().unwrap().len();
    thread::sleep(AFTER_STOP_WAIT);
    let attempts_after_stop = output.write_attempts_after_stop.load(Ordering::SeqCst);
    let has_loop_ended = loop_thread.is_finished();
    // A loop still running is left to the end of the test process, never joined: joining it would
    // make this row hang instead of fail.
    let did_end_on_closed_output = has_loop_ended && loop_thread.join().unwrap();
    assert!(
        samples_at_stop >= MIN_SAMPLES_WHILE_REAL_TIMER_RUNS
            && attempts_after_stop == WRITE_ATTEMPTS_AFTER_STOP
            && has_loop_ended
            && did_end_on_closed_output,
        "{samples_at_stop} Samples while running, {attempts_after_stop} write attempts after the \
         stop, ended {has_loop_ended}, on a closed output {did_end_on_closed_output}"
    );
}
