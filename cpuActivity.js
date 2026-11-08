// SPDX-FileCopyrightText: Eidrien
// SPDX-License-Identifier: MIT
import {Gio, GLib, Shell} from './dependencies/gi.js';

export const ACTIVITY_STYLE = 10;

// A single sampler belongs to DockManager, never to individual docks/icons.
export class CpuActivityMonitor {
    constructor(settings, path) {
        this.settings = settings;
        this.path = path;
        this.tokens = new Set();
        this.generation = 0;
        this.settingsIds = [
            'running-indicator-style',
            'adaptive-cpu-hover-delay',
            'adaptive-cpu-interval',
        ].map(key => settings.connect(`changed::${key}`, () => this.sync()));
    }

    watch(app, changed) {
        const token = {app, changed, active: false};
        this.tokens.add(token);
        return token;
    }

    unwatch(token) {
        this.tokens.delete(token);
        this.sync();
    }

    activate(token, active) {
        if (!this.tokens.has(token) || token.active === active)
            return;
        token.active = active;
        token.awaitingFresh = active;
        if (active) {
            token.since = GLib.get_monotonic_time() / 1e6;
            this.refreshRequested = true;
        }
        this.sync();
    }

    // A dock activates its indicators as one transaction, avoiding worker churn.
    batch(callback) {
        this.batchDepth = (this.batchDepth ?? 0) + 1;
        try {
            callback();
        } finally {
            this.batchDepth--;
            this.sync();
        }
    }

    sync() {
        if (this.destroyed || this.batchDepth)
            return;
        const active =
            this.settings.get_enum('running-indicator-style') === ACTIVITY_STYLE &&
            [...this.tokens].some(t => t.active);
        // App membership alone never resets another visible dock's worker.
        const signature = active ? String(this.settings.get_int('adaptive-cpu-interval')) : '';
        if (this.signature === signature) {
            if (!this._needsFresh() && this.bootstrap && !this.startupPhase) {
                GLib.source_remove(this.bootstrap);
                this.bootstrap = 0;
            }
            if (this.refreshRequested) {
                this.refreshRequested = false;
                if (active && this._needsFresh() && !this.process && !this.bootstrap)
                    this.sample();
            }
            return;
        }
        this.signature = signature;
        this.stop();
        if (!active)
            return;
        this.startupPhase = 'baseline';
        this.sample();
    }

    _needsFresh() {
        return [...this.tokens].some(token => token.active && token.awaitingFresh);
    }

    _scheduleNext(snapshot) {
        if (this.destroyed || !this.signature)
            return;
        // A newly visible dock can use the shared in-flight snapshot as its new
        // baseline, then one short follow-up, without stopping ordinary polling.
        if (snapshot && this._needsFresh() && !this.bootstrap) {
            this.bootstrap = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
                this.bootstrap = 0;
                this.sample();
                return GLib.SOURCE_REMOVE;
            });
        }
        if (this.startupPhase === 'baseline' && snapshot) {
            this.startupPhase = 'followup';
            return;
        }
        this.startupPhase = null;
        if (!this.timer) {
            this.timer = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                this.settings.get_int('adaptive-cpu-interval'),
                () => {
                    this.sample();
                    return GLib.SOURCE_CONTINUE;
                }
            );
        }
    }

    stop() {
        this.generation++;
        if (this.bootstrap)
            GLib.source_remove(this.bootstrap);
        this.bootstrap = 0;
        this.startupPhase = null;
        if (this.timer)
            GLib.source_remove(this.timer);
        this.timer = 0;
        if (this.deadline)
            GLib.source_remove(this.deadline);
        this.deadline = 0;
        this.cancel?.cancel();
        this.process?.force_exit();
        this.process = null;
        this.cancel = null;
        this.previous = null;
        this.refreshRequested = false;
        for (const token of this.tokens)
            token.awaitingFresh = token.active;
        if (this.settings.get_enum('running-indicator-style') === ACTIVITY_STYLE)
            this.deliver(null, 'waiting');
    }

    deliver(snapshot, state = 'unavailable', windowStart) {
        for (const token of [...this.tokens]) {
            if (!token.active || !this.tokens.has(token))
                continue;
            // Only measurements whose baseline was taken after this observer
            // activated may drive it; other visible observers keep their samples.
            if (snapshot && !(windowStart >= token.since)) {
                token.changed(null, snapshot.cpus ?? 1, 'waiting');
                continue;
            }
            if (snapshot)
                token.awaitingFresh = false;
            token.changed(snapshot?.apps?.[token.app.get_id()] ?? null, snapshot?.cpus ?? 1, state);
        }
    }

    sample() {
        if (
            this.process ||
            this.destroyed ||
            this.settings.get_enum('running-indicator-style') !== ACTIVITY_STYLE ||
            ![...this.tokens].some(t => t.active)
        )
            return;
        const apps = {};
        // Include other running applications when checking shared PID ownership.
        const running = new Set([
            ...Shell.AppSystem.get_default().get_running(),
            ...[...this.tokens].filter(t => t.active).map(t => t.app),
        ]);
        for (const app of running) {
            try {
                apps[app.get_id()] = [...new Set(app.get_pids())];
            } catch {
                apps[app.get_id()] = [];
            }
        }
        const {generation} = this;
        const warmingUp = !this.previous;
        const windowStart = this.previous?.time;
        try {
            this.cancel = new Gio.Cancellable();
            const process = Gio.Subprocess.new(
                ['python3', `${this.path}/cpu_activity.py`],
                Gio.SubprocessFlags.STDIN_PIPE |
                    Gio.SubprocessFlags.STDOUT_PIPE |
                    Gio.SubprocessFlags.STDERR_SILENCE
            );
            this.process = process;
            this.deadline = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1200, () => {
                if (generation !== this.generation || this.process !== process)
                    return GLib.SOURCE_REMOVE;
                this.deadline = 0;
                this.cancel?.cancel();
                process.force_exit();
                return GLib.SOURCE_REMOVE;
            });
            process.communicate_utf8_async(
                JSON.stringify({apps, previous: this.previous}),
                this.cancel,
                (child, result) => {
                    let snapshot = null;
                    try {
                        const [, output] = child.communicate_utf8_finish(result);
                        if (child.get_successful() && output.length <= 1048576)
                            snapshot = JSON.parse(output);
                    } catch {
                        // An unavailable/stale sample is a rendering fallback.
                    }
                    if (this.destroyed || generation !== this.generation)
                        return;
                    if (this.deadline)
                        GLib.source_remove(this.deadline);
                    this.deadline = 0;
                    this.process = null;
                    this.cancel = null;
                    const age = GLib.get_monotonic_time() / 1e6 - snapshot?.time;
                    if (
                        !Number.isFinite(age) ||
                        age < 0 ||
                        age > Math.max(3, 2 * this.settings.get_int('adaptive-cpu-interval'))
                    )
                        snapshot = null;
                    this.previous = snapshot;
                    this.deliver(
                        snapshot,
                        snapshot && warmingUp ? 'waiting' : 'unavailable',
                        windowStart
                    );
                    if (generation === this.generation)
                        this._scheduleNext(snapshot);
                }
            );
        } catch {
            if (this.deadline)
                GLib.source_remove(this.deadline);
            this.deadline = 0;
            this.cancel?.cancel();
            this.process?.force_exit();
            this.process = null;
            this.cancel = null;
            this.previous = null;
            this.deliver(null);
            this._scheduleNext(null);
        }
    }

    destroy() {
        if (this.destroyed)
            return;
        this.destroyed = true;
        this.settingsIds.forEach(id => this.settings.disconnect(id));
        this.tokens.clear();
        this.stop();
    }
}
