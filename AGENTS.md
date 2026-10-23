# Dash-to-Dock Adaptive: contributor and agent instructions

## Identity and baseline

This is Eidrien's adaptive fork of `micheleg/dash-to-dock`, not an independent
dock implementation. The current baseline is upstream
`extensions.gnome.org-v110` (`2dfae3474d6984b566ef0c3dab1524a675bbba48`).
Preserve upstream copyright notices and `COPYING` (GPL-2.0-or-later).
Read `ADAPTIVE-BUILD.md` for the feature contract and `GIT-WORKFLOW.md` for
installation, generated assets, and upstream integration.

The primary user-tested environment is GNOME Shell 46 on Wayland, with a TV
at 200% scale and occasional additional laptop display. Versions listed in
`metadata.json` inherit upstream declarations; they are not evidence that
every adaptive feature was tested on each version. Do not widen support or
claim runtime validation based only on JavaScript parsing.

## Behavior to preserve

- Adaptive launcher ordering groups running apps by their earliest relevant
  workspace, then uses GNOME `AppUsage.compare()`, oldest relevant window
  stable sequence, and deterministic app-ID/name fallback within that group.
  Sticky-only apps follow the active workspace. This dock does not own
  workspace creation, reordering, or maximize-history management; those belong
  to companion extensions.
- Turning adaptive options off must retain upstream behavior. Adaptive mode
  rejects internal reorder drops without relying on private
  `Draggable` internals.
- Crowding starts from the full desired layout at the preferred icon size:
  hide Show Applications/Trash/mounts first, then shrink apps if allowed, then
  scroll. Hidden secondary items must return when space becomes available.
  Do not measure only the already-shrunk or reduced layout; preserve hysteresis.
- `Focus or overview` focuses an unfocused app on its workspace and opens
  Overview when the app is already focused; activation from Overview still
  focuses the window. Preserve single- and multiple-window cases.
- Overview hover focus retains Overview while moving between workspaces;
  leaving an icon cancels the pending timer. Preserve the focused/MRU window
  selection policy and configurable dwell time.
- External file dragging raises a relevant running window after 200 ms over
  its icon. Permit this in Overview or when the dock was already naturally
  visible; a pointer-only reveal must not arm it. Preserve window filtering,
  cancellation, drag monitor cleanup, and packaging of fileDragFocus.js.
- Monitor avoidance changes the effective edge, never the saved preference.
  Use the symmetric opposite (left/right, top/bottom), respect RTL, recalculate
  on monitor changes, restore the preferred side after disconnect, and retain
  the existing multi-monitor opt-out.

## Installation and source boundaries

- Keep UUID `dash-to-dock-adaptive@eidrien.local`, schema ID/path
  `org.gnome.shell.extensions.dash-to-dock`, and gettext domain `dashtodock`.
  Existing GSettings values must remain usable. Do not commit personal settings.
- The repo root is also a directly installable extension checkout. Keep
  `stylesheet.css` and `locale/*/LC_MESSAGES/dashtodock.mo` tracked so Gitpulsar
  Pull updates need no full build. Regenerate affected runtime assets from
  `_stylesheet.scss` and `po/*.po`; do not hand-edit generated stylesheet CSS.
- Do not track `schemas/gschemas.compiled`; compile it locally after schema
  changes. Schema or preference changes must be reflected in both prefs and UI.
- `make install` is for installations outside a Git-managed extension checkout;
  never remove or replace an installed checkout's `.git` directory.

## Checks and cleanup

Run checks appropriate to the files changed:

```sh
make check                         # Node regression checks and ESLint 9
glib-compile-schemas --strict --dry-run schemas
make refresh-runtime               # Sass/gettext/schema build when needed
git diff --check
```

`node --input-type=module --check < file.js` checks syntax without loading GJS
imports. It does not test GNOME Shell behavior. Report tool availability and
any pre-existing lint failures accurately; do not claim unavailable checks passed.

For behavior changes, provide relevant manual GNOME checks: option enabled/off,
Overview open/closed, multiple windows/workspaces, crowded/uncrowded dock, fixed
and adaptive icon sizes, display join/disconnect, and extension disable/re-enable.
Use a subset matching the change rather than repeating the whole matrix blindly.
Signals, GLib sources, injected actors, and overridden methods must be cleaned
up on disable; callbacks firing later are not a substitute for cleanup.

## Upstream updates and delivery

The public fork's working/default branch is `master`, matching upstream. The
old private snapshot repository has its separate `main` history. Do not claim
that history was transferred unchanged or offer an ordinary pull between the
unrelated branches. See GIT-WORKFLOW.md for the one-time branch migration.

Integrate a known upstream release on a development branch and inspect the
adaptive diff. Preserve upstream ancestry; never replace the repo with another
unrelated source snapshot. Shared `master` must remain compatible with ordinary
fast-forward Gitpulsar pulls; do not force-push or routinely rebase published
commits. Keep changes scoped and document new upstream baselines.
Follow the user's current instructions for committing and publishing work.
