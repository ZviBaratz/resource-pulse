//! The pressure meter's bands, matching `lib/pressure.js`.

use crate::constants::PRESSURE_BAND_THRESHOLDS_PERCENT;

/// Maps PSI `some avg10` to a meter band.
///
/// Parameters
/// ----------
/// avg10_percent
///     The stall percentage, or `None` when unavailable.
///
/// Returns
/// -------
/// The band index, 0 (calm) to 3, or `None` for no data. A NaN is no data; an infinity is a band
/// like any number.
pub fn pressure_band(avg10_percent: Option<f64>) -> Option<u8> {
    let avg10_percent = avg10_percent.filter(|value| !value.is_nan())?;
    // A threshold is a few tens, far below 2^53, so the conversion to f64 is exact.
    let bands_reached = PRESSURE_BAND_THRESHOLDS_PERCENT
        .iter()
        .filter(|&&threshold| avg10_percent >= threshold as f64)
        .count();
    u8::try_from(bands_reached).ok()
}

#[cfg(test)]
mod tests;
