//! Where the ranking computes as JavaScript's doubles do: counters near the top of a `u64` and
//! above 2^53, a counter that went backwards, a `NaN` and two infinities in the sort, and a tiny
//! share.

use super::*;

/// Counters near the top of a `u64` are doubles in the gjs; sums, differences and shares of them
/// round as doubles do. Expected values: `rankApps` run under gjs (a counter of 2^63 + 1 reads as
/// 2^63, so one that fell from 2^63 + 1 to 2^63 has not gone backwards and its delta is 0).
#[test]
fn counters_near_the_top_of_a_u64_round_as_doubles_do() {
    let big = rank(&scan_of(&[
        ("big", Some(0), u64::MAX, Some(u64::MAX)),
        ("small", Some(0), 1, Some(1)),
    ]));
    assert_eq!(
        big.cpu_ranking,
        [
            cpu_entry("big", 115_292_150_460_684.69),
            cpu_entry("small", 0.0000062499999999999995),
        ]
    );
    assert_eq!(
        big.memory_ranking,
        [
            memory_entry("big", 18_446_744_073_709_552_000.0),
            memory_entry("small", 1.0)
        ]
    );
    let summed = rank(&scan_of(&[
        ("h#1", Some(0), 0, Some(u64::MAX)),
        ("h#2", Some(0), 0, Some(u64::MAX)),
    ]));
    assert_eq!(
        summed.memory_ranking,
        [memory_entry("h", 36_893_488_147_419_103_000.0)]
    );
    let two_to_the_63 = 1_u64 << 63;
    let not_backwards = rank(&scan_of(&[(
        "r",
        Some(two_to_the_63 + 1),
        two_to_the_63,
        Some(1),
    )]));
    assert_eq!(not_backwards.cpu_ranking, [cpu_entry("r", 0.0)]);
    let rounded_up = rank(&scan_of(&[("g#1", Some(0), 0, Some(TWO_TO_THE_53 + 1))]));
    assert_eq!(
        rounded_up.memory_ranking,
        [memory_entry("g", 9_007_199_254_740_992.0)]
    );
}

/// A root delta above 2^53 reads as a double: kernel's share is the double the gjs computes.
/// Expected values: `rankApps` run under gjs, whose literal 9007199254740993 is 2^53 (written as
/// 2^53 here, since clippy refuses a literal that rounds).
#[test]
fn a_root_delta_above_two_to_the_53_is_a_double() {
    let scan = with_parents(
        scan_of(&[("a", Some(0), 1_000_000, Some(1))]),
        &[("a", "p")],
        &[("p", 1.0)],
        &[],
    );
    let ranking = rank(&with_root_delta(scan, 9_007_199_254_740_992.0));
    assert_eq!(
        ranking.cpu_ranking,
        [
            pseudo_cpu_entry("pseudo:kernel", "kernel", 56_294_995_342.131195),
            cpu_entry("a", 6.25),
            pseudo_cpu_entry("pseudo:short-jobs", "short jobs", 0.0),
        ]
    );
}

/// Two `usage_usec` readings above 2^53 differ by the double the gjs subtracts, not by the exact
/// integers: 9007199254740993 reads as 2^53 and 9007199254741000 as 2^53 + 8. Expected values: gjs
/// run on the same input: `counterDeltaUsec`'s expression, `current >= previous ? current - previous
/// : current`, gives 8 (the exact difference is 7), and `rankApps` with a root delta of that 8, one
/// parent of 1 µs, 2 s on 8 CPUs gives kernel's `cpuPercent` as 0.00004375.
#[test]
fn counters_above_two_to_the_53_are_subtracted_as_doubles() {
    const PREVIOUS_USEC: u64 = 9_007_199_254_740_993;
    const CURRENT_USEC: u64 = 9_007_199_254_741_000;
    const GJS_DELTA_USEC: f64 = 8.0;
    assert_eq!(
        counter_delta_usec(PREVIOUS_USEC, CURRENT_USEC),
        GJS_DELTA_USEC
    );
    let scan = with_parents(
        scan_of(&[("a", Some(0), 1_000_000, Some(1))]),
        &[("a", "p")],
        &[("p", 1.0)],
        &[],
    );
    let ranking = rank(&with_root_delta(
        scan,
        counter_delta_usec(PREVIOUS_USEC, CURRENT_USEC),
    ));
    assert_eq!(
        ranking.cpu_ranking,
        [
            cpu_entry("a", 6.25),
            pseudo_cpu_entry("pseudo:kernel", "kernel", 0.00004375),
            pseudo_cpu_entry("pseudo:short-jobs", "short jobs", 0.0),
        ]
    );
}

/// A counter that went backwards is a recreated unit: its whole new reading counts, as in
/// `counterDeltaUsec`.
#[test]
fn a_counter_that_went_backwards_counts_in_full() {
    assert_eq!(counter_delta_usec(9_000_000, 3_000_000), 3_000_000.0);
    assert_eq!(counter_delta_usec(5, 5), 0.0);
}

/// A `NaN`, an infinity and a negative infinity reach the sort through the deltas, which counters
/// cannot produce. The ranking returns, and the ordinary entries keep the order the gjs gives them
/// (a 3 s, a 2 s and a 1 s leaf: `rankApps` run under gjs on the scan without the odd deltas gives
/// a 18.75, b 12.5, c 6.25). The comparator is a total order for every double, so no input panics
/// `sort_by`.
#[test]
fn a_nan_and_two_infinities_cannot_panic_the_ranking() {
    let scan = with_parents(
        scan_of(&[
            ("a", Some(0), 3_000_000, Some(1)),
            ("b", Some(0), 2_000_000, Some(1)),
            ("c", Some(0), 1_000_000, Some(1)),
        ]),
        &[("a", "p"), ("b", "q"), ("c", "r")],
        &[("p", f64::NEG_INFINITY), ("q", f64::INFINITY), ("r", 0.0)],
        &[],
    );
    let ranking = rank(&with_root_delta(scan, 1_000_000.0));
    let ordinary_names: Vec<&str> = cpu_ranking_names(&ranking)
        .into_iter()
        .filter(|name| ["a", "b", "c"].contains(name))
        .collect();
    assert_eq!(ordinary_names, ["a", "b", "c"]);
    let mut totals: Vec<GroupTotal> = [
        f64::NAN,
        1.0,
        f64::INFINITY,
        f64::NEG_INFINITY,
        0.0,
        f64::NAN,
    ]
    .into_iter()
    .enumerate()
    .map(|(index, value)| GroupTotal {
        group_key: index.to_string(),
        name: index.to_string(),
        value,
    })
    .collect();
    totals.sort_by(compare_largest_first);
    assert_eq!(totals.len(), 6);
}

/// A share too small for its digits is the double the gjs computes. Expected value: `rankApps`
/// run under gjs.
#[test]
fn a_tiny_share_is_the_double_the_javascript_computes() {
    let ranking = rank(&scan_of(&[("a", Some(0), 1, Some(1))]));
    assert_eq!(
        ranking.cpu_ranking,
        [cpu_entry("a", 0.0000062499999999999995)]
    );
}
