//! What `rank_apps` attributes to each group: shares of the whole machine, scopes summed, kernel
//! and short jobs, new and recreated leaves, ties broken by name, and nothing scanned.

use super::*;

#[test]
fn app_cpu_is_a_share_of_the_whole_machine() {
    let ranking = rank(&scan_of(&[("herdr agents", Some(0), 8_000_000, Some(GIB))]));
    assert_eq!(ranking.top_cpu, Some(cpu_entry("herdr agents", 50.0)));
}

#[test]
fn two_scopes_of_one_app_are_summed() {
    // chrome 2M + 2M = 4M beats alpha's 3M; ranking scopes singly would pick alpha.
    let ranking = rank(&scan_of(&[
        ("chrome#1", Some(0), 2_000_000, Some(1)),
        ("chrome#2", Some(0), 2_000_000, Some(1)),
        ("alpha", Some(0), 3_000_000, Some(1)),
    ]));
    assert_eq!(ranking.top_cpu, Some(cpu_entry("chrome", 25.0)));
}

#[test]
fn two_scopes_of_one_app_have_their_memory_summed() {
    let ranking = rank(&scan_of(&[
        ("chrome#1", Some(0), 0, Some(3 * GIB)),
        ("chrome#2", Some(0), 0, Some(3 * GIB)),
        ("alpha", Some(0), 0, Some(5 * GIB)),
    ]));
    assert_eq!(
        ranking.top_memory,
        Some(memory_entry("chrome", (6 * GIB) as f64))
    );
}

#[test]
fn a_cgroup_new_this_scan_is_left_out_of_cpu_but_counted_in_memory() {
    // 'fresh' has no previous reading; treating it as 0 would give it 100% CPU.
    let ranking = rank(&scan_of(&[
        ("old", Some(0), 1_000_000, Some(GIB)),
        ("fresh", None, 16_000_000, Some(9 * GIB)),
    ]));
    assert_eq!(top_cpu_name(&ranking), "old");
    assert_eq!(top_memory_name(&ranking), "fresh");
}

#[test]
fn kernel_is_the_root_delta_minus_the_parents_delta() {
    // The leaf equals its parent (no short jobs), so kernel's 50 ms of 16 s is the only other candidate.
    let scan = with_parents(
        scan_of(&[("app", Some(0), 40_000, Some(1))]),
        &[("app", "p")],
        &[("p", 40_000.0)],
        &[],
    );
    let ranking = rank(&with_root_delta(scan, 90_000.0));
    let expected_percent = 50_000.0 / MACHINE_CAPACITY_USEC * 100.0;
    assert_eq!(
        ranking.top_cpu,
        Some(pseudo_cpu_entry(
            "pseudo:kernel",
            "kernel",
            expected_percent
        ))
    );
}

#[test]
fn kernel_tops_cpu_when_the_parents_are_small() {
    let scan = with_parents(
        scan_of(&[("app", Some(0), 1_000_000, Some(1))]),
        &[("app", "p")],
        &[("p", 1_000_000.0)],
        &[],
    );
    let ranking = rank(&with_root_delta(scan, 12_000_000.0));
    assert_eq!(
        ranking.top_cpu,
        Some(pseudo_cpu_entry("pseudo:kernel", "kernel", 68.75))
    );
}

#[test]
fn kernel_is_root_minus_parents_not_minus_leaves() {
    // Root 12 s, parent 11 s, its leaf 1 s: kernel is 1 s, short jobs 10 s. Root minus leaves would be 11 s.
    let scan = with_parents(
        scan_of(&[("app", Some(0), 1_000_000, Some(1))]),
        &[("app", "p")],
        &[("p", 11_000_000.0)],
        &[],
    );
    let ranking = rank(&with_root_delta(scan, 12_000_000.0));
    assert_eq!(
        ranking.top_cpu,
        Some(pseudo_cpu_entry("pseudo:short-jobs", "short jobs", 62.5))
    );
}

#[test]
fn a_parent_missing_from_the_parent_deltas_ranks_neither_kernel_nor_short_jobs() {
    let scan = with_parents(
        scan_of(&[
            ("a", Some(0), 1_000, Some(1)),
            ("b", Some(0), 2_000, Some(1)),
        ]),
        &[("a", "p1"), ("b", "p2")],
        &[("p1", 9_000_000.0)],
        &[],
    );
    let ranking = rank(&with_root_delta(scan, 12_000_000.0));
    assert_eq!(top_cpu_name(&ranking), "b");
}

#[test]
fn empty_parent_maps_rank_neither_kernel_nor_short_jobs_even_with_a_root_delta() {
    // Root minus zero parents would name the whole machine as kernel.
    let scan = with_root_delta(
        scan_of(&[("app", Some(0), 1_000_000, Some(1))]),
        12_000_000.0,
    );
    let ranking = rank(&scan);
    assert_eq!(ranking.top_cpu, Some(cpu_entry("app", 6.25)));
}

#[test]
fn short_jobs_is_a_parents_delta_beyond_its_leaves() {
    let parents = |leaves: &[LeafSpec]| {
        with_parents(
            scan_of(leaves),
            &[("a", "p"), ("b", "p")],
            &[("p", 300_000.0)],
            &[],
        )
    };
    let ranking = rank(&parents(&[
        ("a", Some(0), 120_000, Some(1)),
        ("b", Some(0), 80_000, Some(1)),
    ]));
    assert_eq!(top_cpu_name(&ranking), "a");
    // Lift short jobs above the leaves to read its size: 100 ms of 16 s.
    let small = rank(&parents(&[
        ("a", Some(0), 20_000, Some(1)),
        ("b", Some(0), 20_000, Some(1)),
    ]));
    let expected_percent = 260_000.0 / MACHINE_CAPACITY_USEC * 100.0;
    assert_eq!(
        small.top_cpu,
        Some(pseudo_cpu_entry(
            "pseudo:short-jobs",
            "short jobs",
            expected_percent
        ))
    );
}

#[test]
fn short_jobs_sums_over_parents_and_read_skew_adds_zero() {
    // p1: 900 − 100 = 800. p2: leaf 300 > delta 100 → 0, not −200 (which would leave 600). 800 ms of 16 s is 5%.
    let scan = with_parents(
        scan_of(&[
            ("a", Some(0), 100_000, Some(1)),
            ("b", Some(0), 300_000, Some(1)),
        ]),
        &[("a", "p1"), ("b", "p2")],
        &[("p1", 900_000.0), ("p2", 100_000.0)],
        &[],
    );
    let ranking = rank(&scan);
    assert_eq!(
        ranking.top_cpu,
        Some(pseudo_cpu_entry("pseudo:short-jobs", "short jobs", 5.0))
    );
}

#[test]
fn a_recreated_leaf_counts_its_new_usage_not_zero() {
    let ranking = rank(&scan_of(&[("reset", Some(9_000_000), 3_000_000, Some(1))]));
    let expected_percent = 3_000_000.0 / MACHINE_CAPACITY_USEC * 100.0;
    assert_eq!(ranking.top_cpu, Some(cpu_entry("reset", expected_percent)));
}

#[test]
fn a_new_leaf_counts_its_full_usage_when_its_parent_was_listed_before() {
    let scan = with_parents(
        scan_of(&[
            ("fresh", None, 4_000_000, Some(1)),
            ("old", Some(0), 1_000_000, Some(1)),
        ]),
        &[("fresh", "p"), ("old", "p")],
        &[("p", 5_000_000.0)],
        &["p"],
    );
    let ranking = rank(&scan);
    assert_eq!(ranking.top_cpu, Some(cpu_entry("fresh", 25.0)));
}

#[test]
fn a_new_leaf_is_skipped_when_its_parent_was_not_listed_before() {
    let scan = with_parents(
        scan_of(&[
            ("fresh", None, 4_000_000, Some(1)),
            ("old", Some(0), 1_000_000, Some(1)),
        ]),
        &[("fresh", "p"), ("old", "p")],
        &[("p", 5_000_000.0)],
        &[],
    );
    let ranking = rank(&scan);
    // fresh is out; short jobs = 5 s − old's 1 s = 4 s would win if fresh were counted too (then 0).
    assert_eq!(top_cpu_name(&ranking), "short jobs");
}

#[test]
fn the_memory_half_is_never_kernel_or_short_jobs_however_much_is_unattributed() {
    // The gjs row also passes a `memoryUsedBytes` field of 10 GiB, which `rankApps` never reads and
    // `RankingScan` has no field for.
    let scan = with_parents(
        scan_of(&[("app", Some(0), 1_000, Some(2 * GIB))]),
        &[("app", "p")],
        &[("p", 11_000_000.0)],
        &[],
    );
    let ranking = rank(&with_root_delta(scan, 12_000_000.0));
    assert_eq!(
        ranking.top_memory,
        Some(memory_entry("app", (2 * GIB) as f64))
    );
}

#[test]
fn a_root_cpu_counter_that_went_backwards_gives_kernel_zero_percent() {
    // The parent has no leaf delta and zero delta: short jobs 0 too, so kernel's clamp decides the only candidate.
    let scan = with_parents(
        scan_of(&[("fresh", None, 1_000_000, Some(1))]),
        &[("fresh", "p")],
        &[("p", 0.0)],
        &[],
    );
    let ranking = rank(&with_root_delta(scan, -2_000_000.0));
    assert_eq!(
        ranking.top_cpu,
        Some(pseudo_cpu_entry("pseudo:kernel", "kernel", 0.0))
    );
}

#[test]
fn without_a_root_cpu_delta_there_is_no_kernel() {
    let scan = with_parents(
        scan_of(&[("app", Some(0), 0, Some(0))]),
        &[("app", "p")],
        &[("p", 0.0)],
        &[],
    );
    let ranking = rank(&scan);
    assert_eq!(top_cpu_name(&ranking), "app");
    assert_eq!(top_memory_name(&ranking), "app");
}

#[test]
fn equal_values_break_ties_by_name_ascending_in_either_insertion_order() {
    let beta_first = rank(&scan_of(&[
        ("beta", Some(0), 1_000_000, Some(5)),
        ("alpha", Some(0), 1_000_000, Some(5)),
    ]));
    let alpha_first = rank(&scan_of(&[
        ("alpha", Some(0), 1_000_000, Some(5)),
        ("beta", Some(0), 1_000_000, Some(5)),
    ]));
    for ranking in [&beta_first, &alpha_first] {
        assert_eq!(top_cpu_name(ranking), "alpha");
        assert_eq!(top_memory_name(ranking), "alpha");
    }
}

#[test]
fn a_real_app_tied_with_kernel_wins_or_loses_by_name_not_by_being_first() {
    // root Δ 2M, parent Δ 1M, the leaf equals its parent: the leaf and kernel both have 1M.
    let tie = |name: &'static str| {
        let scan = with_parents(
            scan_of(&[(name, Some(0), 1_000_000, Some(5))]),
            &[(name, "p")],
            &[("p", 1_000_000.0)],
            &[],
        );
        rank(&with_root_delta(scan, 2_000_000.0))
    };
    assert_eq!(top_cpu_name(&tie("alpha")), "alpha");
    assert_eq!(top_cpu_name(&tie("zeta")), "kernel");
}

#[test]
fn nothing_scanned_gives_no_rankings_not_zeros() {
    assert_eq!(rank(&scan_of(&[])), AppRanking::default());
    assert_eq!(rank(&scan_of(&[])).top_cpu, None);
    assert_eq!(rank(&scan_of(&[])).top_memory, None);
}

#[test]
fn no_cgroup_with_a_delta_gives_no_top_cpu_while_memory_still_ranks() {
    let ranking = rank(&scan_of(&[("fresh", None, 5_000_000, Some(2 * GIB))]));
    let fresh_memory = memory_entry("fresh", (2 * GIB) as f64);
    assert_eq!(
        ranking,
        AppRanking {
            top_cpu: None,
            top_memory: Some(fresh_memory.clone()),
            cpu_ranking: vec![],
            memory_ranking: vec![fresh_memory],
        }
    );
}
