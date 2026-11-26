//! The ticks missed before a tick: a gap in every history for each, written before the tick's own
//! values, at most a history's length of them, and the count the publish carries.

use std::cell::Cell;
use std::rc::Rc;

use super::*;
use crate::constants::CARD_HISTORY_SAMPLES;

/// root-a's memory used fraction: 20,000,000 KiB of 32,000,000 KiB.
const FIXTURE_MEMORY_USED_FRACTION: f64 = 0.625;
/// root-a's PSI `some avg10` of cpu.
const FIXTURE_CPU_PRESSURE_PERCENT: f64 = 12.5;

/// The five histories' values, oldest first: CPU, memory, and the three pressure histories.
fn every_history(sampler: &Sampler) -> [Vec<Option<f64>>; 5] {
    let pressure_histories = sampler.pressure_histories();
    [
        sampler.cpu_history().values(),
        sampler.memory_history().values(),
        pressure_histories.cpu().values(),
        pressure_histories.memory().values(),
        pressure_histories.io().values(),
    ]
}

/// A tick after three missed ones writes three gaps into each of the five histories, then its own
/// values, and its publish says it missed three. The tick reads root-b, so that its CPU, measured
/// against root-a's tick, is a value.
#[test]
fn a_tick_after_three_missed_ones_writes_three_gaps_into_every_history_before_its_values() {
    let mut test_sampler = SamplerSetup::at_fixture("root-a").build();
    test_sampler.sampler.initialize();
    test_sampler.sampler.run_tick(0);
    test_sampler.advance_clock(4 * SAMPLE_SPACING_USEC);
    test_sampler.sampler.set_fs_root(fixture_root("root-b"));
    let publish = test_sampler.sampler.run_tick_after_missed_ticks(1, 3);
    let histories = every_history(&test_sampler.sampler);
    let gaps_then_value = |history: &Vec<Option<f64>>| {
        history[1..4].iter().all(Option::is_none) && history[4].is_some()
    };
    assert_eq!(
        (
            publish
                .appended_history
                .map(|appended| appended.missed_tick_count),
            histories.iter().map(Vec::len).collect::<Vec<_>>(),
            histories.iter().all(gaps_then_value),
            histories[1][0],
        ),
        (
            Some(3),
            vec![5, 5, 5, 5, 5],
            true,
            Some(FIXTURE_MEMORY_USED_FRACTION)
        )
    );
}

/// A night's suspend misses far more ticks than a history holds: the count is capped at
/// `CARD_HISTORY_SAMPLES`, so each history holds 149 gaps and the tick's own value, and the publish
/// says it missed 150, not the 21,600 slept.
#[test]
fn a_count_past_the_history_is_capped_at_its_length() {
    let mut test_sampler = SamplerSetup::at_fixture("root-a").build();
    test_sampler.sampler.initialize();
    test_sampler.sampler.run_tick(0);
    let publish = test_sampler.sampler.run_tick_after_missed_ticks(1, 21_600);
    let histories = every_history(&test_sampler.sampler);
    let history_length = usize::try_from(CARD_HISTORY_SAMPLES).unwrap();
    let memory_gap_count = histories[1].iter().filter(|value| value.is_none()).count();
    assert_eq!(
        (
            publish
                .appended_history
                .map(|appended| appended.missed_tick_count),
            histories.iter().map(Vec::len).collect::<Vec<_>>(),
            memory_gap_count,
            histories[1].last().copied().flatten(),
            histories[2].last().copied().flatten(),
        ),
        (
            Some(CARD_HISTORY_SAMPLES),
            vec![history_length; 5],
            history_length - 1,
            Some(FIXTURE_MEMORY_USED_FRACTION),
            Some(FIXTURE_CPU_PRESSURE_PERCENT),
        )
    );
}

/// A tick that has no data after two missed ones writes the two gaps and then its own: three in a
/// row, and its publish says it missed two.
#[test]
fn a_tick_with_no_data_after_missed_ones_writes_their_gaps_then_its_own() {
    let is_clock_broken = Rc::new(Cell::new(false));
    let mut test_sampler = SamplerSetup::at_fixture("root-a")
        .with_clock_label(breakable_clock_label(&is_clock_broken))
        .build();
    test_sampler.sampler.initialize();
    test_sampler.sampler.run_tick(0);
    is_clock_broken.set(true);
    let publish = test_sampler.sampler.run_tick_after_missed_ticks(1, 2);
    assert_eq!(
        (
            publish
                .appended_history
                .map(|appended| appended.missed_tick_count),
            test_sampler.sampler.memory_history().values(),
        ),
        (
            Some(2),
            vec![Some(FIXTURE_MEMORY_USED_FRACTION), None, None, None]
        )
    );
}

/// The count is for one tick only: the tick after it, with none missed, writes no gap and says 0.
#[test]
fn the_count_holds_for_its_own_tick_only() {
    let mut test_sampler = SamplerSetup::at_fixture("root-a").build();
    test_sampler.sampler.initialize();
    test_sampler.sampler.run_tick(0);
    test_sampler.sampler.run_tick_after_missed_ticks(1, 2);
    let publish = test_sampler.sampler.run_tick(2);
    assert_eq!(
        (
            publish
                .appended_history
                .map(|appended| appended.missed_tick_count),
            test_sampler.sampler.memory_history().values().len(),
        ),
        (Some(0), 5)
    );
}
