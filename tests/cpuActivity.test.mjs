// SPDX-FileCopyrightText: Eidrien
// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import test from 'node:test';
import vm from 'node:vm';
const code = readFileSync(new URL('../cpuActivity.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replace(/export /g, '');

test('one async backend coalesces docks, cancels on inactivity and rejects stale completion', () => {
    const timers = new Map(),
        processes = [],
        callbacks = [],
        values = [];
    let serial = 0,
        settingsCallback,
        now = 100;
    const settings = {
        get_enum: () => 10,
        get_int: () => 2,
        get_string: () => 'core',
        connect(_key, cb) {
            settingsCallback = cb;
            return ++serial;
        },
        disconnect() {},
    };
    const app = {get_id: () => 'app', get_pids: () => [123]};
    const Gio = {
        Cancellable: class {
            cancel() {}
        },
        SubprocessFlags: {STDIN_PIPE: 1, STDOUT_PIPE: 2, STDERR_SILENCE: 4},
        Subprocess: {
            new() {
                const process = {
                    force_exit() {
                        this.killed = true;
                    },
                    communicate_utf8_async(input, _cancel, cb) {
                        this.input = JSON.parse(input);
                        callbacks.push(cb);
                    },
                    communicate_utf8_finish: r => [true, JSON.stringify(r)],
                    get_successful: () => true,
                };
                processes.push(process);
                return process;
            },
        },
    };
    const GLib = {
        PRIORITY_DEFAULT: 0,
        SOURCE_REMOVE: false,
        SOURCE_CONTINUE: true,
        get_monotonic_time: () => now * 1e6,
        timeout_add(_p, _delay, cb) {
            timers.set(++serial, cb);
            return serial;
        },
        timeout_add_seconds(_p, _delay, cb) {
            timers.set(++serial, cb);
            return serial;
        },
        source_remove(id) {
            timers.delete(id);
        },
    };
    const Shell = {AppSystem: {get_default: () => ({get_running: () => [app]})}};
    const Monitor = vm.runInNewContext(`(()=>{${code};return CpuActivityMonitor;})()`, {
        Gio,
        GLib,
        Shell,
    });
    const monitor = new Monitor(settings, '/extension');
    const first = monitor.watch(app, sample => values.push(sample));
    const second = monitor.watch(app, sample => values.push(sample));
    assert.equal(processes.length, 0);
    const third = monitor.watch({get_id: () => 'other', get_pids: () => [456]}, () => {});
    monitor.batch(() => {
        monitor.activate(first, true);
        monitor.activate(second, true);
        monitor.activate(third, true);
    });
    assert.equal(processes.length, 1);
    callbacks[0](processes[0], {time: 100, cpus: 4, apps: {app: {percent: null}}});
    const bootstrap = monitor.bootstrap;
    const followup = timers.get(bootstrap);
    timers.delete(bootstrap);
    now = 100.25;
    followup();
    callbacks.at(-1)(processes.at(-1), {time: now, cpus: 4, apps: {app: {percent: 250}}});
    assert.equal(values.at(-1).percent, 250);
    monitor.unwatch(third);
    settings.get_enum = () => 0;
    settingsCallback();
    assert.equal(timers.size, 0);
    settings.get_enum = () => 10;
    settingsCallback();
    const pending = callbacks.at(-1),
        process = processes.at(-1);
    monitor.activate(first, false);
    monitor.activate(second, false);
    assert.ok(process.killed);
    assert.equal(timers.size, 0);
    const count = values.length;
    pending(process, {time: 100, cpus: 1, apps: {app: {percent: 100}}});
    assert.equal(values.length, count);
    monitor.destroy();
    assert.equal(timers.size, 0);
});

test('startup follows a valid baseline once after 250 ms then resumes configured polling', () => {
    const timers = new Map(),
        processes = [],
        delivered = [];
    let serial = 0,
        now = 100;
    const settings = {get_enum: () => 10, get_int: () => 5, connect: () => ++serial, disconnect() {}};
    const app = {get_id: () => 'app', get_pids: () => [123]};
    const schedule = (delay, cb) => {
        timers.set(++serial, {delay, cb});
        return serial;
    };
    const GLib = {
        PRIORITY_DEFAULT: 0,
        SOURCE_REMOVE: false,
        SOURCE_CONTINUE: true,
        get_monotonic_time: () => now * 1e6,
        timeout_add: (_p, delay, cb) => schedule(delay, cb),
        timeout_add_seconds: (_p, seconds, cb) => schedule(seconds * 1000, cb),
        source_remove: id => timers.delete(id),
    };
    const Gio = {
        Cancellable: class {
            cancel() {}
        },
        SubprocessFlags: {STDIN_PIPE: 1, STDOUT_PIPE: 2, STDERR_SILENCE: 4},
        Subprocess: {
            new() {
                const child = {
                    force_exit() {
                        this.killed = true;
                    },
                    communicate_utf8_async(input, _cancel, cb) {
                        this.input = JSON.parse(input);
                        this.cb = cb;
                    },
                    communicate_utf8_finish: result => [true, JSON.stringify(result)],
                    get_successful: () => true,
                };
                processes.push(child);
                return child;
            },
        },
    };
    const Shell = {AppSystem: {get_default: () => ({get_running: () => [app]})}};
    const Monitor = vm.runInNewContext(`${code};CpuActivityMonitor`, {GLib, Gio, Shell});
    const monitor = new Monitor(settings, '/extension');
    const token = monitor.watch(app, value => delivered.push(value));
    const complete = percent => {
        const child = processes.at(-1);
        child.cb(child, {time: now, cpus: 1, apps: {app: {percent}}});
    };
    const fire = id => {
        const scheduled = timers.get(id);
        timers.delete(id);
        if (scheduled.cb() === GLib.SOURCE_CONTINUE)
            timers.set(id, scheduled);
    };
    monitor.activate(token, true);
    assert.equal(processes.length, 1, 'baseline starts immediately');
    complete(null);
    assert.equal(timers.get(monitor.bootstrap).delay, 250);
    assert.ok(!monitor.timer, 'normal polling waits for the fast follow-up');
    monitor.activate(token, false);
    assert.equal(timers.size, 0, 'deactivation cancels the pending fast sample');
    monitor.activate(token, true);
    complete(null);
    now += 0.25;
    fire(monitor.bootstrap);
    const cancelled = processes.at(-1);
    monitor.activate(token, false);
    assert.ok(cancelled.killed);
    const count = delivered.length;
    cancelled.cb(cancelled, {time: now, cpus: 1, apps: {app: {percent: 80}}});
    assert.equal(delivered.length, count, 'in-flight follow-up reply is ignored after cancellation');
    assert.equal(timers.size, 0);
    monitor.activate(token, true);
    complete(null);
    now += 0.25;
    fire(monitor.bootstrap);
    assert.ok(processes.at(-1).input.previous, 'follow-up uses the baseline snapshot');
    complete(80);
    assert.equal(delivered.at(-1).percent, 80);
    assert.ok(!monitor.bootstrap && !monitor.startupPhase);
    assert.equal(timers.get(monitor.timer).delay, 5000, 'only the configured cadence remains');
    const before = processes.length;
    now += 5;
    fire(monitor.timer);
    assert.equal(processes.length, before + 1);
    complete(25);
    assert.ok(!monitor.bootstrap, 'steady polling never creates another fast follow-up');
    monitor.activate(token, false);
    monitor.activate(token, true);
    processes.at(-1).get_successful = () => false;
    complete(null);
    assert.ok(!monitor.bootstrap && monitor.timer, 'failed baseline falls back to normal retry cadence');
    assert.equal(timers.get(monitor.timer).delay, 5000);
    monitor.destroy();
    assert.equal(timers.size, 0);
});

test('hiding one dock preserves another and resumed observers require a post-resume baseline', () => {
    const timers = new Map(),
        children = [],
        values = {a: [], b: []};
    let now = 100,
        serial = 0;
    const apps = ['a', 'b'].map((id, index) => ({get_id: () => id, get_pids: () => [123 + index]}));
    const settings = {get_enum: () => 10, get_int: () => 5, connect: () => ++serial, disconnect() {}};
    const schedule = (delay, cb) => {
        timers.set(++serial, {delay, cb});
        return serial;
    };
    const GLib = {
        PRIORITY_DEFAULT: 0,
        SOURCE_REMOVE: false,
        SOURCE_CONTINUE: true,
        get_monotonic_time: () => now * 1e6,
        timeout_add: (_p, delay, cb) => schedule(delay, cb),
        timeout_add_seconds: (_p, seconds, cb) => schedule(seconds * 1000, cb),
        source_remove: id => timers.delete(id),
    };
    const Gio = {
        SubprocessFlags: {STDIN_PIPE: 1, STDOUT_PIPE: 2, STDERR_SILENCE: 4},
        Cancellable: class {
            cancel() {}
        },
        Subprocess: {
            new() {
                const child = {
                    force_exit() {
                        this.killed = true;
                    },
                    communicate_utf8_async(input, _cancel, cb) {
                        this.input = JSON.parse(input);
                        this.cb = cb;
                    },
                    communicate_utf8_finish: result => [true, JSON.stringify(result)],
                    get_successful: () => true,
                };
                children.push(child);
                return child;
            },
        },
    };
    const Shell = {AppSystem: {get_default: () => ({get_running: () => apps})}};
    const Monitor = vm.runInNewContext(`${code};CpuActivityMonitor`, {GLib, Gio, Shell});
    const monitor = new Monitor(settings, '/extension');
    const a = monitor.watch(apps[0], value => values.a.push(value));
    const b = monitor.watch(apps[1], value => values.b.push(value));
    const complete = (time, av, bv) => {
        const child = children.at(-1);
        child.cb(child, {time, cpus: 1, apps: {a: {percent: av}, b: {percent: bv}}});
    };
    const followup = () => {
        const id = monitor.bootstrap;
        const {cb} = timers.get(id);
        timers.delete(id);
        cb();
    };
    monitor.batch(() => {
        monitor.activate(a, true);
        monitor.activate(b, true);
    });
    complete(100, null, null);
    now = 100.25;
    followup();
    complete(now, 40, 70);
    assert.equal(values.a.at(-1).percent, 40);
    assert.equal(values.b.at(-1).percent, 70);
    const generation = monitor.generation,
        periodic = monitor.timer;
    monitor.activate(b, false);
    assert.equal(monitor.generation, generation, 'unique app removal does not reset shared worker');
    assert.equal(monitor.timer, periodic);
    now = 100.5;
    monitor.sample();
    const inFlight = children.at(-1);
    now = 100.6;
    monitor.activate(b, true);
    assert.ok(!inFlight.killed);
    assert.equal(monitor.generation, generation);
    now = 100.7;
    complete(100.5, 45, 75);
    assert.equal(values.a.at(-1).percent, 45);
    assert.equal(values.b.at(-1), null, 'in-flight pre-resume window cannot drive resumed dock');
    now = 100.95;
    followup();
    complete(now, 50, 80);
    assert.equal(values.a.at(-1).percent, 50);
    assert.equal(values.b.at(-1), null, 'first post-resume snapshot is the new baseline');
    now = 101.2;
    followup();
    complete(now, 55, 90);
    assert.equal(values.b.at(-1).percent, 90);
    assert.equal(monitor.generation, generation);
    assert.equal(monitor.timer, periodic, 'other dock keeps its periodic cadence');
    assert.ok(!monitor.bootstrap);
    monitor.activate(b, false);
    now = 102;
    monitor.activate(b, true);
    complete(now, 60, 95);
    assert.ok(monitor.bootstrap);
    monitor.activate(b, false);
    assert.ok(!monitor.bootstrap, 'unneeded observer-only follow-up is cancelled');
    assert.equal(monitor.timer, periodic);
    monitor.activate(a, false);
    assert.equal(timers.size, 0);
    monitor.destroy();
});
