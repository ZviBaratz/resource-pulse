use super::*;

/// Three histories of `capacity`, which must not be zero.
fn histories_of_capacity(capacity: usize) -> PressureHistories {
    PressureHistories::new(NonZeroUsize::new(capacity).unwrap())
}

#[test]
fn each_reading_goes_to_its_own_history_and_a_missing_one_is_a_gap_there_alone() {
    let mut histories = histories_of_capacity(3);
    histories.push(PressureAvg10 {
        cpu: Some(1.5),
        memory: Some(0.0),
        io: None,
    });
    histories.push(PressureAvg10 {
        cpu: Some(30.25),
        memory: None,
        io: Some(55.0),
    });
    assert_eq!(histories.cpu().values(), vec![Some(1.5), Some(30.25)]);
    assert_eq!(histories.memory().values(), vec![Some(0.0), None]);
    assert_eq!(histories.io().values(), vec![None, Some(55.0)]);
}

#[test]
fn the_three_histories_drop_their_oldest_together_at_their_capacity() {
    let mut histories = histories_of_capacity(2);
    for percent in [1.0, 2.0, 3.0] {
        histories.push(PressureAvg10 {
            cpu: Some(percent),
            memory: Some(percent * 10.0),
            io: Some(percent * 100.0),
        });
    }
    assert_eq!(histories.cpu().values(), vec![Some(2.0), Some(3.0)]);
    assert_eq!(histories.memory().values(), vec![Some(20.0), Some(30.0)]);
    assert_eq!(histories.io().values(), vec![Some(200.0), Some(300.0)]);
}
