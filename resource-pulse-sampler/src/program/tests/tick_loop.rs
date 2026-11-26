//! The tick loop on a clock the row sets, through an outlet that records what it is handed: its one
//! schedule, its first tick, a tick that panics, a stall, a suspend and the gaps they leave, the
//! wall clock set back; and the real name lookup composed with the sampler.

use std::collections::HashMap;
use std::ops::ControlFlow;
use std::time::Duration;

use super::*;
use crate::caught_panic::install_panic_hook;
use crate::constants::LOG_PREFIX;
use crate::program::ending::LoopEnd;
use crate::program::sampler_service::{desktop_name_lookup, real_sampler_ports};
use crate::program::tick_loop::TickLoopOutlet;

/// The app the name-lookup row names from its `.desktop` file, and the group it is ranked under.
const FIXTURE_DESKTOP_NAME: &str = "Chrome From The Fixture";
const CHROME_GROUP_KEY: &str = "app:com.google.Chrome";
/// How much longer than asked the stall row's third wait lasts: the 2 s wait after the tick at 2 s
/// becomes 7.3 s, waking the loop at 9.3 s.
const STALL_BEYOND_WAIT_USEC: u64 = 5_300_000;
/// An hour, for the row that sets the wall clock back.
const HOUR_USEC: u64 = 3_600 * SECOND_USEC;
/// How long the suspend row's machine sleeps during one wait: four whole intervals and a half.
const SUSPEND_USEC: u64 = 8_500_000;

/// What the scripted outlet was handed for one tick.
#[derive(Debug)]
struct SentSample {
    /// The monotonic time it was sent at, from the start of the rows' clock.
    at_usec: u64,
    /// The number the sampler was given for the tick that made it.
    tick_number: u64,
    /// How many waits came before it.
    waits_before: usize,
    sample: Value,
}

/// An outlet that waits by moving the rows' clock on by the wait it is asked for, records each
/// Sample, and ends the loop after a set number of them. It can stretch one wait (a stall) and
/// change the sampler's root during one.
struct ScriptedOutlet {
    monotonic_usec: Rc<Cell<u64>>,
    sent: Vec<SentSample>,
    stop_after_sample_count: usize,
    /// After this many Samples, the next wait lasts this much longer than it was asked to.
    stall: Option<(usize, u64)>,
    /// After this many Samples, the next wait changes the sampler's root to this one.
    root_change: Option<(usize, PathBuf)>,
    /// After this many Samples, the machine sleeps this long during the next wait: the boot clock
    /// moves on by it (through `suspended_usec`), the monotonic clock does not.
    suspend: Option<(usize, u64)>,
    /// The time suspended that the service's boot clock reads: the row's, when it suspends.
    suspended_usec: Rc<Cell<u64>>,
    wait_count: usize,
    after_first_tick_count: usize,
    /// Whether the outlet has ended the loop, and how often it was called after that.
    has_stopped: bool,
    calls_after_stop: usize,
}

impl ScriptedOutlet {
    /// An outlet on the rows' clock that ends the loop after `stop_after_sample_count` Samples.
    fn new(monotonic_usec: &Rc<Cell<u64>>, stop_after_sample_count: usize) -> ScriptedOutlet {
        ScriptedOutlet {
            monotonic_usec: Rc::clone(monotonic_usec),
            sent: Vec::new(),
            stop_after_sample_count,
            stall: None,
            root_change: None,
            suspend: None,
            suspended_usec: Rc::new(Cell::new(0)),
            wait_count: 0,
            after_first_tick_count: 0,
            has_stopped: false,
            calls_after_stop: 0,
        }
    }

    /// The times the Samples were sent at, in seconds from the start of the rows' clock.
    fn sent_at_seconds(&self) -> Vec<f64> {
        self.sent
            .iter()
            .map(|sent| sent.at_usec as f64 / SECOND_USEC as f64)
            .collect()
    }

    /// The numbers the sampler was given for the ticks that made the Samples.
    fn tick_numbers(&self) -> Vec<u64> {
        self.sent.iter().map(|sent| sent.tick_number).collect()
    }

    /// Each Sample's `appendedHistory.missedTickCount`.
    fn missed_tick_counts(&self) -> Vec<Value> {
        self.sent
            .iter()
            .map(|sent| sent.sample["appendedHistory"]["missedTickCount"].clone())
            .collect()
    }
}

impl TickLoopOutlet for ScriptedOutlet {
    /// Counts the call.
    fn after_first_tick(&mut self) {
        self.after_first_tick_count += 1;
    }

    /// Records the Sample; ends the loop once enough have come.
    fn finish_tick(
        &mut self,
        service: &mut SamplerService,
        sample_text: Option<&str>,
    ) -> ControlFlow<LoopEnd> {
        if self.has_stopped {
            self.calls_after_stop += 1;
        }
        if let Some(sample_text) = sample_text {
            self.sent.push(SentSample {
                at_usec: self.monotonic_usec.get() - MONOTONIC_START_USEC,
                tick_number: service
                    .sampler
                    .latest_tick_number()
                    .expect("a tick has run"),
                waits_before: self.wait_count,
                sample: parse_json(sample_text),
            });
        }
        if self.sent.len() >= self.stop_after_sample_count {
            self.has_stopped = true;
            return ControlFlow::Break(LoopEnd::BusGone);
        }
        ControlFlow::Continue(())
    }

    /// Moves the clock on by the wait, plus the stall when one is due; changes the root when due.
    fn wait_for_work(
        &mut self,
        service: &mut SamplerService,
        wait: Duration,
    ) -> ControlFlow<LoopEnd> {
        if self.has_stopped {
            self.calls_after_stop += 1;
        }
        self.wait_count += 1;
        let sent_count = self.sent.len();
        if let Some((_, fs_root)) = self
            .root_change
            .take_if(|(after_count, _)| *after_count == sent_count)
        {
            service.sampler.set_fs_root(fs_root);
        }
        if let Some((_, suspend_usec)) = self
            .suspend
            .take_if(|(after_count, _)| *after_count == sent_count)
        {
            self.suspended_usec
                .set(self.suspended_usec.get() + suspend_usec);
        }
        let stall_usec = self
            .stall
            .take_if(|(after_count, _)| *after_count == sent_count)
            .map_or(0, |(_, stall_usec)| stall_usec);
        let waited_usec = u64::try_from(wait.as_micros()).unwrap() + stall_usec;
        self.monotonic_usec
            .set(self.monotonic_usec.get() + waited_usec);
        ControlFlow::Continue(())
    }
}

///
/// The tick loop is the timer: one schedule however it runs, so over ten seconds at two it ticks
/// on each slot once, never twice; when its outlet ends it, it returns, and nothing is asked of the
/// outlet after.
#[test]
fn the_tick_loop_keeps_one_schedule_ends_when_stopped_and_runs_nothing_after() {
    let mut test_service = TestService::at_fixture("root-a", &[]);
    let mut outlet = ScriptedOutlet::new(&test_service.monotonic_usec, 6);
    test_service.service.initialize();
    let loop_end = run_tick_loop(&mut test_service.service, INTERVAL_USEC, &mut outlet);
    assert_eq!(
        (
            outlet.sent_at_seconds(),
            outlet.tick_numbers(),
            matches!(loop_end, LoopEnd::BusGone),
            outlet.after_first_tick_count,
            outlet.calls_after_stop,
            test_service.service.ticks_run,
        ),
        (
            vec![0.0, 2.0, 4.0, 6.0, 8.0, 10.0],
            vec![0, 1, 2, 3, 4, 5],
            true,
            1,
            0,
            6
        )
    );
}

#[test]
fn the_first_tick_runs_at_once_with_memory_and_cpu_follows_one_interval_later() {
    let mut test_service = TestService::at_fixture("root-a", &[]);
    let mut outlet = ScriptedOutlet::new(&test_service.monotonic_usec, 2);
    outlet.root_change = Some((1, fixture_root("root-b")));
    test_service.service.initialize();
    run_tick_loop(&mut test_service.service, INTERVAL_USEC, &mut outlet);
    let first = &outlet.sent[0];
    let second = &outlet.sent[1];
    assert_eq!(
        (
            first.waits_before,
            first.sample["snapshot"]["memory"].is_object(),
            first.sample["snapshot"]["cpuBusyPercent"].clone(),
            second.sample["snapshot"]["cpuBusyPercent"].is_number(),
            outlet.calls_after_stop,
            test_service.service.ticks_run,
        ),
        (0, true, Value::Null, true, 0, 2)
    );
}

/// A panic inside a tick is caught, logged under one key, and the next tick publishes: ticks 0 and
/// 1 panic (their wall-clock reads do; the first read is the start time), each is caught, the two
/// are one line under "tick failed" (the key is rate-limited), with the panic's place, and tick 2
/// publishes.
#[test]
fn a_panic_inside_a_tick_is_caught_logged_under_one_key_and_the_next_tick_publishes() {
    install_panic_hook();
    let mut test_service = TestService::at_fixture("root-a", &[2, 3]);
    let mut outlet = ScriptedOutlet::new(&test_service.monotonic_usec, 1);
    test_service.service.initialize();
    run_tick_loop(&mut test_service.service, INTERVAL_USEC, &mut outlet);
    let logged = test_service.logged();
    let (logged_message, panic_location) = logged[0].rsplit_once(" at ").unwrap();
    assert_eq!(
        (
            logged.len(),
            logged_message,
            panic_source_file(panic_location),
            outlet.tick_numbers(),
            outlet.sent_at_seconds(),
            outlet.sent[0].sample["sequence"].clone(),
        ),
        (
            1,
            format!("{LOG_PREFIX} tick failed: {WALL_CLOCK_PANIC_MESSAGE}").as_str(),
            Some(WALL_CLOCK_PANIC_FILE),
            vec![2],
            vec![4.0],
            Value::from(1)
        )
    );
}

/// The rule "a tick's number counts ticks run, not schedule slots": the ticks at 0 and 2 s are
/// followed by a 7 s stall, which wakes the loop at 9.3 s; it runs one tick there, numbered one
/// more than the last (as gjs numbers the tick it runs after a stall), and the next on the grid, at
/// 10 s.
#[test]
fn after_a_7_second_stall_one_tick_runs_numbered_one_more_and_the_grid_holds() {
    let mut test_service = TestService::at_fixture("root-a", &[]);
    let mut outlet = ScriptedOutlet::new(&test_service.monotonic_usec, 4);
    outlet.stall = Some((2, STALL_BEYOND_WAIT_USEC));
    test_service.service.initialize();
    run_tick_loop(&mut test_service.service, INTERVAL_USEC, &mut outlet);
    assert_eq!(
        (outlet.sent_at_seconds(), outlet.tick_numbers()),
        (vec![0.0, 2.0, 9.3, 10.0], vec![0, 1, 2, 3])
    );
}

/// Which values of each of the state's five histories are gaps, oldest first: CPU, memory, then the
/// three pressure histories.
fn gaps_in_each_history(test_service: &TestService) -> Vec<Vec<bool>> {
    let state = parse_json(
        &test_service
            .service
            .face
            .state_text(&test_service.service.sampler),
    );
    let histories = &state["histories"];
    [
        &histories["cpu"],
        &histories["memory"],
        &histories["pressureAvg10"]["cpu"],
        &histories["pressureAvg10"]["memory"],
        &histories["pressureAvg10"]["io"],
    ]
    .iter()
    .map(|history| {
        history
            .as_array()
            .expect("a history is a list")
            .iter()
            .map(Value::is_null)
            .collect()
    })
    .collect()
}

/// The stall row's ticks again: the tick at 9.3 s, in the slot of 8 s, says it missed the two
/// slots of 4 and 6 s, and every history holds two gaps between the values of the ticks at 2 and
/// 9.3 s. CPU is a gap at every tick: root-a's counters never move, so each tick reads no CPU.
#[test]
fn after_a_7_second_stall_the_next_tick_says_it_missed_two_and_every_history_holds_their_gaps() {
    let mut test_service = TestService::at_fixture("root-a", &[]);
    let mut outlet = ScriptedOutlet::new(&test_service.monotonic_usec, 4);
    outlet.stall = Some((2, STALL_BEYOND_WAIT_USEC));
    test_service.service.initialize();
    run_tick_loop(&mut test_service.service, INTERVAL_USEC, &mut outlet);
    let stall_gaps = vec![false, false, true, true, false, false];
    let cpu_gaps = vec![true; stall_gaps.len()];
    assert_eq!(
        (
            outlet.missed_tick_counts(),
            gaps_in_each_history(&test_service)
        ),
        (
            [0, 0, 2, 0].map(Value::from).to_vec(),
            vec![
                cpu_gaps,
                stall_gaps.clone(),
                stall_gaps.clone(),
                stall_gaps.clone(),
                stall_gaps
            ]
        )
    );
}

/// A suspend: the machine sleeps 8.5 s during the wait after the tick at 2 s. The monotonic clock
/// stops, so the next tick runs at 4 s on its grid as if nothing happened; the boot clock went on,
/// so that tick says it missed the four whole intervals slept, and every history holds four gaps.
/// The half interval left over misses nothing at the tick after. CPU is a gap at every tick, as in
/// the stall row.
#[test]
fn after_a_suspend_the_next_tick_says_it_missed_the_intervals_slept_and_every_history_holds_them() {
    let mut test_service = TestService::at_fixture("root-a", &[]);
    let mut outlet = ScriptedOutlet::new(&test_service.monotonic_usec, 4);
    outlet.suspend = Some((2, SUSPEND_USEC));
    outlet.suspended_usec = Rc::clone(&test_service.suspended_usec);
    test_service.service.initialize();
    run_tick_loop(&mut test_service.service, INTERVAL_USEC, &mut outlet);
    let suspend_gaps = vec![false, false, true, true, true, true, false, false];
    let cpu_gaps = vec![true; suspend_gaps.len()];
    assert_eq!(
        (
            outlet.sent_at_seconds(),
            outlet.missed_tick_counts(),
            gaps_in_each_history(&test_service)
        ),
        (
            vec![0.0, 2.0, 4.0, 6.0],
            [0, 0, 4, 0].map(Value::from).to_vec(),
            vec![
                cpu_gaps,
                suspend_gaps.clone(),
                suspend_gaps.clone(),
                suspend_gaps.clone(),
                suspend_gaps
            ]
        )
    );
}

/// A service ticked by hand, with no tick loop, has no grid: it counts no tick as missed, however
/// far apart its ticks and whatever its boot clock says.
#[test]
fn a_service_ticked_without_the_tick_loop_misses_nothing() {
    let mut test_service = TestService::at_fixture("root-a", &[]);
    let first_tick = test_service.tick();
    test_service.advance_clock(HOUR_USEC);
    test_service.suspended_usec.set(HOUR_USEC);
    let second_tick = test_service.tick();
    assert_eq!(
        [first_tick, second_tick]
            .map(|sample| sample["appendedHistory"]["missedTickCount"].clone()),
        [Value::from(0), Value::from(0)]
    );
}

/// Each Sample's `sampledAtUsec` is the wall clock's reading, wherever it was set,
/// backwards included, and so is the state's `latestSampledAtUsec`; nothing panics and no figure is
/// negative. (A wall clock set before the epoch reads as 0: `real_ports`' clock rows.)
#[test]
fn sampled_at_usec_follows_the_wall_clock_when_it_is_set_backwards() {
    let mut test_service = TestService::at_fixture("root-a", &[]);
    let mut sampled_at = Vec::new();
    let mut sample_texts = Vec::new();
    for real_usec in [
        SERVICE_STARTED_AT_USEC + 2 * SECOND_USEC,
        SERVICE_STARTED_AT_USEC - HOUR_USEC,
        0,
    ] {
        test_service.real_usec.set(real_usec);
        test_service.advance_clock(INTERVAL_USEC);
        let sample_text = test_service.service.run_tick().unwrap();
        sampled_at.push(parse_json(&sample_text)["sampledAtUsec"].clone());
        sample_texts.push(sample_text);
    }
    let state = parse_json(
        &test_service
            .service
            .face
            .state_text(&test_service.service.sampler),
    );
    let has_negative_figure = sample_texts.iter().any(|text| {
        [":-", ",-", "[-"]
            .iter()
            .any(|marker| text.contains(marker))
    });
    assert_eq!(
        (
            sampled_at,
            state["latestSampledAtUsec"].clone(),
            state["serviceStartedAtUsec"].clone(),
            has_negative_figure,
        ),
        (
            vec![
                Value::from(SERVICE_STARTED_AT_USEC + 2 * SECOND_USEC),
                Value::from(SERVICE_STARTED_AT_USEC - HOUR_USEC),
                Value::from(0)
            ],
            Value::from(0),
            Value::from(SERVICE_STARTED_AT_USEC),
            false
        )
    );
}

/// The rule "one row composes the real `DesktopNameLookup` with the sampler": root-a's
/// `app-com.google.Chrome-*.scope` leaves are named by the `.desktop` file of the id the sampler
/// forms, found where the environment's data directories point, through the very ports the program
/// builds (with the rows' clock).
#[test]
fn the_real_name_lookup_names_an_app_from_the_desktop_file_of_the_id_the_sampler_forms() {
    let data_home = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/program-desktop");
    let environment_values: HashMap<&str, String> = HashMap::from([
        ("XDG_DATA_HOME", data_home.display().to_string()),
        (
            "XDG_DATA_DIRS",
            data_home.join("no-such-dir").display().to_string(),
        ),
        ("LANG", "C".to_string()),
    ]);
    let environment = |name: &str| environment_values.get(name).cloned();
    let ports = real_sampler_ports(desktop_name_lookup(&environment), record_log_line);
    let mut test_service = TestService::with_resolver("root-a", &[], Box::new(|_| None));
    test_service.service.sampler = Sampler::new(
        fixture_root("root-a"),
        SamplerPorts {
            clock: Box::new(SettableClock::with_fixed_label(Rc::clone(
                &test_service.monotonic_usec,
            ))),
            ..ports
        },
    );
    test_service.service.initialize();
    let sample = test_service.tick();
    let chrome_names: Vec<Value> = sample["snapshot"]["apps"]["memoryRanking"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|entry| entry["groupKey"] == CHROME_GROUP_KEY)
        .map(|entry| entry["name"].clone())
        .collect();
    assert_eq!(chrome_names, vec![Value::from(FIXTURE_DESKTOP_NAME)]);
}
