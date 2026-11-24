//! The lists `rank_apps` gives: every group by CPU and by memory, largest first, at most the
//! ranking's length, kernel and short jobs never in the memory list, and equal values ordered by
//! name, then by group key.

use super::*;
use crate::constants::APP_RANKING_LENGTH;

/// How many groups more than a ranking holds the oversized input has.
const EXTRA_GROUP_COUNT: u64 = 2;

/// The gjs rows' `inputWithMoreGroupsThanTheRankingHolds`: more groups than a ranking holds, each
/// with distinct CPU and memory.
fn scan_with_more_groups_than_the_ranking_holds() -> RankingScan {
    let mut scan = RankingScan {
        elapsed_usec: ELAPSED_USEC,
        cpu_count: CPU_COUNT,
        ..RankingScan::default()
    };
    for group_index in 0..APP_RANKING_LENGTH + EXTRA_GROUP_COUNT {
        let path = format!("app-{group_index}");
        scan.previous_usage_usec.insert(&path, 0);
        scan.current_usage_usec
            .insert(&path, (group_index + 1) * 100_000);
        scan.memory_bytes_by_cgroup
            .insert(&path, ((group_index + 1) * GIB) as f64);
    }
    scan
}

#[test]
fn rank_apps_lists_every_group_by_cpu_and_by_memory_largest_first_at_most_the_ranking_length() {
    let ranking = rank(&scan_with_more_groups_than_the_ranking_holds());
    let ranking_length = usize::try_from(APP_RANKING_LENGTH).expect("a small number");
    assert_eq!(ranking.cpu_ranking.len(), ranking_length);
    assert_eq!(ranking.memory_ranking.len(), ranking_length);
    assert_eq!(ranking.cpu_ranking.first().cloned(), ranking.top_cpu);
    assert_eq!(ranking.memory_ranking.first().cloned(), ranking.top_memory);
    let cpu_percents: Vec<f64> = ranking.cpu_ranking.iter().map(|e| e.cpu_percent).collect();
    let memory_sizes: Vec<f64> = ranking
        .memory_ranking
        .iter()
        .map(|e| e.memory_bytes)
        .collect();
    assert!(cpu_percents.windows(2).all(|pair| pair[1] <= pair[0]));
    assert!(memory_sizes.windows(2).all(|pair| pair[1] <= pair[0]));
}

#[test]
fn equal_values_rank_by_name_then_group_key_so_the_order_never_depends_on_insertion() {
    let ranking = rank(&scan_of(&[
        ("b", Some(0), 1_000_000, Some(1)),
        ("a", Some(0), 1_000_000, Some(1)),
    ]));
    let group_keys: Vec<&str> = ranking
        .cpu_ranking
        .iter()
        .map(|entry| entry.group_key.as_str())
        .collect();
    assert_eq!(group_keys, ["a", "b"]);
    assert_eq!(ranking.cpu_ranking.first().cloned(), ranking.top_cpu);
}

#[test]
fn the_memory_ranking_never_names_kernel_or_short_jobs() {
    let scan = with_parents(
        scan_of(&[("app", Some(0), 1_000_000, Some(1))]),
        &[("app", "p")],
        &[("p", 11_000_000.0)],
        &[],
    );
    let ranking = rank(&with_root_delta(scan, 12_000_000.0));
    assert!(!ranking
        .memory_ranking
        .iter()
        .any(|entry| entry.group_key.starts_with("pseudo:")));
    assert!(ranking
        .cpu_ranking
        .iter()
        .any(|entry| entry.group_key == "pseudo:short-jobs"));
}

#[test]
fn rank_apps_with_nothing_to_rank_gives_empty_lists() {
    let ranking = rank(&scan_of(&[]));
    assert!(ranking.cpu_ranking.is_empty());
    assert!(ranking.memory_ranking.is_empty());
}

#[test]
fn the_cpu_ranking_is_empty_whenever_the_cpu_cannot_be_ranked() {
    let scan = RankingScan {
        elapsed_usec: 0,
        ..scan_of(&[("app", Some(0), 1_000_000, Some(GIB))])
    };
    let ranking = rank(&scan);
    assert_eq!(ranking.top_cpu, None);
    assert!(ranking.cpu_ranking.is_empty());
    assert_eq!(ranking.memory_ranking.len(), 1);
}

/// Equal values rank by name before group key: the keys `k1`, `k2`, `k3` order one way and their
/// names `zeta`, `alpha`, `mid` another, in either insertion order. Expected ranking (keys, in
/// order, k2 k3 k1, for CPU and for memory): `rankApps` run under gjs on the same input.
#[test]
fn equal_values_rank_by_name_before_group_key_when_they_order_differently() {
    let name_of_key = |key: &str| match key {
        "k1" => "zeta",
        "k2" => "alpha",
        _ => "mid",
    };
    for insertion_order in [["k1", "k2", "k3"], ["k3", "k2", "k1"]] {
        let leaves: Vec<LeafSpec> = insertion_order
            .iter()
            .map(|key| (*key, Some(0), 1_000_000, Some(5)))
            .collect();
        let ranking = rank_apps(&scan_of(&leaves), &mut |path| AppGroup {
            group_key: path.to_string(),
            name: name_of_key(path).to_string(),
        });
        let cpu_keys: Vec<&str> = ranking
            .cpu_ranking
            .iter()
            .map(|e| e.group_key.as_str())
            .collect();
        let memory_keys: Vec<&str> = ranking
            .memory_ranking
            .iter()
            .map(|e| e.group_key.as_str())
            .collect();
        assert_eq!(cpu_keys, ["k2", "k3", "k1"], "{insertion_order:?}");
        assert_eq!(memory_keys, ["k2", "k3", "k1"], "{insertion_order:?}");
    }
}
