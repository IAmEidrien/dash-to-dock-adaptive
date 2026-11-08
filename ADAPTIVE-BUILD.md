# Dash to Dock 110 — Adaptive 11

Experimental GNOME Shell fork based on the official Dash to Dock 110 extension
release (`extensions.gnome.org-v110`, upstream commit `2dfae34`). All changes
from the old Adaptive 7 snapshot are carried onto the actual upstream fork.
The public fork retains upstream ancestry; the private old repository retains
its separate snapshot history. See GIT-WORKFLOW.md for migrating an installed
checkout without deleting that history or changing personal settings.

## Changes

- Hidden/sliding docks suspend Activity sampling and animation, clear old CPU
  state and resume with fresh measurements. Other visible docks retain their
  shared worker and polling cadence. Autohide and intellihide use the existing
  dock-state/mapped lifecycle.
- After revealing a dock, nonzero-delay Activity activation is disarmed until the
  pointer leaves all indicator strips. An icon interior or ordinary dock control
  can rearm it without leaving the dock. Zero-delay Activity remains active only
  while shown. No new user-facing setting is introduced.


- Activity mode takes one extra startup sample **250 ms after its baseline reply**,
  then resumes the saved polling interval. Startup timers and in-flight replies
  are cancelled when the monitoring session ends.
- The rounded Activity capsule now shares **Solid's thickness and edge padding**.
  Idle **Line** uses Solid's renderer, and idle **Metro** adds the existing flat
  launcher style and multi-window shading. Saved Dot/Line values are preserved.


- The experimental indicator style is now **Activity (Experimental)**. Activity
  mode starts from any running indicator's CPU-tooltip region, then stays active
  for every running indicator in that dock until the pointer leaves the dock.
  Ordinary icon hover does not start it. Each dock has its own dwell and state;
  the existing asynchronous sampler remains shared.
- Animation duration now defaults to **1.0 second**, with **0–5 seconds** adjustable
  in **0.1-second** steps. Existing millisecond keys and saved values are retained.
  Lightweight time-aware visual smoothing and a small deadband reduce jitter;
  larger increases remain responsive. Zero duration disables both, and numerical
  tooltips always retain unsmoothed CPU measurements.


- Adaptive 11 follow-up fixes frozen CPU/idle geometry with animations enabled
  by attaching its timeline to the drawing actor's frame clock. Indicator hover
  extends toward the monitor edge. **Hide application tooltip** suppresses the
  CPU tooltip's app title and prevents the ordinary title from reappearing.
  Dwell and initial sampling show **Waiting…**, distinct from actual failure.


- **Adaptive 11** adds **Activity (Experimental)** as the first running-indicator
  style, with dot-to-line CPU activity, shared asynchronous sampling, numeric
  indicator tooltips and conditional preferences. Existing indicator styles and
  saved settings remain available. See [ADAPTIVE-CPU.md](ADAPTIVE-CPU.md) for the
  experimental contract, process-attribution limitations and native validation.
- Dependent preference controls now disappear instead of remaining greyed out.
  This includes monitor selection when showing on all monitors, opacity controls,
  hover details and advanced customization. Hidden values are retained.
- **Scroll switch delay (ms)** now governs both window and workspace scroll
  switching; it is hidden when scrolling is disabled. The existing
  `workspace-scroll-delay` key and saved value are retained; `0` means no delay.


- Adaptive 10.1 fixes dock teardown and transparency-handler ownership, and
  gives launcher reconciliation a dock-owned redraw source. DND still controls
  notification/emblem indicators; launcher order and interaction policy are
  unchanged. See [LIFECYCLE-REGRESSION.md](LIFECYCLE-REGRESSION.md) for the native
  comparison, failure-injection test and remaining diagnostic uncertainty.

- Overview hover navigation now switches workspace by default, with **Also focus
  the application's window** as a separate, default-off option. Existing hover
  enablement and delay values are retained. Mutter may naturally change focus
  while switching workspace; workspace-only mode makes no explicit focus request.
  The old switch-before-focus preference is retained as an unused legacy key.
- **Extend hover targets into dock padding**, off by default, sends empty internal
  padding before/after the application row to its first/last visual launcher.
  It follows either dock axis, retains the hover dwell, and excludes controls,
  screen space outside the dock and window/file dragging. It changes no click
  targets. Leaving the region or Overview, disabling the option or destroying the
  dock cancels its pending hover action.
  Adaptive 10 was tested in isolated GNOME 46 Wayland with real windows and
  virtual pointer input on horizontal and vertical docks. Workspace-only dwell,
  optional focus, padding picking, disabling the option and leaving the dock
  passed. Regression tests additionally cover visual endpoint order and control
  exclusion; the actual preferences UI and ZIP packaging were checked too.

- **Launchers → Launcher visibility…** provides independent floating-window and
  transient/dialog filters, plus an installed-application blacklist in compact
  icon/name rows. Floating means unmaximized, unfullscreened and untiled;
  partial maximization and Mutter's tiled window state remain eligible.
  Window filters remove a running launcher only when no eligible window remains.
  Explicit application entries also hide pinned launchers without changing
  GNOME favorites. All filters default off.
- Unavailable desktop IDs are removed at extension startup by default, using
  desktop-file resolution rather than Shell's running-app cache. Enable
  **Retain unavailable application entries** to preserve them, displayed by ID.
- Adaptive 9 visibility behavior was tested in isolated GNOME 46 Wayland with
  real windows, live maximize/unmaximize and fullscreen changes, application
  blacklist updates, startup retention/pruning and the native GTK app chooser.
  Other declared Shell versions inherit the prior compatibility range and were
  not retested for this update.

- Integrates upstream v110 fixes for dock visibility, shortcut overlays,
  fullscreen unredirection, Overview workspace sizing, effective workspace
  isolation, intellihide boundary tests and menu/window-preview cleanup. Czech
  and Polish runtime translations are refreshed from the v110 sources.
- External file dragging raises the relevant running app window after a
  **200 ms** dwell over its launcher. It works in Overview or when the dock was
  already naturally visible, respecting workspace/monitor isolation and the
  focused/MRU window selection policy. Pointer-only dock reveals do not arm it.
  Leaving an icon, finishing the drag, destroying the icon or disabling the
  extension cancels pending activation. Unused launchers never launch an app.

- Adds **Focus or overview** to launcher click actions: selecting an unfocused application raises a window on its workspace; selecting the focused application opens GNOME Overview. Clicking an icon while the overview is already open activates its window. A single-window application can also open the overview.
- Adds **Adaptive launcher ordering** (enabled by default). Running applications follow their earliest relevant workspace, then GNOME Shell `AppUsage.compare()` within each workspace, followed by the oldest relevant window's stable sequence and app ID/name. Sticky-only apps follow the active workspace.
- Running favorites participate in the dynamic running section; favorites that are not currently relevant/running remain pinned before it. The favorite separator follows the actual static-favorite count.
- Adaptive ordering rejects internal dock icon reorder drops. Existing dock icons may still enter GNOME's drag state; the drop policy avoids version-specific private `Draggable` internals.
- Replaces Dash to Dock's fixed 250 ms scroll-switch dead time with **Scroll switch delay (ms)**. Default: **10 ms**. `0` disables throttling.
- Preserves upstream behavior when adaptive ordering is disabled.
- Adds **Switch workspace on hover in Overview**. This is app-centric and works with grouped icons. A configurable 0–2000 ms delay controls dwell time; `0` navigates immediately. Explicit window focus is optional and defaults off.
- For multi-window applications, hover focus preserves the already-focused window when applicable, otherwise chooses the most-recently-used window on the active workspace, then the most-recently-used window anywhere.
- Workspace navigation uses Mutter workspace activation rather than `Main.activateWindow()`, so Overview stays open. Leaving an icon cancels its pending hover timer. Enabling optional focus adds a focus request after navigation.
- Adds **Prioritize applications when dock is crowded** (disabled by default). The adaptive dock now uses a staged degradation policy: first try the complete requested dock at the user's preferred icon size; if that does not fit, temporarily hide Show Applications, Trash, and mounted volumes/devices; only if the primary application icons still do not fit are they allowed to shrink; scrolling remains the final fallback once even the minimum icon size is insufficient. User preferences and location monitors stay intact, so secondary items return automatically when space is available again.
- Crowding is decided from the full desired layout at the preferred/max icon size even while secondary items are hidden, preventing hide/show oscillation and preventing a previously-shrunk dock from convincing itself that secondary items still fit. A small hysteresis margin avoids one-pixel allocation jitter near the threshold.
- The crowding estimate now measures the complete icon tile, including its theme margins, instead of measuring only its inner button. It also allows for Show Applications' separate tile size, the icon row's spacing, and the separator at the preferred icon size. These gaps previously accumulated until the dock looked crowded while the button remained visible.
- In fixed-icon-size mode this naturally reduces to full-layout → apps-only → scrolling, because icon shrinking is disabled. In adaptive-size mode it becomes full-layout/preferred-size → apps-only/preferred-size → apps-only/shrunk → apps-only/scrolling.

- Adds **Automatically avoid joined monitor edges**. When another display
  adjoins the preferred dock edge, use the symmetrically opposite edge while
  retaining the stored preference. Re-evaluate on monitor changes and restore
  the preferred side when the adjoining display disconnects. This option does
  not alter upstream multi-monitor dock mode.

## Scope

The fork retains the UUID `dash-to-dock-adaptive@eidrien.local` while retaining the upstream Dash-to-Dock settings schema so the user's tuned dock preferences remain compatible. Do not enable another Dash-to-Dock/Ubuntu Dock copy at the same time.

The within-workspace app comparator matches the supplied adaptive Dash-to-Panel implementation. Workspace index is the primary key, so dock traversal follows Adaptive Workspace Order even on mixed-app workspaces.

The primarily user-tested setup is GNOME 46 on Wayland. Broader version support
in metadata follows upstream and does not imply that all adaptive behavior has
been verified across those releases. This public fork is experimental.
