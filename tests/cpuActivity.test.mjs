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
    const Monitor = vm.runInNewContext(`(()=>{${code};return CpuActivityMonitor;})()`, {Gio, GLib, Shell});
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
