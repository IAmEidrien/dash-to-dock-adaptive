# CPU Activity indicators — Experimental

Select **Activity (Experimental)** at the top of **Customize window counter
indicators**. No extra enable switch is needed. Existing saved style values (including the
`ADAPTIVE` enum nick) and all GSettings keys are retained. Other styles retain their saved
configuration. This feature measures activity; it never changes which launchers
exist, their order, or their click, hover-navigation and drag behavior.

A running application has a rounded dot at zero activity, expanding toward a
full line at 100% of the selected scale. Non-running applications have no running
indicator. Dominant application colors, custom indicator colors/borders,
thickness and dock-edge positioning remain available. A valid zero is distinct
from an unavailable measurement: failure or warm-up uses an ordinary running dot.

## Activity mode

With a nonzero hover delay, enter the existing narrow CPU-tooltip region beside
any **running** indicator to start one dock-owned dwell timer. Ordinary launcher
hover does not start Activity mode. When the delay expires, every running
indicator in that dock measures CPU together. Activity mode stays active while
the pointer is anywhere in the dock or its extended indicator hover strips,
including icon interiors, other launchers, controls and padding. Leaving that
effective region ends Activity mode and returns to the selected idle appearance.
Entering and leaving an indicator before the delay expires cancels activation.

The trigger and numerical tooltip use the same fixed-width, scale-aware,
orientation-aware strip, extending outward through padding toward the monitor
edge. This geometry is unchanged. The numerical tooltip still belongs to the
indicator under the pointer; Activity mode belongs to its dock instance. A second
dock has an independent activation state while sharing the same sampling worker.
A hover delay of `0` keeps Activity mode active without pointer interaction while
the dock is visible.
New running indicators join their dock's current state automatically.

## Visibility and revealing the dock

Activity mode is suspended when a dock begins hiding through autohide or
intellihide, and stays suspended while it is hidden or sliding into view. It
becomes eligible again when the existing dock state reaches **shown** and its
actor is mapped. Hidden docks drop their sampler subscriptions, cancel pending
activation, stop their Activity timelines, clear CPU/smoothing history and snap
to the selected idle appearance. They do not resume a partially finished
animation from before hiding.

For nonzero hover delays, a reveal is **disarmed**: the pointer must first leave
**all** running Activity indicator strips before a new strip entry can start the
dwell. Moving from one strip to another does not rearm it. Moving into an icon's
interior, another non-indicator dock control or dock padding is sufficient; the
pointer need not leave the whole dock. Rearming waits for the revealed dock's
first painted frame so a transient offscreen layout cannot bypass the guard.
The fixed indicator strips and their extensions to the monitor edge are unchanged.
A delay of `0` bypasses this guard whenever the dock is shown.

Each dock suspends independently. The shared worker and ordinary polling cadence
continue for other visible docks, including when they show different apps. A
resumed observer accepts CPU deltas only when their baseline was recorded after
its activation; a shared in-flight measurement from before that point cannot
restore stale data. Fresh baseline/follow-up samples reuse the same asynchronous
backend without resetting another visible dock's measurements. Hiding the last
active dock cancels polling, startup follow-ups and the worker. Dock destruction
also disconnects its visibility/frame callbacks and activation timer.

## Controls

These controls appear only while Activity is selected. Switching styles retains
their values.

| Setting | Default | Meaning |
| --- | --- | --- |
| Idle appearance | Dot | Dot, Line (Solid), or Metro outside Activity mode. During Activity mode, valid CPU activity always uses the dot-to-line scale. |
| CPU scale | Per-core | 100% means one logical CPU's capacity. Multi-threaded apps can exceed 100%. |
| Hover delay | 500 ms | Enter a running indicator's CPU-tooltip region for this long to start dock-wide Activity mode. Leave the dock to stop. `0` keeps Activity mode active while shown. Range 0–5000 ms. |
| Polling interval | 2 seconds | Range 1–60 seconds. Startup takes an immediate baseline and one follow-up about 250 ms after the baseline reply, then resumes this normal interval. |
| Animation duration | 1.0 second | Range 0–5 seconds in 0.1-second steps. `0` disables animation and visual smoothing. GNOME's reduced-motion setting also makes changes immediate. |

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
when the pointer leaves that region, unless **Hide application tooltip** is on.
That setting keeps the CPU tooltip but omits the application title. The indicator
hover strip extends outward through dock padding to its monitor's screen edge,
within that launcher's along-axis bounds; it does not intercept clicks or scrolls.
Hover dwell and the initial two-snapshot warm-up show **Waiting…**, without a CPU
number. Actual failed measurements still report that they are unavailable.

Compatible single dot/dash/solid-line styles reuse the same drawing actor and
morph. Shapes without a faithful morph, including multiple separate dots/dashes,
crossfade where drawing areas are available. The default theme indicator uses an
immediate compatible fallback. New samples animate from the currently displayed
length, so a new target does not restart from zero.

## Initial reading and idle appearances

Activity mode still begins with an asynchronous CPU baseline. A single follow-up
is scheduled **250 ms after a valid baseline reply**, rather than waiting for the
normal polling interval. That produces the first valid CPU delta sooner; worker
startup and scan time also contribute to the wait. Normal polling begins after
that follow-up and retains the saved interval. No faster sustained polling is
introduced. Both snapshots use the existing validity, PID identity, ownership
and minimum elapsed-time checks. Unattributable apps can still report unavailable.

Leaving Activity mode, switching styles, replacing a monitoring session or
disabling the extension cancels the pending follow-up and any in-flight worker.
An unsuccessful baseline retries at the normal interval, avoiding a rapid error
loop. Short initial samples can be noisier than longer polling averages; visual
smoothing remains separate from the actual numerical tooltip.

The active capsule now shares **Solid's body-height and edge-padding calculation**,
including custom border and backlighting behavior. Its dot and full line remain
rounded, with the same thickness as Solid at 100% and 200% UI scaling. Colors,
position, animation and the existing hover geometry are retained.

Outside Activity mode, **Dot** uses the rounded capsule at minimum length.
**Line** uses the existing Solid renderer. **Metro** is the one added idle option,
reusing Metro's flat launcher background, line and multi-window shading/focused
stack treatment. Metro is more than a corner-radius variant. Its launcher styling
is confined to idle state and removed when Activity mode starts or its renderer
is destroyed. All idle choices return to the same rounded CPU-driven capsule in
Activity mode; no new settings category or enable toggle is added. Existing Dot
and Line enum values remain unchanged.

## Visual smoothing

Only the indicator's normalized length is smoothed. Numerical tooltips always
use the latest raw measurement in the selected CPU scale, including values above
100%; attribution and the sampling worker are unchanged.

A time-aware moving average reduces small variations. Its strength increases
with animation duration relative to the polling interval. Larger increases get a
fast response, while decreases settle more gradually. A small visual deadband
suppresses changes below about 0.6% of the full scale at the strongest supported
setting; accumulated changes can still cross that threshold. No extra settings
are needed. At short animation durations the effect is minimal. At zero duration,
smoothing and the deadband are entirely bypassed, even for very small changes.

Animations retarget from the currently displayed length, including when they
last longer than the polling interval. Unchanged targets continue their existing
timeline rather than restarting. Idle/unknown states and changes of CPU scale
reset smoothing history. Existing saved animation durations remain in integer
milliseconds under the same GSettings key; only the UI uses seconds. The new
one-second default applies where that key has not been explicitly set.

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
Only visible, active Activity observers schedule samples. Choosing another style,
dropping the last active observer or disabling the extension cancels owned sources
and subprocesses. Other visible observers keep their shared sampler when one dock
suspends. Renderer signals, tooltip actors and
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
an isolated container, at UI scales 1 and 2. This is native Shell/GJS/GTK validation, not
validation on the primary user's TV or every declared Shell release.

The initial native CPU validation ran with software rendering, where GNOME
inhibited animations. It therefore missed a missing actor/frame-clock association
in the animation timeline. A follow-up reproduced the frozen indicator with
animations explicitly enabled and the supplied GNOME 46 theme loaded. Timelines
now belong to the drawing actor, detach on cancellation, and skip animation while
the actor is unmapped. The harness forces compositor animations on and asserts
that GNOME reports them enabled before checking actual frame-driven progress;
it still verifies the user's reduced-motion setting separately. The refinement
adds native checks for dock-wide activation, indicator-only triggering, whole-dock
persistence, rapid entry/exit, five-second retargeting, smoothing and zero-duration
precision, plus real GTK checks of the fractional-second control. Later checks
cover the 250 ms startup pair, follow-up cancellation, normal sustained cadence,
Metro state ownership and parity with the actual Solid renderer at both UI scales.
Visibility regression checks exercise actual autohide, maximizing a real GTK
window to trigger intellihide, interrupted reveal/hide cycles, reveal rearming
within the dock, visible-only zero-delay mode, two actual dock instances sharing
a worker, fresh post-resume baselines, reconstruction and teardown. Headless
checks additionally cover unique app sets across docks, pre-resume in-flight
replies, pre-paint reveal geometry and cancellation of the one-shot frame check. Headless tests
also cover independent dock states and time-aware smoothing/deadband behavior.

The native CPU probe covers a real GTK application's busy descendant, shared
sampling across two actual dock actors on one monitor, style transitions and
actor reuse, idle Dot/Solid/Metro changes, rapid hover, virtual-pointer tooltip
positioning and screen-edge activation, hidden application title compatibility,
waiting/failure states, values above
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
python3 tests/native/dock-lifecycle-run.py --cpu --position 3 --scale 2 --output /tmp/d2d-cpu-review
python3 tests/native/dock-lifecycle-run.py --output /tmp/d2d-lifecycle-review
```

Position values are top `0`, right `1`, bottom `2`, left `3`. `--scale` sets the
Shell UI theme scale for the isolated probe, not a physical monitor's hardware
scale. `--theme /path/to/gnome-shell.css` optionally loads an additional stylesheet
for a theme compatibility check without committing that stylesheet or settings.

Each output directory must be new. The harness starts an isolated D-Bus, Xvfb
host and nested Wayland Shell; it writes JSON assertions, logs and a tooltip
screenshot. Keep the feature marked experimental until broader usability and
stability testing justifies changing that label.
