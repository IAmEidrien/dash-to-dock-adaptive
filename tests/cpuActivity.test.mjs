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
        settingsCallback;
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
        get_monotonic_time: () => 100000000,
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
    callbacks[0](processes[0], {time: 100, cpus: 4, apps: {app: {percent: 250}}});
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
