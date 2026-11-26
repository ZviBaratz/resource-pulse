//! The five-minute history of the three PSI `some avg10` readings, kept as the CPU and memory
//! histories are: one value per 2 s slot, in percent, `None` for a gap.

use std::num::NonZeroUsize;

use crate::history::RingBuffer;
use crate::sampler::PressureAvg10;

/// One history per resource the kernel reports pressure for, each of the same capacity, so the
/// three stay as long as one another and as the CPU history.
#[derive(Debug, Clone, PartialEq)]
pub struct PressureHistories {
    cpu: RingBuffer,
    memory: RingBuffer,
    io: RingBuffer,
}

impl PressureHistories {
    /// Three empty histories, each keeping at most `capacity` values.
    pub fn new(capacity: NonZeroUsize) -> Self {
        Self {
            cpu: RingBuffer::new(capacity),
            memory: RingBuffer::new(capacity),
            io: RingBuffer::new(capacity),
        }
    }

    /// Appends one tick's readings, each to its own history: a `None` reading is a gap in its
    /// history alone.
    pub fn push(&mut self, pressure_avg10: PressureAvg10) {
        self.cpu.push(pressure_avg10.cpu);
        self.memory.push(pressure_avg10.memory);
        self.io.push(pressure_avg10.io);
    }

    /// CPU pressure percents, oldest first.
    pub fn cpu(&self) -> &RingBuffer {
        &self.cpu
    }

    /// Memory pressure percents, oldest first.
    pub fn memory(&self) -> &RingBuffer {
        &self.memory
    }

    /// IO pressure percents, oldest first.
    pub fn io(&self) -> &RingBuffer {
        &self.io
    }
}

#[cfg(test)]
mod tests;
