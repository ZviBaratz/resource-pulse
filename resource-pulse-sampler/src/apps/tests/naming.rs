//! App naming: what `describe_cgroup` makes of a leaf name, what `display_name_for` asks the
//! resolver and falls back to, `unescape_systemd_name`, and that no leaf name built from the
//! patterns' pieces panics them.

use super::*;

/// The `appId` of a described app, `None` for any other kind.
fn app_id_of(description: &CgroupDescription) -> Option<&str> {
    match &description.kind {
        CgroupKind::App { app_id } => Some(app_id),
        _ => None,
    }
}

/// Runs `display_name_for` with a resolver that answers `answer` and records what it was asked.
fn display_name_asking(
    description: &CgroupDescription,
    answer: Option<&str>,
) -> (String, Vec<String>) {
    let mut asked = Vec::new();
    let mut resolve_app_name = |desktop_id: &str| {
        asked.push(desktop_id.to_string());
        answer.map(str::to_string)
    };
    let name = display_name_for(description, &mut resolve_app_name);
    (name, asked)
}

#[test]
fn chromium_scope_is_app_org_chromium_chromium() {
    let description = describe_cgroup("app-org.chromium.Chromium-50164.scope");
    assert_eq!(app_id_of(&description), Some("org.chromium.Chromium"));
}

#[test]
fn gnome_launcher_with_an_escaped_id() {
    let description = describe_cgroup("app-gnome-example\\x2dvpn\\x2dclient-59401.scope");
    assert_eq!(app_id_of(&description), Some("example-vpn-client"));
}

#[test]
fn snap_scope_is_the_snap_name() {
    let description =
        describe_cgroup("snap.slack.slack-6dac35ea-863e-4f4f-a9a2-1c50d93840a1.scope");
    assert_eq!(description.fallback_name, "slack");
}

#[test]
fn the_launcher_is_matched_before_unescaping() {
    let description = describe_cgroup("app-gnome\\x2dcalculator-1234.scope");
    assert_eq!(app_id_of(&description), Some("gnome-calculator"));
}

#[test]
fn a_gnome_settings_daemon_is_named_gsd_x_in_lowercase() {
    let description = describe_cgroup("org.gnome.SettingsDaemon.Power.service");
    assert_eq!(description.fallback_name, "gsd-power");
}

#[test]
fn another_reverse_dns_unit_drops_its_first_two_segments() {
    let description = describe_cgroup("org.freedesktop.IBus.session.GNOME.service");
    assert_eq!(description.fallback_name, "IBus.session.GNOME");
}

#[test]
fn a_snap_asks_the_resolver_for_snap_app_desktop_and_falls_back_to_the_snap_name() {
    let description =
        describe_cgroup("snap.slack.slack-6dac35ea-863e-4f4f-a9a2-1c50d93840a1.scope");
    let (resolved, asked) = display_name_asking(&description, Some("Slack Desktop"));
    let (fallback, _) = display_name_asking(&description, None);
    assert_eq!(asked, ["slack_slack.desktop"]);
    assert_eq!(resolved, "Slack Desktop");
    assert_eq!(fallback, "slack");
}

#[test]
fn herdr_service_is_herdr_agents() {
    let description = describe_cgroup("herdr-server.service");
    assert_eq!(description.fallback_name, "herdr agents");
}

#[test]
fn templated_unit_drops_its_instance() {
    let description = describe_cgroup("gnome-session-manager@ubuntu.service");
    assert_eq!(description.fallback_name, "gnome-session-manager");
}

#[test]
fn docker_scopes_group_as_one_docker() {
    let first = describe_cgroup("docker-0123abcd.scope");
    let second = describe_cgroup("docker-89ef.scope");
    assert_eq!(first.group_key, second.group_key);
}

#[test]
fn display_name_falls_back_to_the_capitalised_last_id_segment() {
    let description = describe_cgroup("app-org.chromium.Chromium-1.scope");
    let (name, _) = display_name_asking(&description, None);
    assert_eq!(name, "Chromium");
}

#[test]
fn every_xnn_escape_is_unescaped_not_just_the_first() {
    assert_eq!(unescape_systemd_name("a\\x2db\\x2dc"), "a-b-c");
    assert_eq!(unescape_systemd_name("plain.service"), "plain.service");
}

#[test]
fn a_launcherless_app_id_keeps_its_hyphen_a_flatpak_launcher_is_stripped() {
    let launcherless = describe_cgroup("app-my-tool-12.scope");
    let flatpak = describe_cgroup("app-flatpak-org.mozilla.firefox-9.scope");
    assert_eq!(app_id_of(&launcherless), Some("my-tool"));
    assert_eq!(app_id_of(&flatpak), Some("org.mozilla.firefox"));
}

#[test]
fn the_resolver_answer_for_app_id_desktop_wins_over_the_fallback() {
    let description = describe_cgroup("app-gnome-alacritty-66279.scope");
    let (name, asked) = display_name_asking(&description, Some("Alacritty Terminal"));
    assert_eq!(name, "Alacritty Terminal");
    assert_eq!(asked, ["alacritty.desktop"]);
}

#[test]
fn a_non_app_kind_ignores_the_resolver() {
    let description = describe_cgroup("dbus.service");
    let (name, asked) = display_name_asking(&description, Some("WRONG"));
    assert_eq!(name, "dbus");
    assert!(asked.is_empty(), "the resolver was asked {asked:?}");
}

/// An escaped non-ASCII byte becomes one character per byte, as it always has.
/// Expected value: `unescapeSystemdName` run under gjs, U+00C3 U+00A9, never the one character `é`
/// the two bytes spell in UTF-8.
#[test]
fn an_escaped_non_ascii_byte_becomes_one_character_per_byte_as_today() {
    assert_eq!(
        unescape_systemd_name("caf\\xc3\\xa9.service"),
        "caf\u{00C3}\u{00A9}.service"
    );
}

/// `\x` followed by fewer than two hex digits, by a non-hex digit or by nothing is left alone;
/// both letter cases decode; a doubled backslash leaves the second one to start the escape; a
/// matched escape is not rescanned. Expected values: `unescapeSystemdName` run under gjs.
#[test]
fn only_a_backslash_x_and_two_hex_digits_is_an_escape() {
    let cases = [
        ("\\x4", "\\x4"),
        ("\\xZZ", "\\xZZ"),
        ("\\\\x41", "\\A"),
        ("\\\\\\x41", "\\\\A"),
        ("\\x", "\\x"),
        ("a\\x", "a\\x"),
        ("\\xC3\\xa9", "\u{c3}\u{a9}"),
        ("\\x00", "\u{0}"),
        ("\\x41\\x4", "A\\x4"),
        ("\\x4a\\x4A", "JJ"),
        ("\\x\\x41", "\\xA"),
        ("\\xx41", "\\xx41"),
    ];
    for (escaped, expected) in cases {
        assert_eq!(unescape_systemd_name(escaped), expected, "{escaped:?}");
    }
}

/// A resolver answer that is the empty string, or no answer, gives the fallback (`||`); the
/// resolver is asked once, and for a snap by `<snap>_<app>.desktop`. Expected values:
/// `displayNameFor` run under gjs.
#[test]
fn an_empty_resolver_answer_falls_back_like_no_answer() {
    let app = describe_cgroup("app-gnome-alacritty-1.scope");
    let snap = describe_cgroup("snap.foo.bar.service");
    assert_eq!(display_name_asking(&app, Some("")).0, "Alacritty");
    assert_eq!(display_name_asking(&app, None).0, "Alacritty");
    assert_eq!(display_name_asking(&snap, Some("")).0, "foo");
    assert_eq!(display_name_asking(&snap, Some("X")).0, "X");
    assert_eq!(display_name_asking(&snap, None).1, ["foo_bar.desktop"]);
}

/// How many pseudo-random leaf names the no-panic row feeds the naming functions.
const NO_PANIC_NAME_COUNT: usize = 5000;
/// The pieces the no-panic row builds names from: the ones every pattern of `describeCgroup` reads.
const NO_PANIC_PIECES: [&str; 24] = [
    "app-",
    "gnome",
    "-",
    ".scope",
    ".service",
    "snap.",
    "docker-",
    "@",
    ".",
    "\\x",
    "4",
    "z",
    "0",
    "\n",
    "\u{2028}",
    "\u{1F600}",
    "\u{e9}",
    "-1",
    "-6dac35ea-863e-4f4f-a9a2-1c50d93840a1",
    "org.gnome.SettingsDaemon.",
    "org",
    "\u{130}",
    "\u{3a3}",
    "",
];
/// A fixed seed, so a failure repeats.
const NO_PANIC_SEED: u64 = 0x2545_F491_4F6C_DD1D;
/// The most pieces one pseudo-random name is built from.
const NO_PANIC_MAX_PIECES: u64 = 9;

/// A step of xorshift64: the pseudo-random sequence of the no-panic row.
fn next_pseudo_random(state: u64) -> u64 {
    let mut next = state;
    next ^= next << 13;
    next ^= next >> 7;
    next ^ (next << 17)
}

/// Every function that reads a leaf name survives a name built from the pieces of its patterns,
/// and each description's names are consistent: an app's key is `app:` and its id, and so on.
#[test]
fn no_leaf_name_made_of_pattern_pieces_panics_the_naming_functions() {
    let mut state = NO_PANIC_SEED;
    for _ in 0..NO_PANIC_NAME_COUNT {
        state = next_pseudo_random(state);
        let piece_count = state % NO_PANIC_MAX_PIECES;
        let mut leaf_name = String::new();
        for _ in 0..piece_count {
            state = next_pseudo_random(state);
            let piece_index = usize::try_from(state % NO_PANIC_PIECES.len() as u64).unwrap();
            leaf_name.push_str(NO_PANIC_PIECES[piece_index]);
        }
        let description = describe_cgroup(&leaf_name);
        let (name, _) = display_name_asking(&description, Some("resolved"));
        let _ = unescape_systemd_name(&leaf_name);
        match &description.kind {
            CgroupKind::App { app_id } => {
                assert_eq!(
                    description.group_key,
                    format!("app:{app_id}"),
                    "{leaf_name:?}"
                )
            }
            CgroupKind::Snap { snap_name, .. } => {
                assert_eq!(description.group_key, format!("snap:{snap_name}"));
                assert_eq!(name, "resolved");
            }
            CgroupKind::Docker => assert_eq!(description.group_key, "docker:docker"),
            CgroupKind::Unit => assert!(description.group_key.starts_with("unit:")),
        }
    }
}
