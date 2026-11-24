//! The leaf names whose descriptions pin `describeCgroup`'s patterns, each with what it gave for
//! it under gjs: the expected values of the rows in `js_patterns.rs`.

/// A leaf name with what `describeCgroup` gives for it under gjs: (leaf, kind summary, group key,
/// fallback name). The kind summary is `app:<appId>`, `snap:<snapName>/<snapAppName>`, `docker` or
/// `unit`.
pub(super) type DescribedLeaf = (&'static str, &'static str, &'static str, &'static str);

/// App scopes: the launcher backtracks, digits are ASCII, a line terminator breaks `.`.
pub(super) const APP_SCOPE_EDGES: [DescribedLeaf; 13] = [
    ("app-gnome-1.scope", "app:gnome", "app:gnome", "Gnome"),
    ("app-gnome--5.scope", "app:gnome-", "app:gnome-", "Gnome-"),
    ("app--5.scope", "unit", "unit:app--5", "app--5"),
    ("app-foo-12-34.scope", "app:foo-12", "app:foo-12", "Foo-12"),
    (
        "app-foo-bar.scope",
        "unit",
        "unit:app-foo-bar",
        "app-foo-bar",
    ),
    (
        "app-foo-5.scope\u{a}",
        "unit",
        "unit:app-foo-5.scope\u{a}",
        "app-foo-5.scope\u{a}",
    ),
    (
        "app-fo\u{a}o-5.scope",
        "unit",
        "unit:app-fo\u{a}o-5.scope",
        "app-fo\u{a}o-5.scope",
    ),
    (
        "app-a\\x0ab-5.scope",
        "app:a\u{a}b",
        "app:a\u{a}b",
        "A\u{a}b",
    ),
    (
        "app-flatpak-1.scope",
        "app:flatpak",
        "app:flatpak",
        "Flatpak",
    ),
    ("app-kde-x-1.scope", "app:x", "app:x", "X"),
    (
        "app-gnome-flatpak-x-1.scope",
        "app:flatpak-x",
        "app:flatpak-x",
        "Flatpak-x",
    ),
    (
        "app-foo-5.scopes",
        "unit",
        "unit:app-foo-5.scopes",
        "app-foo-5.scopes",
    ),
    (
        "app-foo-\u{663}.scope",
        "unit",
        "unit:app-foo-\u{663}",
        "app-foo-\u{663}",
    ),
];
/// Snaps: the lazy app name, the lowercase-only uuid, a dot in the app name.
pub(super) const SNAP_EDGES: [DescribedLeaf; 14] = [
    (
        "snap.slack.slack-6dac35ea-863e-4f4f-a9a2-1c50d93840a1.scope",
        "snap:slack/slack",
        "snap:slack",
        "slack",
    ),
    ("snap.foo.bar.service", "snap:foo/bar", "snap:foo", "foo"),
    (
        "snap.foo.bar.baz.service",
        "snap:foo/foo",
        "snap:foo",
        "foo",
    ),
    (
        "snap.foo.-6dac35ea-863e-4f4f-a9a2-1c50d93840a1.scope",
        "snap:foo/-6dac35ea-863e-4f4f-a9a2-1c50d93840a1",
        "snap:foo",
        "foo",
    ),
    (
        "snap.foo.bar-6DAC35EA-863E-4F4F-A9A2-1C50D93840A1.scope",
        "snap:foo/bar-6DAC35EA-863E-4F4F-A9A2-1C50D93840A1",
        "snap:foo",
        "foo",
    ),
    (
        "snap.foo.bar-6dac35ea-863e-4f4f-a9a2-1c50d93840a1.service",
        "snap:foo/bar",
        "snap:foo",
        "foo",
    ),
    ("snap.foo.bar.scope", "snap:foo/bar", "snap:foo", "foo"),
    ("snap.foo.bar", "snap:foo/foo", "snap:foo", "foo"),
    ("snap.foo.", "snap:foo/foo", "snap:foo", "foo"),
    (
        "snap.foo\u{a}.x.scope",
        "snap:foo\u{a}/x",
        "snap:foo\u{a}",
        "foo\u{a}",
    ),
    ("snap..x.scope", "unit", "unit:snap..x", "snap..x"),
    ("snap.a\\x2eb.x.scope", "snap:a/a", "snap:a", "a"),
    (
        "snap.foo.a-b-6dac35ea-863e-4f4f-a9a2-1c50d93840a1.scope",
        "snap:foo/a-b",
        "snap:foo",
        "foo",
    ),
    (
        "snap.foo.6dac35ea-863e-4f4f-a9a2-1c50d93840a1-6dac35ea-863e-4f4f-a9a2-1c50d93840a1.scope",
        "snap:foo/6dac35ea-863e-4f4f-a9a2-1c50d93840a1",
        "snap:foo",
        "foo",
    ),
];
/// Docker scopes: `^docker-.*\\.scope$`.
pub(super) const DOCKER_EDGES: [DescribedLeaf; 6] = [
    ("docker-.scope", "docker", "docker:docker", "docker"),
    (
        "docker-abc\u{a}.scope",
        "unit",
        "unit:docker-abc\u{a}.scope",
        "docker-abc\u{a}.scope",
    ),
    ("docker-scope", "unit", "unit:docker-scope", "docker-scope"),
    ("docker.scope", "unit", "unit:docker", "docker"),
    ("docker-a.b.scope", "docker", "docker:docker", "docker"),
    (
        "docker-a\\x0a.scope",
        "unit",
        "unit:docker-a\u{a}.scope",
        "docker-a\u{a}.scope",
    ),
];
/// Units: the lazy `(.+?)`, the optional `@.*` instance, the suffix, line terminators.
pub(super) const UNIT_EDGES: [DescribedLeaf; 12] = [
    ("a@b@c.service", "unit", "unit:a", "a"),
    ("@foo.service", "unit", "unit:@foo", "@foo"),
    ("a@.service", "unit", "unit:a", "a"),
    (".service", "unit", "unit:.service", ".service"),
    ("x.service.scope", "unit", "unit:x.service", "x.service"),
    (
        "a@b\u{a}.service",
        "unit",
        "unit:a@b\u{a}.service",
        "a@b\u{a}.service",
    ),
    ("user@1000.service", "unit", "unit:user", "user"),
    ("a\\x40b.service", "unit", "unit:a", "a"),
    (
        "a@b\u{2028}c.service",
        "unit",
        "unit:a@b\u{2028}c.service",
        "a@b\u{2028}c.service",
    ),
    ("plain", "unit", "unit:plain", "plain"),
    ("a.mount", "unit", "unit:a.mount", "a.mount"),
    ("a@b.scope.service", "unit", "unit:a", "a"),
];
/// Display names of units: aliases, settings daemons, reverse DNS.
pub(super) const UNIT_DISPLAY_EDGES: [DescribedLeaf; 15] = [
    (
        "org.gnome.SettingsDaemon.\u{130}stanbul.service",
        "unit",
        "unit:org.gnome.SettingsDaemon.\u{130}stanbul",
        "gsd-i\u{307}stanbul",
    ),
    (
        "org.gnome.SettingsDaemon.\u{391}\u{3a3}.service",
        "unit",
        "unit:org.gnome.SettingsDaemon.\u{391}\u{3a3}",
        "gsd-\u{3b1}\u{3c2}",
    ),
    (
        "org.gnome.SettingsDaemon..service",
        "unit",
        "unit:org.gnome.SettingsDaemon.",
        "gsd-",
    ),
    (
        "org.gnome.SettingsDaemon.service",
        "unit",
        "unit:org.gnome.SettingsDaemon",
        "SettingsDaemon",
    ),
    (
        "org.gnome.Shell.service",
        "unit",
        "unit:org.gnome.Shell",
        "GNOME Shell",
    ),
    (
        "org.gnome.Shell@x11.service",
        "unit",
        "unit:org.gnome.Shell",
        "GNOME Shell",
    ),
    ("org.foo.service", "unit", "unit:org.foo", "org.foo"),
    ("org.foo.bar.service", "unit", "unit:org.foo.bar", "bar"),
    ("com.a.b.c.service", "unit", "unit:com.a.b.c", "b.c"),
    ("io.x..service", "unit", "unit:io.x.", ""),
    (
        "Org.foo.bar.service",
        "unit",
        "unit:Org.foo.bar",
        "Org.foo.bar",
    ),
    ("toString.service", "unit", "unit:toString", "toString"),
    ("__proto__.service", "unit", "unit:__proto__", "__proto__"),
    ("net.a.b.scope", "unit", "unit:net.a.b", "b"),
    (
        "herdr-server@x.service",
        "unit",
        "unit:herdr-server",
        "herdr agents",
    ),
];
/// Fallback names of apps: `charAt(0).toUpperCase()` on the last id segment.
pub(super) const CAPITALISED_FALLBACK_EDGES: [DescribedLeaf; 12] = [
    (
        "app-org.example.\u{df}tool-1.scope",
        "app:org.example.\u{df}tool",
        "app:org.example.\u{df}tool",
        "SStool",
    ),
    (
        "app-\u{10428}x-1.scope",
        "app:\u{10428}x",
        "app:\u{10428}x",
        "\u{10428}x",
    ),
    (
        "app-\u{e9}a-1.scope",
        "app:\u{e9}a",
        "app:\u{e9}a",
        "\u{c9}a",
    ),
    ("app-a.-1.scope", "app:a.", "app:a.", ""),
    (
        "app-.hidden-1.scope",
        "app:.hidden",
        "app:.hidden",
        "Hidden",
    ),
    (
        "app-\u{fb01}sh-1.scope",
        "app:\u{fb01}sh",
        "app:\u{fb01}sh",
        "FIsh",
    ),
    (
        "app-\\xb5x-1.scope",
        "app:\u{b5}x",
        "app:\u{b5}x",
        "\u{39c}x",
    ),
    (
        "app-\\xffx-1.scope",
        "app:\u{ff}x",
        "app:\u{ff}x",
        "\u{178}x",
    ),
    ("app-\\xdfx-1.scope", "app:\u{df}x", "app:\u{df}x", "SSx"),
    (
        "app-\u{1c6}x-1.scope",
        "app:\u{1c6}x",
        "app:\u{1c6}x",
        "\u{1c4}x",
    ),
    (
        "app-\u{149}x-1.scope",
        "app:\u{149}x",
        "app:\u{149}x",
        "\u{2bc}Nx",
    ),
    ("app-\u{131}x-1.scope", "app:\u{131}x", "app:\u{131}x", "Ix"),
];
