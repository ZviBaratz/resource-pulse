//! The flags' row: what each flag asks for, and what is refused.

use std::ffi::OsStr;
use std::os::unix::ffi::OsStrExt;

use super::*;

/// The flags, each alone and together; `--print-constants` wins over the run flags; and everything
/// else is refused.
#[test]
fn the_flags_choose_the_mode_and_anything_else_is_refused() {
    let parse = |arguments: &[&[u8]]| {
        let arguments: Vec<OsString> = arguments
            .iter()
            .map(|argument| OsStr::from_bytes(argument).to_os_string())
            .collect();
        parse_arguments(&arguments)
    };
    let settings = |fs_root: &[u8], tick_interval_usec: u64| SamplerSettings {
        fs_root: PathBuf::from(OsStr::from_bytes(fs_root)),
        tick_interval_usec,
    };
    assert_eq!(
        [
            parse(&[]),
            parse(&[b"--print"]),
            parse(&[b"--fs-root", b"/fixture", b"--tick-interval-ms", b"50"]),
            parse(&[b"--print", b"--fs-root", b"/a", b"--fs-root", b"/b\xff"]),
            parse(&[b"--print-constants", b"--print"]),
            parse(&[b"--source-hash"]),
            parse(&[b"--source-hash", b"--source-hash"]),
        ],
        [
            Some(ProgramMode::Serve(settings(
                b"/",
                DEFAULT_TICK_INTERVAL_USEC
            ))),
            Some(ProgramMode::PrintSamples(settings(
                b"/",
                DEFAULT_TICK_INTERVAL_USEC
            ))),
            Some(ProgramMode::Serve(settings(b"/fixture", 50_000))),
            Some(ProgramMode::PrintSamples(settings(
                b"/b\xff",
                DEFAULT_TICK_INTERVAL_USEC
            ))),
            Some(ProgramMode::PrintConstants),
            Some(ProgramMode::PrintSourceHash),
            Some(ProgramMode::PrintSourceHash),
        ]
    );
    let refused: Vec<Option<ProgramMode>> = [
        &[&b"--fs-root"[..]][..],
        &[b"--fs-root", b""],
        &[b"--tick-interval-ms", b"0"],
        &[b"--tick-interval-ms", b"18446744073709552"],
        &[b"--print\xff"],
        &[b"--nonsense"],
    ]
    .iter()
    .map(|arguments| parse(arguments))
    .collect();
    assert!(refused.iter().all(Option::is_none), "{refused:?}");
}

/// One answer per run: two different print-and-exit flags, in either order and with run flags
/// between them, are refused; and `--source-hash` reads nothing, so it is refused beside a flag that
/// says what to read or how fast to tick, however they are ordered.
#[test]
fn two_print_and_exit_flags_are_refused_and_so_is_source_hash_beside_a_run_flag() {
    let parse = |arguments: &[&str]| {
        let arguments: Vec<OsString> = arguments.iter().map(OsString::from).collect();
        parse_arguments(&arguments)
    };
    let refused_calls: [&[&str]; 9] = [
        &["--print-constants", "--source-hash"],
        &["--source-hash", "--print-constants"],
        &["--print-constants", "--print", "--source-hash"],
        &["--source-hash", "--print"],
        &["--print", "--source-hash"],
        &["--source-hash", "--fs-root", "/fixture"],
        &["--fs-root", "/fixture", "--source-hash"],
        &["--source-hash", "--tick-interval-ms", "50"],
        &["--source-hash", "--print-constants", "--source-hash"],
    ];
    for refused_call in refused_calls {
        assert_eq!(parse(refused_call), None, "{refused_call:?}");
    }
}
