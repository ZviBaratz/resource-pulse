use super::*;

/// The tolerance the gjs rows compare fractions with.
const CLOSE_ENOUGH: f64 = 1e-9;

/// A `CpuTimes` with the fields these tests care about; the rest are zero.
fn times(user: u64, system: u64, idle: u64, iowait: u64) -> CpuTimes {
    CpuTimes {
        user,
        system,
        idle,
        iowait,
        ..CpuTimes::default()
    }
}

/// A per-CPU map of the given lines.
fn per_cpu(lines: &[(u32, CpuTimes)]) -> BTreeMap<u32, CpuTimes> {
    lines.iter().copied().collect()
}

/// A cluster-map input with no PMU lists and these capacities.
fn capacity_input(capacities: &[(u32, u64)], cpu_count: u32) -> ClusterMapInput {
    ClusterMapInput {
        core_pmu_cpus: Vec::new(),
        atom_pmu_cpus: Vec::new(),
        capacities: capacities.iter().copied().collect(),
        cpu_count,
    }
}

/// Asserts a fraction is present and within [`CLOSE_ENOUGH`] of `expected`.
fn assert_close(actual: Option<f64>, expected: f64) {
    let actual = actual.unwrap();
    assert!(
        (actual - expected).abs() < CLOSE_ENOUGH,
        "{actual} is not close to {expected}"
    );
}

/// The clusters of a map, or `None`.
fn clusters(map: Option<ClusterMap>) -> Option<(Vec<u32>, Vec<u32>)> {
    map.map(|map| (map.performance_cpus, map.efficiency_cpus))
}

#[test]
fn cpu_busy_excludes_guest_from_the_total_counting_it_gives_64_percent() {
    let previous = CpuTimes {
        guest: 50,
        ..times(100, 100, 700, 100)
    };
    let current = CpuTimes {
        guest: 80,
        ..times(200, 150, 800, 100)
    };
    assert_close(cpu_busy_fraction(Some(&previous), Some(&current)), 0.6);
}

#[test]
fn iowait_counts_as_idle_counting_it_busy_gives_67_percent() {
    let busy = cpu_busy_fraction(Some(&times(0, 0, 0, 0)), Some(&times(50, 0, 50, 50)));
    assert_close(busy, 1.0 / 3.0);
}

#[test]
fn first_sample_is_no_data_not_0() {
    assert_eq!(cpu_busy_fraction(None, Some(&times(1, 1, 1, 1))), None);
    assert_eq!(cpu_busy_fraction(Some(&times(1, 1, 1, 1)), None), None);
}

#[test]
fn no_delta_is_no_data_not_nan() {
    let same = times(1, 1, 1, 1);
    assert_eq!(cpu_busy_fraction(Some(&same), Some(&same)), None);
}

/// Every counter of the total takes part, except `guest` and `guest_nice`: from zero to
/// 1, 2, 3, 4, 5, 6, 7, 8, 9 and 10 in field order, 27 of 36 ticks are busy. Expected value:
/// `cpuBusyFraction` run under gjs, 0.75.
#[test]
fn every_counter_but_guest_and_guest_nice_is_in_the_total() {
    let current = CpuTimes {
        user: 1,
        nice: 2,
        system: 3,
        idle: 4,
        iowait: 5,
        irq: 6,
        softirq: 7,
        steal: 8,
        guest: 9,
        guest_nice: 10,
    };
    let busy = cpu_busy_fraction(Some(&CpuTimes::default()), Some(&current));
    assert_eq!(busy, Some(0.75));
}

/// A total that went backwards is no data; an idle counter that outruns the total (another
/// counter went backwards) gives a negative fraction, and one that fell gives more than 1.
/// Expected values are `cpuBusyFraction` run under gjs: null, -1 and 2.
#[test]
fn counters_that_went_backwards_give_no_data_or_a_fraction_outside_0_to_1() {
    let backwards = cpu_busy_fraction(Some(&times(10, 10, 10, 0)), Some(&times(5, 5, 5, 0)));
    assert_eq!(backwards, None);
    let negative = cpu_busy_fraction(Some(&times(10, 0, 0, 0)), Some(&times(5, 0, 10, 0)));
    assert_eq!(negative, Some(-1.0));
    let above_one = cpu_busy_fraction(Some(&times(0, 0, 20, 0)), Some(&times(20, 0, 10, 0)));
    assert_eq!(above_one, Some(2.0));
}

#[test]
fn a_cluster_uses_only_the_cpus_present_offline_cpus_have_no_line() {
    let previous = per_cpu(&[(0, times(0, 0, 0, 0)), (1, times(0, 0, 0, 0))]);
    let current = per_cpu(&[(0, times(30, 0, 70, 0)), (1, times(10, 0, 90, 0))]);
    // 40 busy of 200 total; dividing by all four listed CPUs would give 0.1.
    assert_close(
        cluster_busy_fraction(&previous, &current, &[0, 1, 2, 3]),
        0.2,
    );
}

#[test]
fn a_cluster_sums_deltas_rather_than_averaging_fractions() {
    let previous = per_cpu(&[(0, times(0, 0, 0, 0)), (1, times(0, 0, 0, 0))]);
    let current = per_cpu(&[(0, times(10, 0, 0, 0)), (1, times(0, 0, 90, 0))]);
    // 10 busy of 100 total = 0.1; averaging 1.0 and 0.0 would give 0.5.
    assert_close(cluster_busy_fraction(&previous, &current, &[0, 1]), 0.1);
}

#[test]
fn a_cluster_with_no_cpu_present_is_null() {
    let empty = BTreeMap::new();
    assert_eq!(cluster_busy_fraction(&empty, &empty, &[0, 1]), None);
}

/// A CPU that appears or vanishes between two samples is skipped, a CPU listed twice counts
/// twice, and a cluster whose total went backwards is no data. Expected values are
/// `clusterBusyFraction` run under gjs: 0.3, null and null.
#[test]
fn cpu_a_cpu_that_appears_or_vanishes_between_two_samples_gives_a_number_or_no_data_never_a_panic()
{
    let sample_of_cpu_0 = per_cpu(&[(0, times(0, 0, 0, 0))]);
    let sample_of_cpu_1 = per_cpu(&[(1, times(30, 0, 70, 0))]);
    let later_sample_of_cpu_0 = per_cpu(&[(0, times(30, 0, 70, 0))]);
    let empty = BTreeMap::new();
    // Appeared: CPU 1 has a line only in the later sample.
    assert_eq!(
        cluster_busy_fraction(&sample_of_cpu_0, &sample_of_cpu_1, &[0, 1]),
        None
    );
    // Vanished: CPU 0 had a line only in the earlier sample.
    assert_eq!(
        cluster_busy_fraction(&sample_of_cpu_0, &sample_of_cpu_1, &[0]),
        None
    );
    assert_eq!(
        cluster_busy_fraction(&sample_of_cpu_1, &sample_of_cpu_0, &[0, 1]),
        None
    );
    // Empty on either side, and an empty list of CPUs.
    assert_eq!(
        cluster_busy_fraction(&empty, &later_sample_of_cpu_0, &[0]),
        None
    );
    assert_eq!(cluster_busy_fraction(&sample_of_cpu_0, &empty, &[0]), None);
    assert_eq!(
        cluster_busy_fraction(&sample_of_cpu_0, &later_sample_of_cpu_0, &[]),
        None
    );
    // One CPU present among absent ones still gives its own fraction, listed twice or once.
    let twice = cluster_busy_fraction(&sample_of_cpu_0, &later_sample_of_cpu_0, &[0, 0]);
    assert_eq!(twice, Some(0.3));
    let once_among_absent =
        cluster_busy_fraction(&sample_of_cpu_0, &later_sample_of_cpu_0, &[7, 0, 9]);
    assert_eq!(once_among_absent, Some(0.3));
    let backwards = per_cpu(&[(0, times(5, 0, 5, 0))]);
    let before_backwards = per_cpu(&[(0, times(10, 0, 10, 0))]);
    assert_eq!(
        cluster_busy_fraction(&before_backwards, &backwards, &[0]),
        None
    );
}

#[test]
fn parse_cpu_list_handles_ranges_and_singles() {
    assert_eq!(parse_cpu_list("0-3,6,8-9\n"), Ok(vec![0, 1, 2, 3, 6, 8, 9]));
}

#[test]
fn parse_cpu_list_of_an_empty_file_is_empty() {
    assert_eq!(parse_cpu_list("\n"), Ok(vec![]));
}

/// What the gjs `parseCpuList` returns or throws for texts at its edges, run under gjs: a
/// reversed range is empty, a single-CPU range is one CPU, spaces around parts are trimmed,
/// and an empty part, a sign, a letter, a hex number, a second dash and a dangling dash
/// throw.
#[test]
fn parse_cpu_list_edges_match_the_gjs_function() {
    assert_eq!(parse_cpu_list("3-1"), Ok(vec![]));
    assert_eq!(parse_cpu_list("0-0"), Ok(vec![0]));
    assert_eq!(parse_cpu_list(" 0 , 1 "), Ok(vec![0, 1]));
    assert_eq!(parse_cpu_list("\u{2028}"), Ok(vec![]));
    // Each text, and the part the error names (the text itself, but for the empty parts).
    let unparseable_texts = [
        ("0,,1", ""),
        ("1-2-3", "1-2-3"),
        ("-1", "-1"),
        ("+1", "+1"),
        ("0 -1", "0 -1"),
        ("0,", ""),
        ("a", "a"),
        ("0x1", "0x1"),
        ("1-", "1-"),
    ];
    for (text, named_part) in unparseable_texts {
        assert_eq!(
            parse_cpu_list(text),
            Err(CpuListError::UnparseablePart(named_part.to_string())),
            "{text:?}"
        );
    }
}

/// The gjs `parseCpuList` names the part untrimmed in its error: for `"0, x"` the message is
/// `unparseable CPU list part " x"` (`parseCpuList` run under gjs). A part too large to be a
/// CPU names itself untrimmed too; the gjs has no error there, so that message is Rust's own.
#[test]
fn parse_cpu_list_errors_name_the_part_untrimmed() {
    let unparseable = parse_cpu_list("0, x").unwrap_err();
    assert_eq!(unparseable, CpuListError::UnparseablePart(" x".to_string()));
    assert_eq!(unparseable.to_string(), "unparseable CPU list part \" x\"");
    assert_eq!(
        parse_cpu_list("0, 65536 "),
        Err(CpuListError::CpuNumberTooLarge(" 65536".to_string()))
    );
}

/// `parseCpuList` trims JavaScript's whitespace, not Rust's (`parseCpuList` run under gjs):
/// U+FEFF is trimmed, so `"\u{feff}0"` is `[0]`; U+0085 is not, so `"0\u{85}"` throws
/// `unparseable CPU list part "0\u{85}"`.
#[test]
fn parse_cpu_list_trims_javascript_whitespace_not_rusts() {
    assert_eq!(parse_cpu_list("\u{feff}0"), Ok(vec![0]));
    assert_eq!(
        parse_cpu_list("0\u{85}"),
        Err(CpuListError::UnparseablePart("0\u{85}".to_string()))
    );
}

/// Where Rust refuses what gjs would try: a CPU number above any kernel's. The gjs function
/// would build a list of billions of numbers for `0-4000000000`; this is the one place the
/// two differ, and it is an error here, never an allocation or a panic.
#[test]
fn parse_cpu_list_refuses_a_cpu_number_no_kernel_has() {
    for too_large in ["0-4000000000", "65536", "99999999999999999999999"] {
        assert_eq!(
            parse_cpu_list(too_large),
            Err(CpuListError::CpuNumberTooLarge(too_large.to_string())),
            "{too_large:?}"
        );
    }
    assert_eq!(parse_cpu_list("65535"), Ok(vec![65_535]));
}

#[test]
fn cluster_map_hybrid_pmu_wins() {
    let input = ClusterMapInput {
        core_pmu_cpus: vec![0, 1, 2, 3],
        atom_pmu_cpus: vec![4, 5, 6, 7],
        capacities: BTreeMap::new(),
        cpu_count: 8,
    };
    assert_eq!(
        clusters(build_cluster_map(input)),
        Some((vec![0, 1, 2, 3], vec![4, 5, 6, 7]))
    );
}

#[test]
fn cluster_map_capacity_fallback_keeps_1024_and_1005_together() {
    let capacities = [
        (0, 1024),
        (1, 1024),
        (2, 1005),
        (3, 1005),
        (4, 676),
        (5, 676),
        (6, 676),
        (7, 676),
    ];
    assert_eq!(
        clusters(build_cluster_map(capacity_input(&capacities, 8))),
        Some((vec![0, 1, 2, 3], vec![4, 5, 6, 7]))
    );
}

#[test]
fn cluster_map_equal_capacities_give_a_single_cluster_null() {
    let capacities = [(0, 1024), (1, 1024), (2, 1024), (3, 1024)];
    assert_eq!(build_cluster_map(capacity_input(&capacities, 4)), None);
}

#[test]
fn cluster_map_no_pmu_and_no_capacities_is_null() {
    assert_eq!(build_cluster_map(capacity_input(&[], 4)), None);
}

/// Where the capacity fallback's edges are, expected values from `buildClusterMap` under
/// gjs: one PMU list alone does not count; a capacity at exactly 0.9 of the maximum is a
/// performance core (1000 and 900) and one below is not; CPUs at or past `cpu_count` and
/// CPUs without a capacity are left out; all-zero capacities are one cluster.
#[test]
fn cluster_map_capacity_fallback_edges_match_the_gjs_function() {
    let core_list_alone = ClusterMapInput {
        core_pmu_cpus: vec![0, 1],
        ..capacity_input(&[(0, 10), (1, 5)], 2)
    };
    assert_eq!(
        clusters(build_cluster_map(core_list_alone)),
        Some((vec![0], vec![1]))
    );
    let at_the_ratio = capacity_input(&[(0, 1000), (1, 900), (2, 899)], 3);
    assert_eq!(
        clusters(build_cluster_map(at_the_ratio)),
        Some((vec![0, 1], vec![2]))
    );
    let count_short = capacity_input(&[(0, 10), (1, 5), (2, 5)], 2);
    assert_eq!(
        clusters(build_cluster_map(count_short)),
        Some((vec![0], vec![1]))
    );
    let count_long = capacity_input(&[(0, 10), (1, 5)], 5);
    assert_eq!(
        clusters(build_cluster_map(count_long)),
        Some((vec![0], vec![1]))
    );
    let with_a_gap = capacity_input(&[(0, 10), (2, 5)], 3);
    assert_eq!(
        clusters(build_cluster_map(with_a_gap)),
        Some((vec![0], vec![2]))
    );
    assert_eq!(
        build_cluster_map(capacity_input(&[(0, 0), (1, 0)], 2)),
        None
    );
    // 0.9 * 1005 is 904.5: 904 is below it, 905 is not.
    let below_905 = capacity_input(&[(0, 1005), (1, 904)], 2);
    assert_eq!(
        clusters(build_cluster_map(below_905)),
        Some((vec![0], vec![1]))
    );
    assert_eq!(
        build_cluster_map(capacity_input(&[(0, 1005), (1, 905)], 2)),
        None
    );
}
