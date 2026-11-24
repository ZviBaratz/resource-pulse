//! Where the naming follows JavaScript's patterns: each table of `described_leaves.rs` is
//! described as `describeCgroup` described it under gjs.

use super::described_leaves::{
    DescribedLeaf, APP_SCOPE_EDGES, CAPITALISED_FALLBACK_EDGES, DOCKER_EDGES, SNAP_EDGES,
    UNIT_DISPLAY_EDGES, UNIT_EDGES,
};
use super::*;

/// The kind summary [`DescribedLeaf`] uses.
fn kind_summary(description: &CgroupDescription) -> String {
    match &description.kind {
        CgroupKind::App { app_id } => format!("app:{app_id}"),
        CgroupKind::Snap {
            snap_name,
            snap_app_name,
        } => format!("snap:{snap_name}/{snap_app_name}"),
        CgroupKind::Docker => "docker".to_string(),
        CgroupKind::Unit => "unit".to_string(),
    }
}

/// Asserts `describe_cgroup` gives each table row's kind, group key and fallback name.
fn assert_described_as_under_gjs(rows: &[DescribedLeaf]) {
    for (leaf, expected_kind, expected_group_key, expected_fallback_name) in rows {
        let description = describe_cgroup(leaf);
        assert_eq!(
            kind_summary(&description),
            *expected_kind,
            "kind of {leaf:?}"
        );
        assert_eq!(
            description.group_key, *expected_group_key,
            "group key of {leaf:?}"
        );
        assert_eq!(
            description.fallback_name, *expected_fallback_name,
            "fallback name of {leaf:?}"
        );
    }
}

/// App scope names: `^app-(?:(?:gnome|flatpak|kde|dbus|systemd)-)?(.+)-\d+\.scope$`.
#[test]
fn app_scope_names_match_the_javascript_patterns() {
    assert_described_as_under_gjs(&APP_SCOPE_EDGES);
}

/// Snap names and the lazy snap app name.
#[test]
fn snap_names_match_the_javascript_patterns() {
    assert_described_as_under_gjs(&SNAP_EDGES);
}

/// Docker scopes: `^docker-.*\.scope$`.
#[test]
fn docker_scopes_match_the_javascript_pattern() {
    assert_described_as_under_gjs(&DOCKER_EDGES);
}

/// Units: `^(.+?)(?:@.*)?\.(?:service|scope)$`.
#[test]
fn units_match_the_javascript_pattern() {
    assert_described_as_under_gjs(&UNIT_EDGES);
}

/// Display names of units, including the case mapping of `toLowerCase` for `İ` and the final sigma.
#[test]
fn unit_display_names_match_the_javascript_function() {
    assert_described_as_under_gjs(&UNIT_DISPLAY_EDGES);
}

/// The fallback name of an app: `charAt(0).toUpperCase() + slice(1)` of the last id segment.
#[test]
fn app_fallback_names_are_capitalised_as_javascript_does() {
    assert_described_as_under_gjs(&CAPITALISED_FALLBACK_EDGES);
}
