# Dash to Dock 110 — Adaptive 8

Experimental GNOME Shell fork based on the official Dash to Dock 110 extension
release (`extensions.gnome.org-v110`, upstream commit `2dfae34`). All changes
from the old Adaptive 7 snapshot are carried onto the actual upstream fork.
The public fork retains upstream ancestry; the private old repository retains
its separate snapshot history. See GIT-WORKFLOW.md for migrating an installed
checkout without deleting that history or changing personal settings.

## Changes

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
- Replaces Dash to Dock's fixed 250 ms workspace-scroll dead time with **Workspace switch delay (ms)**. Default: **10 ms**. `0` disables throttling.
- Preserves upstream behavior when adaptive ordering is disabled.
- Adds **Focus application in overview on hover**. This is app-centric and therefore works naturally with Dash-to-Dock's grouped icons. A configurable 0–2000 ms delay controls dwell time; `0` focuses immediately.
- For multi-window applications, hover focus preserves the already-focused window when applicable, otherwise chooses the most-recently-used window on the active workspace, then the most-recently-used window anywhere.
- **Switch to the application's workspace before focusing** is enabled by default. Cross-workspace focus uses Mutter workspace activation rather than `Main.activateWindow()`, so the overview stays open. Leaving an icon cancels its pending hover timer.
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
