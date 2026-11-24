//! The ranking's edges: the order names are asked for, a leaf with no recorded parent, no CPU
//! count or a negative elapsed time, a real group with a pseudo key, and kernel and short jobs of
//! equal value.

use super::*;

/// `nameOfCgroup` is called for each leaf with a delta in the CPU loop, then for each leaf with
/// memory: new leaf `b` is skipped by the first loop only. Expected order: the calls under gjs.
#[test]
fn names_are_asked_for_in_the_cpu_loop_then_the_memory_loop() {
    let mut scan = with_parents(
        scan_of(&[
            ("a", Some(0), 5, None),
            ("b", None, 7, None),
            ("c", Some(0), 9, None),
        ]),
        &[("a", "p"), ("b", "p"), ("c", "p")],
        &[],
        &[],
    );
    scan.memory_bytes_by_cgroup.insert("c", 3.0);
    scan.memory_bytes_by_cgroup.insert("b", 2.0);
    scan.memory_bytes_by_cgroup.insert("a", 1.0);
    let mut asked_paths = Vec::new();
    rank_apps(&scan, &mut |path| {
        asked_paths.push(path.to_string());
        name_after_itself_up_to_hash(path)
    });
    assert_eq!(asked_paths, ["a", "c", "c", "b", "a"]);
}

/// A leaf with a previous reading counts even when no parent is recorded for it, and a new leaf
/// with no parent is never counted (it has no listed parent); a parent recorded for no leaf does
/// not stop kernel and short jobs. Expected values: `rankApps` run under gjs.
#[test]
fn a_leaf_with_no_recorded_parent_counts_only_with_a_previous_reading() {
    let scan = RankingScan {
        parent_cpu_delta_usec: {
            let mut deltas = InsertionOrderedMap::new();
            deltas.insert("p", 1_000_000.0);
            deltas
        },
        ..with_root_delta(
            scan_of(&[
                ("a", Some(0), 1_000_000, Some(1)),
                ("b", None, 1_000_000, Some(1)),
            ]),
            3_000_000.0,
        )
    };
    let ranking = rank(&scan);
    assert_eq!(
        ranking.cpu_ranking,
        [
            pseudo_cpu_entry("pseudo:kernel", "kernel", 12.5),
            cpu_entry("a", 6.25),
            pseudo_cpu_entry("pseudo:short-jobs", "short jobs", 6.25),
        ]
    );
    assert_eq!(
        ranking.memory_ranking,
        [memory_entry("a", 1.0), memory_entry("b", 1.0)]
    );
}

/// No CPU count, or a negative elapsed time, leaves the CPU unranked and memory ranked.
#[test]
fn no_cpu_count_or_a_negative_elapsed_time_leaves_only_memory_ranked() {
    let no_cpus = RankingScan {
        cpu_count: 0,
        ..scan_of(&[("a", Some(0), 1_000_000, Some(1))])
    };
    let time_went_backwards = RankingScan {
        elapsed_usec: -5,
        ..scan_of(&[("a", Some(0), 1_000_000, Some(1))])
    };
    for scan in [no_cpus, time_went_backwards] {
        let ranking = rank(&scan);
        assert_eq!(ranking.top_cpu, None);
        assert!(ranking.cpu_ranking.is_empty());
        assert_eq!(ranking.memory_ranking, [memory_entry("a", 1.0)]);
    }
}

/// A group whose key is `pseudo:kernel` shares its total with kernel, under the name of the first
/// to be added; kernel and short jobs of equal value rank by name. Expected values: `rankApps`
/// run under gjs.
#[test]
fn a_real_group_with_a_pseudo_key_merges_with_kernel() {
    let scan = with_parents(
        scan_of(&[("k", Some(0), 1_000_000, Some(1))]),
        &[("k", "p")],
        &[("p", 1_000_000.0)],
        &[],
    );
    let ranking = rank_apps(&with_root_delta(scan, 3_000_000.0), &mut |_| AppGroup {
        group_key: "pseudo:kernel".to_string(),
        name: "impostor".to_string(),
    });
    assert_eq!(
        ranking.cpu_ranking,
        [
            pseudo_cpu_entry("pseudo:kernel", "impostor", 18.75),
            pseudo_cpu_entry("pseudo:short-jobs", "short jobs", 0.0),
        ]
    );
}

/// Kernel and short jobs of equal value, and a parent whose delta fell below zero, which raises
/// kernel (root minus a negative total) and adds nothing to short jobs. Expected values: `rankApps`
/// run under gjs.
#[test]
fn kernel_and_short_jobs_of_equal_value_and_a_negative_parent_delta() {
    let leaf = [("a", Some(0), 1_000_000, Some(1))];
    let equal = with_parents(scan_of(&leaf), &[("a", "p")], &[("p", 3_000_000.0)], &[]);
    let equal_ranking = rank(&with_root_delta(equal, 3_000_000.0));
    assert_eq!(
        equal_ranking.cpu_ranking,
        [
            pseudo_cpu_entry("pseudo:short-jobs", "short jobs", 12.5),
            cpu_entry("a", 6.25),
            pseudo_cpu_entry("pseudo:kernel", "kernel", 0.0),
        ]
    );
    let negative = with_parents(scan_of(&leaf), &[("a", "p")], &[("p", -1_000_000.0)], &[]);
    let negative_ranking = rank(&with_root_delta(negative, 3_000_000.0));
    assert_eq!(
        negative_ranking.cpu_ranking,
        [
            pseudo_cpu_entry("pseudo:kernel", "kernel", 25.0),
            cpu_entry("a", 6.25),
            pseudo_cpu_entry("pseudo:short-jobs", "short jobs", 0.0),
        ]
    );
}
