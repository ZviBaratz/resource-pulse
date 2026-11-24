//! What the tick loop works on: the sampler, its face on the bus, the clocks and the program's log.

use std::path::{Path, PathBuf};

use crate::caught_panic::catching_panic;
use crate::desktop_names::DesktopNameLookup;
use crate::log_line::write_log_line;
use crate::ports::{Clock, WallClock};
use crate::rate_limited_log::RateLimitedLog;
use crate::real_ports::{FileSystemLister, FileSystemReader, SystemClock, SystemWallClock};
use crate::sampler::{Publish, Sampler, SamplerPorts};
use crate::service::ServiceFace;

use super::{
    failure_log_writer, WriteLogLine, HOME_VARIABLE, INITIALIZE_FAILURE_LOG_KEY,
    TICK_FAILURE_LOG_KEY,
};

/// Everything the tick loop works on, in either mode: the sampler, its face on the bus, the clocks,
/// and the program's own log (what were the gjs service's sampler, and its D-Bus face's bookkeeping
/// and logger).
pub(super) struct SamplerService {
    pub(super) sampler: Sampler,
    pub(super) face: ServiceFace,
    /// Monotonic time, for the tick schedule and the log's rate limit.
    clock: Box<dyn Clock>,
    /// Real time, for each Sample's `sampledAtUsec`.
    wall_clock: Box<dyn WallClock>,
    /// The program's own failures: a tick or a call that panicked, a send, the watchdog.
    error_log: RateLimitedLog,
    /// How many ticks have run: the next tick's number.
    pub(super) ticks_run: u64,
    /// Whether any watch is held, as the sampler last took it (`_isDetailWatchedForSampler`):
    /// recorded only once `set_detail_watched` returned.
    is_detail_watched_for_sampler: bool,
}

impl SamplerService {
    /// A service for `sampler`, started now by `wall_clock`; the program's failures go to
    /// `log_writer`, rate-limited.
    pub(super) fn new(
        sampler: Sampler,
        clock: Box<dyn Clock>,
        wall_clock: Box<dyn WallClock>,
        log_writer: Box<dyn FnMut(&str)>,
    ) -> SamplerService {
        let service_started_at_usec = wall_clock.real_usec();
        SamplerService {
            sampler,
            face: ServiceFace::new(service_started_at_usec),
            clock,
            wall_clock,
            error_log: RateLimitedLog::new(log_writer),
            ticks_run: 0,
            is_detail_watched_for_sampler: false,
        }
    }

    /// The program's service: the real ports and clocks, app names from the `.desktop` files the
    /// environment points at, and every failure log line on stderr, as a warning.
    pub(super) fn with_real_ports(fs_root: &Path) -> SamplerService {
        let environment = |name: &str| std::env::var(name).ok();
        SamplerService::with_real_ports_writing_to(
            fs_root,
            desktop_name_lookup(&environment),
            write_log_line,
        )
    }

    /// The service over `fs_root` with the real ports and clocks, app names from `name_lookup`, and
    /// each line of the sampler's and the program's failure logs handed to `write_line` as a
    /// warning: [`write_log_line`] in the program; a row records them.
    pub(super) fn with_real_ports_writing_to(
        fs_root: &Path,
        name_lookup: DesktopNameLookup,
        write_line: WriteLogLine,
    ) -> SamplerService {
        let ports = real_sampler_ports(name_lookup, write_line);
        let sampler = Sampler::new(fs_root.to_path_buf(), ports);
        SamplerService::new(
            sampler,
            Box::new(SystemClock),
            Box::new(SystemWallClock),
            failure_log_writer(write_line),
        )
    }

    /// Monotonic microseconds now.
    pub(super) fn monotonic_usec(&self) -> u64 {
        self.clock.monotonic_usec()
    }

    /// Logs a failure of the program's own, at most once per ten minutes for its key.
    pub(super) fn log_failure(&mut self, message: &str, template_key: &str) {
        self.error_log
            .log(self.clock.as_ref(), message, template_key);
    }

    /// The sampler's `initialize`, inside a catch.
    pub(super) fn initialize(&mut self) {
        let sampler = &mut self.sampler;
        if let Err(panic_text) = catching_panic(|| sampler.initialize()) {
            self.log_failure(
                &format!("initialize failed: {panic_text}"),
                INITIALIZE_FAILURE_LOG_KEY,
            );
        }
    }

    /// One tick, inside a catch (`_runNextTick`): the tick's number is taken first, so a tick that
    /// panics still counts, and the Sample's text is returned, numbered by the face. A panic is
    /// logged under "tick failed", and the tick sends nothing.
    pub(super) fn run_tick(&mut self) -> Option<String> {
        let tick_number = self.ticks_run;
        self.ticks_run = self.ticks_run.saturating_add(1);
        let (sampler, face, wall_clock) = (&mut self.sampler, &mut self.face, &self.wall_clock);
        let ticked = catching_panic(|| {
            let publish = sampler.run_tick(tick_number);
            face.next_sample(&publish, wall_clock.real_usec())
        });
        match ticked {
            Ok(sample_text) => Some(sample_text),
            Err(panic_text) => {
                self.log_failure(&format!("tick failed: {panic_text}"), TICK_FAILURE_LOG_KEY);
                None
            }
        }
    }

    /// Tells the sampler whether any watch is held, when that differs from what it last took
    /// (`_tellSamplerIfWatchedChanged`), and returns the Sample of the reveal a starting watch
    /// publishes, numbered by the face. What it took is recorded only once `set_detail_watched`
    /// returned, so a call that panicked is made again at the next change of a count.
    pub(super) fn tell_sampler_if_watched_changed(&mut self) -> Option<String> {
        self.tell_sampler_through_if_watched_changed(Sampler::set_detail_watched)
    }

    /// [`SamplerService::tell_sampler_if_watched_changed`], telling the sampler through
    /// `set_detail_watched`: the step is a parameter, as `drop_watches_inside_catch`'s is, so that a
    /// row can make it panic (the sampler's own never panics outward).
    pub(super) fn tell_sampler_through_if_watched_changed(
        &mut self,
        set_detail_watched: impl FnOnce(&mut Sampler, bool) -> Option<Publish>,
    ) -> Option<String> {
        let is_detail_watched = self.face.detail_watch_count() > 0;
        if is_detail_watched == self.is_detail_watched_for_sampler {
            return None;
        }
        let reveal = set_detail_watched(&mut self.sampler, is_detail_watched);
        self.is_detail_watched_for_sampler = is_detail_watched;
        let reveal = reveal?;
        Some(self.face.next_sample(&reveal, self.wall_clock.real_usec()))
    }
}

/// The app-name lookup over the environment, as GLib reads it: `HOME` for the user's data directory
/// when `XDG_DATA_HOME` is unset (empty when `HOME` is unset too, as a unit always sets it).
pub(super) fn desktop_name_lookup(
    environment: &dyn Fn(&str) -> Option<String>,
) -> DesktopNameLookup {
    let home = environment(HOME_VARIABLE)
        .map(PathBuf::from)
        .unwrap_or_default();
    DesktopNameLookup::from_environment(environment, &home)
}

/// The sampler's real ports: the real reader, lister and clock, app names from `name_lookup`, and
/// its failure log's lines handed to `write_line` as warnings.
pub(super) fn real_sampler_ports(
    name_lookup: DesktopNameLookup,
    write_line: WriteLogLine,
) -> SamplerPorts {
    SamplerPorts {
        reader: Box::new(FileSystemReader),
        lister: Box::new(FileSystemLister),
        clock: Box::new(SystemClock),
        resolve_app_name: Box::new(move |desktop_id| name_lookup.name_of(desktop_id)),
        log: failure_log_writer(write_line),
    }
}
