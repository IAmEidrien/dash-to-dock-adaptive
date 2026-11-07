# Adaptive CPU activity indicators — Experimental

Select **Adaptive (Experimental)** at the top of **Customize window counter
indicators**. No extra enable switch is needed. Other styles retain their saved
configuration. This feature measures activity; it never changes which launchers
exist, their order, or their click, hover-navigation and drag behavior.

A running application has a rounded dot at zero activity, expanding toward a
full line at 100% of the selected scale. Non-running applications have no running
indicator. Dominant application colors, custom indicator colors/borders,
thickness and dock-edge positioning remain available. A valid zero is distinct
from an unavailable measurement: failure or warm-up uses an ordinary running dot.

## Controls

These controls appear only while Adaptive is selected. Switching styles retains
their values.

| Setting | Default | Meaning |
| --- | --- | --- |
| Idle appearance | Dot | Dot or Line while hover monitoring is inactive. During monitoring, valid CPU activity always uses the dot-to-line scale. |
| CPU scale | Per-core | 100% means one logical CPU's capacity. Multi-threaded apps can exceed 100%. |
| Hover delay | 500 ms | Hover over a launcher for this long to start sampling it. Leaving suspends it. `0` monitors running launchers continuously. Range 0–5000 ms. |
| Polling interval | 2 seconds | Range 1–60 seconds. A new monitoring session needs two snapshots before a CPU value is available. |
| Animation duration | 300 ms | Range 0–1000 ms. GNOME's disabled/reduced animation setting makes changes immediate. |

**Total system capacity** divides the per-core measurement by the number of
online logical CPUs reported by the operating system. For example, an app using
one full CPU on an eight-CPU system reads approximately 100% per-core or 12.5%
total. These are capacity scales, not percentages of current clock speed or
performance, and do not account for differences between efficient/performance
cores or scheduling quotas.

The indicator's length is clamped at 100%; its tooltip keeps the actual number,
including values above 100%. While monitoring is active, hover near the indicator
edge of the launcher for an adjacent numerical tooltip. `~` and “process-tree
estimate” identify estimated attribution. The ordinary launcher tooltip returns
when the pointer leaves that region. A missing measurement is explicitly labeled.

Compatible single dot/dash/solid-line styles reuse the same drawing actor and
morph. Shapes without a faithful morph, including multiple separate dots/dashes,
crossfade where drawing areas are available. The default theme indicator uses an
immediate compatible fallback. New samples animate from the currently displayed
length, so a new target does not restart from zero.

## Measurement and limitations

Python 3 is required for monitoring. One asynchronous, unprivileged worker is
shared by all dock instances. It scans same-user Linux `/proc` CPU counters outside
Shell's main loop and combines Shell-reported app PIDs with discoverable descendant
processes. Root PIDs are also compared with other running apps to avoid assigning
a shared process confidently to multiple applications.

This is an **estimate**, not a complete application accounting service. Detached
or reparented helpers, remote app services, short-lived processes that exit between
samples, and some sandbox/broker arrangements cannot always be attributed. The
UI labels all values as estimates. Missing roots, detected ambiguous ownership,
permission restrictions, process churn or PID reuse cause an unavailable sample
rather than an invented zero. A newly discovered process needs a fresh baseline.
An app can still have undetectable detached work; do not use these values for
billing, benchmarking or precise system-load accounting.

Enumeration is bounded to 16,384 process entries and 256 applications/roots per
application, with a 700 ms scan/attribution budget and a 1.2-second subprocess
deadline. Oversized, failed and stale replies fall back to ordinary indicators.
Only active Adaptive monitoring schedules samples. Leaving hover mode, choosing
another style, destroying the last interested dock or disabling the extension
cancels owned sources and subprocesses. Renderer signals, tooltip actors and
animation callbacks are separately cleaned up. Dock reconstruction does not own
or duplicate the backend.

## Contextual preference audit

The same update changes visibility, preserving values and existing settings keys:

| Parent state | Controls shown only when relevant |
| --- | --- |
| Show on all monitors off | Monitor selector and label |
| Panel mode off/on | Size slider / centering control respectively |
| Window previews enabled | Preview size |
| Intelligent autohide enabled | Advanced autohide button |
| Window avoidance enabled | Avoidance modes |
| Pointer autohide enabled | Pressure requirement, fullscreen and urgent-reveal controls; pressure threshold or show delay according to pressure mode |
| Overview hover navigation enabled | Dwell, optional focus and padding targets |
| Mounted volumes enabled | Mounted-only and network-volume filters |
| Trash or mounts enabled | Location isolation |
| Emblems enabled | Notification counter; counter override also requires the counter |
| Show Applications enabled | Position, animation and edge controls |
| Hotkeys enabled | Shortcut details button |
| Custom indicator colors enabled | Manual colors/border controls; dominant-color option appears otherwise |
| Custom background enabled | Background color picker |
| Fixed opacity / Dynamic opacity | Opacity slider / additional settings respectively |
| Manual dynamic alphas enabled | Minimum and maximum alpha sliders |
| Backlighting enabled | Gloss effect |
| Scroll action enabled | Shared window/workspace switch delay |
| Built-in theme disabled | Theme customization rows; running-indicator selection remains available for Adaptive |

## Validation

Tested on **actual GNOME Shell 46.0, nested Wayland with software rendering**, in
an isolated container, at scale 1. This is native Shell/GJS/GTK validation, not
validation on the primary user's TV or every declared Shell release.

The native CPU probe covers a real GTK application's busy descendant, shared
sampling across two actual dock actors on one monitor, style transitions and
actor reuse, rapid hover, virtual-pointer tooltip positioning, values above
100%, sampler failure, reduced motion, unchanged launcher membership/order,
extension teardown and re-enable. The real preferences probe checks conditional
controls, retained values and advanced dialogs. A separate native lifecycle probe
repeats DND transitions, rebuilds, launcher creation/removal, workspace ordering
and injected reconciliation failure. Two physical monitors and non-46 Shell
versions were not tested in this update.

The isolated Shell logs contain environment-service warnings and GNOME 46 native
`st_adjustment_get_values` disposal diagnostics when toggling reduced motion and
tearing down widgets. The same native diagnostics were reproduced on the
unmodified previous testing build; they are not claimed fixed here. The candidate
had no GJS access to disposed dock actors in the accepted regression run.

Run the headless regressions with `make check`, strict schemas with
`glib-compile-schemas --strict --dry-run schemas`, and package with `make _build`.
On a GNOME-46-capable test host with the required runtime dependencies, use:

```sh
python3 tests/native/dock-lifecycle-run.py --cpu --output /tmp/d2d-cpu-review
python3 tests/native/dock-lifecycle-run.py --output /tmp/d2d-lifecycle-review
```

Each output directory must be new. The harness starts an isolated D-Bus, Xvfb
host and nested Wayland Shell; it writes JSON assertions, logs and a tooltip
screenshot. Keep the feature marked experimental until broader usability and
stability testing justifies changing that label.
