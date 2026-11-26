//! Publishing a tick: the histories, the latest snapshot and the last good clock label
//! (`_publishTickSnapshot`, `_recordHistory`, `_publishNoDataSnapshot`).

use super::snapshot::{AppendedHistory, PressureAvg10, Publish, Snapshot};
use super::{Sampler, PERCENT_SCALE, SAMPLE_FAILURE_LOG_KEY};
use crate::caught_panic::value_or_none;

impl Sampler {
    /// Publishes a fast tick's snapshot: appends it to the histories and makes it the latest.
    pub(super) fn publish_tick_snapshot(&mut self, snapshot: Snapshot) -> Publish {
        let appended_history = self.record_history(&snapshot);
        self.latest_snapshot = Some(snapshot.clone());
        Publish {
            snapshot,
            appended_history: Some(appended_history),
        }
    }

    /// Publishes the no-data state after a sample failed: an all-`None`, incomplete snapshot and a
    /// gap in every history, so no surface goes on showing the last good numbers as live. The
    /// failure is logged last, as the gjs sampler logged it after its listeners had heard. The last
    /// good clock label is left alone (the snapshot has no data), so "no data since" still names
    /// the last good sample.
    pub(super) fn publish_no_data_snapshot(&mut self, failure_message: &str) -> Publish {
        let clock = self.clock.as_ref();
        let taken_at_usec = value_or_none(|| clock.monotonic_usec());
        let taken_at_clock_label = value_or_none(|| clock.clock_label()).and_then(Result::ok);
        self.is_latest_snapshot_no_data = true;
        let publish =
            self.publish_tick_snapshot(Snapshot::no_data(taken_at_usec, taken_at_clock_label));
        self.log_rate_limited(failure_message, SAMPLE_FAILURE_LOG_KEY);
        publish
    }

    /// Appends a gap to every history for each tick missed before this one, then the snapshot's
    /// CPU and memory fractions and its three pressure percents (`None` for a gap), and names it the
    /// last good sample when it has CPU or memory data.
    fn record_history(&mut self, snapshot: &Snapshot) -> AppendedHistory {
        let missed_tick_count = std::mem::take(&mut self.missed_tick_count_before_this_tick);
        self.record_missed_ticks(missed_tick_count);
        let memory_fraction = snapshot
            .memory
            .filter(|memory| memory.total_bytes > 0.0)
            .map(|memory| memory.used_bytes / memory.total_bytes);
        let appended_history = AppendedHistory {
            cpu: snapshot
                .cpu_busy_percent
                .map(|cpu_busy_percent| cpu_busy_percent / PERCENT_SCALE),
            memory: memory_fraction,
            pressure_avg10: snapshot.pressure_avg10,
            missed_tick_count,
        };
        self.cpu_history.push(appended_history.cpu);
        self.memory_history.push(appended_history.memory);
        self.pressure_histories
            .push(appended_history.pressure_avg10);
        if snapshot.cpu_busy_percent.is_some() || snapshot.memory.is_some() {
            self.last_good_clock_label = snapshot.taken_at_clock_label.clone();
        }
        appended_history
    }

    /// Appends `missed_tick_count` gaps to every history: the CPU and memory histories and the
    /// three pressure histories.
    fn record_missed_ticks(&mut self, missed_tick_count: u64) {
        for _ in 0..missed_tick_count {
            self.cpu_history.push(None);
            self.memory_history.push(None);
            // No reading of any resource: a gap in each pressure history.
            self.pressure_histories.push(PressureAvg10::default());
        }
    }
}
