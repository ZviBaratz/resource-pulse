//! Where the ranking follows JavaScript's orders: maps iterate in insertion order, and strings
//! compare by UTF-16 code unit.

use super::*;

/// Maps iterate in insertion order. Expected values: `rankApps` run
/// under gjs. Memory of 2^53, 1 and 1 in one group sums to 2^53 in that order (each 1 is lost) and
/// to 2^53 + 2 in the order 1, 1, 2^53; and the group takes the name of the first leaf the CPU map
/// holds and of the first the memory map holds, which can be different leaves.
#[test]
fn maps_iterate_in_insertion_order() {
    let memory_sum = |leaves: &[LeafSpec]| rank(&scan_of(leaves)).memory_ranking;
    let big_first = memory_sum(&[
        ("g#1", Some(0), 0, Some(TWO_TO_THE_53)),
        ("g#2", Some(0), 0, Some(1)),
        ("g#3", Some(0), 0, Some(1)),
    ]);
    let big_last = memory_sum(&[
        ("g#1", Some(0), 0, Some(1)),
        ("g#2", Some(0), 0, Some(1)),
        ("g#3", Some(0), 0, Some(TWO_TO_THE_53)),
    ]);
    assert_eq!(big_first, [memory_entry("g", 9_007_199_254_740_992.0)]);
    assert_eq!(big_last, [memory_entry("g", 9_007_199_254_740_994.0)]);

    let one_group_named_by_leaf = |cgroup_path: &str| AppGroup {
        group_key: "k".to_string(),
        name: cgroup_path.to_string(),
    };
    let mut scan = scan_of(&[
        ("x2", Some(0), 1_000_000, None),
        ("x1", Some(0), 1_000_000, None),
    ]);
    scan.memory_bytes_by_cgroup.insert("x1", 3.0);
    scan.memory_bytes_by_cgroup.insert("x2", 4.0);
    let ranking = rank_apps(&scan, &mut |path| one_group_named_by_leaf(path));
    assert_eq!(top_cpu_name(&ranking), "x2");
    assert_eq!(top_memory_name(&ranking), "x1");
}

/// Two groups with equal values and names that differ only outside the BMP order as JavaScript
/// orders them, by UTF-16 code unit: U+1F600 (D83D DE00) before U+E000, in either insertion order.
/// Rust's own string order would put U+E000 first. Expected order: `rankApps` run under gjs.
#[test]
fn equal_values_with_names_outside_the_bmp_rank_by_utf16_code_unit() {
    let emoji_leaf = "\u{1F600}x";
    let private_use_leaf = "\u{E000}x";
    for leaves in [
        [emoji_leaf, private_use_leaf],
        [private_use_leaf, emoji_leaf],
    ] {
        let scan = scan_of(&[
            (leaves[0], Some(0), 1_000_000, Some(7)),
            (leaves[1], Some(0), 1_000_000, Some(7)),
        ]);
        let ranking = rank(&scan);
        assert_eq!(cpu_ranking_names(&ranking), [emoji_leaf, private_use_leaf]);
        assert_eq!(top_memory_name(&ranking), emoji_leaf);
    }
}

/// Equal values and equal names go to the group key. Expected order: `rankApps` run under gjs.
#[test]
fn equal_values_and_names_rank_by_group_key() {
    let scan = scan_of(&[
        ("b", Some(0), 1_000_000, Some(1)),
        ("a", Some(0), 1_000_000, Some(1)),
    ]);
    let ranking = rank_apps(&scan, &mut |path| AppGroup {
        group_key: path.to_string(),
        name: "n".to_string(),
    });
    let group_keys: Vec<&str> = ranking
        .cpu_ranking
        .iter()
        .map(|entry| entry.group_key.as_str())
        .collect();
    assert_eq!(group_keys, ["a", "b"]);
}

/// Equal values and one name go to the group key, in JavaScript's string order: by UTF-16 code
/// unit, U+1F600 (D83D DE00) before U+E000, in either insertion order, where Rust's `str::cmp`
/// puts U+E000 first. Expected order: `rankApps` run under gjs, which gives `\u{1F600}x` first.
#[test]
fn equal_values_and_one_name_rank_group_keys_by_utf16_code_unit() {
    let emoji_key = "\u{1F600}x";
    let private_use_key = "\u{E000}x";
    for leaves in [["emoji", "private"], ["private", "emoji"]] {
        let scan = scan_of(&[
            (leaves[0], Some(0), 1_000_000, None),
            (leaves[1], Some(0), 1_000_000, None),
        ]);
        let ranking = rank_apps(&scan, &mut |path| AppGroup {
            group_key: if path == "emoji" {
                emoji_key
            } else {
                private_use_key
            }
            .to_string(),
            name: "x".to_string(),
        });
        let group_keys: Vec<&str> = ranking
            .cpu_ranking
            .iter()
            .map(|entry| entry.group_key.as_str())
            .collect();
        assert_eq!(group_keys, [emoji_key, private_use_key]);
    }
}
