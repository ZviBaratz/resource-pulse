use super::memory_net_of_page_cache;

/// `Math.max(0, parseInt(current, 10) - parseInt(reclaimable, 10))` run under gjs 1.88 for each
/// pair: 2^53 + 2 and 1 gives 2^53, and 2^53 + 3 and 1 gives 2^53 + 4, where a `u64` subtraction
/// converted afterwards gives 2^53 + 2.
#[test]
fn the_difference_is_taken_on_doubles_as_gjs_takes_it() {
    const GJS_RESULTS: [(u64, u64, f64); 2] = [
        (9_007_199_254_740_994, 1, 9_007_199_254_740_992.0),
        (9_007_199_254_740_995, 1, 9_007_199_254_740_996.0),
    ];
    for (current_bytes, reclaimable_bytes, gjs_bytes) in GJS_RESULTS {
        assert_eq!(
            memory_net_of_page_cache(current_bytes, reclaimable_bytes).to_bits(),
            gjs_bytes.to_bits(),
            "{current_bytes} - {reclaimable_bytes}"
        );
    }
}
