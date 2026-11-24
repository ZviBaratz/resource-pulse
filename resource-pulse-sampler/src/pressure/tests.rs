use super::*;

#[test]
fn psi_bands_at_the_edges() {
    let bands: Vec<Option<u8>> = [
        Some(9.99),
        Some(10.0),
        Some(24.99),
        Some(25.0),
        Some(49.99),
        Some(50.0),
        None,
    ]
    .into_iter()
    .map(pressure_band)
    .collect();
    assert_eq!(
        bands,
        vec![Some(0), Some(1), Some(1), Some(2), Some(2), Some(3), None]
    );
}

/// Where the gjs `pressureBand` is not a plain number: NaN is no data, the infinities are
/// bands, a negative is calm. Expected values are `pressureBand` run under gjs.
#[test]
fn pressure_band_of_the_values_that_are_not_ordinary_numbers() {
    let inputs = [
        f64::NAN,
        f64::INFINITY,
        f64::NEG_INFINITY,
        0.0,
        -1.0,
        9.999_999_999_999_999,
        10.000_000_001,
        1e308,
    ];
    let bands: Vec<Option<u8>> = inputs
        .into_iter()
        .map(|value| pressure_band(Some(value)))
        .collect();
    assert_eq!(
        bands,
        vec![
            None,
            Some(3),
            Some(0),
            Some(0),
            Some(0),
            Some(0),
            Some(1),
            Some(3)
        ]
    );
}
