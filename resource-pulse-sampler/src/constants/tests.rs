use super::*;

/// Every printed line is `NAME=value` and no name repeats.
#[test]
fn constant_lines_are_unique_name_value_pairs() {
    let lines = constant_lines();
    let mut names: Vec<&str> = lines
        .iter()
        .filter_map(|line| line.split_once('='))
        .map(|(name, _)| name)
        .collect();
    assert_eq!(names.len(), lines.len());
    names.sort_unstable();
    names.dedup();
    assert_eq!(names.len(), lines.len());
}

/// A list of numbers prints as JSON that serde_json reads back.
#[test]
fn a_number_list_prints_as_json_that_round_trips() {
    let thresholds: Vec<u64> =
        serde_json::from_str(&json_number_list(&PRESSURE_BAND_THRESHOLDS_PERCENT)).unwrap();
    assert_eq!(thresholds, PRESSURE_BAND_THRESHOLDS_PERCENT);
    assert_eq!(json_number_list(&[]), "[]");
}
