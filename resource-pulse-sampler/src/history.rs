//! The fixed-capacity sample history, matching `lib/history.js`.

use std::collections::VecDeque;
use std::num::NonZeroUsize;

/// Fixed-capacity history of samples; `None` marks a gap (no data).
#[derive(Debug, Clone, PartialEq)]
pub struct RingBuffer {
    capacity: NonZeroUsize,
    samples: VecDeque<Option<f64>>,
}

impl RingBuffer {
    /// An empty buffer keeping at most `capacity` samples. A capacity of zero is impossible by
    /// type, which is how the gjs constructor's throw (for anything that is not a positive
    /// integer) is carried: a `NonZeroUsize` cannot be 0, negative, fractional or `NaN`.
    pub fn new(capacity: NonZeroUsize) -> Self {
        Self {
            capacity,
            samples: VecDeque::new(),
        }
    }

    /// Appends a sample, dropping the oldest when full.
    pub fn push(&mut self, value: Option<f64>) {
        self.samples.push_back(value);
        if self.samples.len() > self.capacity.get() {
            self.samples.pop_front();
        }
    }

    /// All samples, oldest first (a copy).
    pub fn values(&self) -> Vec<Option<f64>> {
        self.samples.iter().copied().collect()
    }

    /// The newest `count` samples, oldest first: all of them when `count` is more than are kept,
    /// none when it is 0.
    pub fn last_values(&self, count: usize) -> Vec<Option<f64>> {
        let skipped_count = self.samples.len().saturating_sub(count);
        self.samples.iter().skip(skipped_count).copied().collect()
    }

    /// Forgets every sample.
    pub fn clear(&mut self) {
        self.samples.clear();
    }
}

#[cfg(test)]
mod tests;
