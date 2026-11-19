# GNOME 46 launcher reconciliation and dock teardown

## Findings

The reported November 7 journal locations are consistent with callbacks retaining
a destroyed dock. They are not, by themselves, evidence that those callbacks
stalled the launcher list.

Two defects were reproduced separately against baseline `30c263c`:

- `Transparency._onWindowActorAdded()` could connect allocation/visibility
  handlers twice for the same actor and overwrite its saved signal IDs. Teardown
  disconnected only the last set. Deliberately registering an existing window
  twice and reconstructing the dock produced disposed dock/background warnings
  from the old callbacks as real windows changed workspace.
- GNOME 46 `Main._runBeforeRedrawQueue()` clears its shared queue only after
  invoking callbacks. An exception skips that reset; subsequent queuing can no
  longer schedule a new redraw callback. Injecting one launcher reconciliation
  error reproduced a frozen launcher roster while the removed application's
  running indicator continued updating. This test proves a failure mechanism,
  not that such an exception accompanied the user's original warning burst.

DND transitions themselves rebuilt notification/emblem indicators and the
launcher remote model, not the dock actors, in the tested configuration.
Dock reconstruction was triggered separately through position changes. The
original incident's specific trigger remains unconfirmed; the supplied warning
summary contains no reconciliation exception or full dock-rebuild timeline.

## Fix

Transparency tracking is idempotent per window actor and also releases tracking
on the window actor's destruction. Disable/destroy disconnect every saved window
handler. Theme destruction is idempotent, cancels its queued theme update, stops
transparency callbacks and explicitly releases its signal handler. Dock teardown
stops theme/intellihide observers before destroying the dash they reference.

Launcher reconciliation now owns a coalesced, cancellable before-redraw source
per dash rather than relying on Shell's shared deferred-work queue. Its source
ID clears before reconciliation; errors are logged and future desktop activity
can schedule another update. Destruction cancels pending work, and mapping the
icon box schedules a fresh reconciliation. There is no periodic retry or polling.

Adaptive ordering, AppUsage priorities, filtering, crowding and launcher click/
hover policies are unchanged. Existing adaptive regression tests remain enabled.

## Native reproduction

`tests/native/dock-lifecycle-run.py` requires a disposable GNOME 46 environment
with GJS, GTK4, D-Bus, Xvfb and compiled runtime dependencies. It uses separate
settings/cache/data directories and never the user's live session.

```sh
python3 tests/native/dock-lifecycle-run.py --output /tmp/d2d-fixed
python3 tests/native/dock-lifecycle-run.py --counter false --dnd off --output /tmp/d2d-fixed-no-counter
python3 tests/native/dock-lifecycle-run.py --baseline --baseline-ref 30c263c --output /tmp/d2d-baseline
```

Each output directory must be new. The baseline run is expected to fail the
launcher-removal assertion. A runtime without Git can use `--baseline-source`
with a directory containing the baseline `dash.js`, `docking.js` and `theming.js`.
Baseline mode deliberately seeds duplicate transparency tracking; both modes
inject `D2D_TEST_EXPECTED_REDISPLAY_FAILURE` once. That logged error is expected.

Accepted native runs used GNOME 46 Wayland at scale 1 with software rendering,
two real GTK applications, four DND/position-reconstruction cycles, workspace
reordering, pending-update cancellation, launcher removal/recreation after the
injected error, and disable/re-enable. The initial-DND-on/counting-on run passed
30 checks; the final initial-DND-off/counting-off run passed 34 checks, including
explicit confirmation that DND did not reconstruct the dock. The baseline showed
180 disposed-object warnings in the first comparison and failed launcher removal;
the corresponding patched run showed zero disposed-object warnings. The final
baseline also confirmed that the running indicator updated during the freeze.

Node tests cover duplicate registration, disconnects, teardown idempotence,
coalescing and recovery. `make check` passes with ESLint 9; it reports four existing
warnings in unchanged appIcons.js/utils.js. `make _build` and strict schema checks
pass. No 200% scale, multi-monitor, other extensions' themes or long-running user
session were simulated in this focused regression.
