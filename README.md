# Dash-to-Dock Adaptive

An experimental, AI-assisted fork of
[Dash to Dock](https://github.com/micheleg/dash-to-dock), maintained by Eidrien.
It adds app-centric ordering and interaction for an adaptive GNOME desktop.
This is a genuine GitHub fork with the complete upstream Git history. The
current build is **v110 — Adaptive 8**, tag `extensions.gnome.org-v110`, commit
`2dfae3474d6984b566ef0c3dab1524a675bbba48`.

## Adaptive features

- Order running apps by GNOME usage ranking, aligned with Adaptive Workspace
  Order; optionally prevent manual icon reorder drops.
- **Focus or overview** launcher clicks: focus an unfocused app on its
  workspace, or open Overview when the app is already focused.
- Focus an app's window on hover in Overview, with configurable delay and
  workspace activation that keeps Overview open.
- Prefer app targets when crowded: hide secondary dock items before shrinking
  app icons or resorting to scrolling.
- Tune workspace-scroll delay instead of using upstream's fixed 250ms delay.
- Move the dock to the symmetric opposite edge when another display joins its
  preferred edge, then restore the saved position after disconnect.
- Raise a running app's relevant window after a **200 ms** external-file drag
  over its icon, in Overview or when the dock was already naturally visible.
  Pointer-only dock peeks do not trigger this action.

See [ADAPTIVE-BUILD.md](ADAPTIVE-BUILD.md) for defaults and behavior details.
Disabled adaptive options retain upstream behavior.

## Status and compatibility

The primary user-tested environment is **GNOME Shell 46 on Wayland**, including
a TV at 200% scale and occasional use of a second display. Metadata follows
upstream's supported-version list; this is not a claim that every adaptive
feature has been tested on every listed release. Public availability does not
mean this experimental fork has passed GNOME Extensions review.

Keep only one Dash-to-Dock/Ubuntu Dock implementation enabled at a time.
The Adaptive UUID is `dash-to-dock-adaptive@eidrien.local`; the original settings
schema and gettext domain are retained for existing preferences.

## Install and update with Gitpulsar

The repository root is directly installable. It includes runtime stylesheet
and translations, so a normal Gitpulsar **Pull** does not require Sass or
gettext on the user's machine.

For a new installation:

```sh
git clone https://github.com/IAmEidrien/dash-to-dock-adaptive.git \
  "$HOME/.local/share/gnome-shell/extensions/dash-to-dock-adaptive@eidrien.local"
cd "$HOME/.local/share/gnome-shell/extensions/dash-to-dock-adaptive@eidrien.local"
glib-compile-schemas --strict schemas
```

Log out and back in on Wayland, then enable the extension. Subsequent updates:
pull **this Adaptive repository's `master`**, recompile schemas when they change,
and reload the GNOME session when extension code changes. Existing users of
the old snapshot repository need the one-time branch switch in
[GIT-WORKFLOW.md](GIT-WORKFLOW.md); ordinary Pull cannot join unrelated histories.
The installed directory, extension UUID and saved preferences remain the same.

See [GIT-WORKFLOW.md](GIT-WORKFLOW.md). Do not run `make install` over an
installed Git checkout: it is a copy-based installation target.

## Development and upstream integration

The source build uses Make, GLib schema tools, gettext, Sass (`sassc`, or Dart
Sass with `SASS=dart`), Node for regression tests, and ESLint 9 for the existing
upstream lint configuration.

```sh
make refresh-runtime
make check
glib-compile-schemas --strict --dry-run schemas
```

Commit affected runtime assets after changing Sass or translations. Compiled
GSettings schemas remain local. Source builds outside an installed Git checkout
can use `make install` or `make zip-file`.

[AGENTS.md](AGENTS.md) records the feature contract and contributor workflow.
Upstream releases are integrated deliberately into this fork; users pull our
tested Adaptive branch rather than automatically following upstream `master`.

## Issues and attribution

When reporting an Adaptive-specific problem, include GNOME version, session
type, relevant preferences, and reproduction steps. Upstream attribution and
existing copyright notices are preserved.

Dash to Dock and this derivative fork are distributed under **GPL-2.0-or-later**.
See [COPYING](COPYING). Original authorship belongs to Dash-to-Dock's contributors;
the adaptive additions were developed by Eidrien with AI assistance.
