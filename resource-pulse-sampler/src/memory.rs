//! Memory and swap arithmetic, as the gjs sampler did it.
//! Byte counts become `f64` before the first arithmetic on them, as they were doubles in gjs, so a
//! difference may go negative.

use std::collections::HashMap;

use crate::parsers::is_ascii_digit_run;
use crate::parsers::proc::{SwapArea, ZramMmStat};

/// What a zram swap area's file name starts with.
const ZRAM_SWAP_AREA_PREFIX: &str = "/dev/";
/// What a zram device's name starts with, before its number.
const ZRAM_DEVICE_NAME_PREFIX: &str = "zram";
/// The `/proc/meminfo` field holding all memory.
const MEM_TOTAL_FIELD: &str = "MemTotal";
/// The `/proc/meminfo` field holding the kernel's estimate of memory available to programs.
const MEM_AVAILABLE_FIELD: &str = "MemAvailable";

/// One zram device's `mm_stat`, with its `/sys/block` name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ZramDevice {
    /// The device's name in `/sys/block`, such as `zram0`.
    pub device_name: String,
    /// Uncompressed bytes stored.
    pub stored_bytes: u64,
    /// RAM the device takes.
    pub ram_bytes: u64,
}

impl ZramDevice {
    /// A device made of its name and the two fields the sampler reads of its `mm_stat`.
    pub fn from_mm_stat(device_name: String, mm_stat: ZramMmStat) -> Self {
        Self {
            device_name,
            stored_bytes: mm_stat.stored_bytes,
            ram_bytes: mm_stat.ram_bytes,
        }
    }
}

/// Memory in use and the total, in bytes.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MemoryUsage {
    /// `MemTotal - MemAvailable`; negative when the kernel reports more available than total.
    pub used_bytes: f64,
    /// `MemTotal`.
    pub total_bytes: f64,
}

/// Swap in use, split between compressed zram and real disk.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SwapSummary {
    /// Swap in use on `/dev/zram*` areas.
    pub zram_used_bytes: f64,
    /// The RAM those same devices take (a zram device that is not a swap area adds nothing).
    pub zram_ram_bytes: f64,
    /// Swap in use on every other area.
    pub disk_bytes: f64,
}

/// Names the zram devices that are swap areas, as `/sys/block` names them.
///
/// Returns
/// -------
/// For example `["zram0"]`, in `/proc/swaps` order, a repeated area repeated; empty without zram
/// swap.
pub fn zram_swap_device_names(swap_areas: &[SwapArea]) -> Vec<String> {
    swap_areas
        .iter()
        .filter_map(|swap_area| zram_device_name(&swap_area.filename))
        .map(str::to_string)
        .collect()
}

/// The `/sys/block` name of a `/proc/swaps` file name that is exactly `/dev/zram<digits>`
/// (`/^\/dev\/(zram\d+)$/`, which has no `m` flag, so `$` is the end of the text and a trailing
/// newline does not match), `None` for any other file name.
fn zram_device_name(filename: &str) -> Option<&str> {
    let device_name = filename.strip_prefix(ZRAM_SWAP_AREA_PREFIX)?;
    let digits = device_name.strip_prefix(ZRAM_DEVICE_NAME_PREFIX)?;
    is_ascii_digit_run(digits).then_some(device_name)
}

/// Memory in use, as the kernel's own estimate: `MemTotal - MemAvailable`.
///
/// Returns
/// -------
/// `None` when either field is missing.
pub fn memory_usage(meminfo: &HashMap<String, u64>) -> Option<MemoryUsage> {
    let total_bytes = *meminfo.get(MEM_TOTAL_FIELD)? as f64;
    let available_bytes = *meminfo.get(MEM_AVAILABLE_FIELD)? as f64;
    Some(MemoryUsage {
        used_bytes: total_bytes - available_bytes,
        total_bytes,
    })
}

/// Swap in use, split between compressed zram and real disk, from each swap area's own `Used`.
/// zram's share is never derived from its `orig_data_size`: that leaves out same-filled pages
/// and slot use, so it under-counts zram and turned the difference into swap "on disk" that did
/// not exist.
pub fn swap_summary(swap_areas: &[SwapArea], zram_devices: &[ZramDevice]) -> SwapSummary {
    let mut zram_used_bytes = 0.0_f64;
    let mut disk_bytes = 0.0_f64;
    for swap_area in swap_areas {
        match zram_device_name(&swap_area.filename) {
            Some(_) => zram_used_bytes += swap_area.used_bytes as f64,
            None => disk_bytes += swap_area.used_bytes as f64,
        }
    }
    let swap_device_names = zram_swap_device_names(swap_areas);
    let zram_ram_bytes = zram_devices
        .iter()
        .filter(|zram_device| swap_device_names.contains(&zram_device.device_name))
        .fold(0.0_f64, |sum, zram_device| {
            sum + zram_device.ram_bytes as f64
        });
    SwapSummary {
        zram_used_bytes,
        zram_ram_bytes,
        disk_bytes,
    }
}

#[cfg(test)]
mod tests;
