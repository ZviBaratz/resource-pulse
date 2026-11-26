//! Resource Pulse's sampler, compiled: the per-tick `/proc` and `/sys` reader and the cgroup app
//! ranking, served on the session bus.
//!
//! Tests may unwrap, index and panic: a failing test should say so loudly. The
//! program itself may not (see `[lints.clippy]` in Cargo.toml).
#![cfg_attr(
    test,
    allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::indexing_slicing,
        clippy::string_slice,
        clippy::panic
    )
)]

pub mod apps;
pub mod bus;
pub mod cadence;
pub mod call_routing;
pub mod caught_panic;
pub mod constants;
pub mod cpu;
pub mod desktop_names;
mod gio_texts;
pub mod history;
pub mod insertion_ordered_map;
pub mod js_string;
pub mod log_line;
pub mod memory;
pub mod missed_ticks;
pub mod parsers;
pub mod payload;
pub mod ports;
pub mod pressure;
pub mod pressure_history;
pub mod program;
pub mod rate_limited_log;
pub mod real_ports;
pub mod sampler;
pub mod service;
#[cfg(test)]
mod test_support;
pub mod tick_schedule;
pub mod watchdog;
