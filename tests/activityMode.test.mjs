// SPDX-FileCopyrightText: Eidrien
// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const code = readFileSync(new URL('../activityIndicator.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replace(/export /g, '');

test('dock mode triggers only on an indicator, persists in its dock and cancels all owned work', () => {
    const timers = new Map(),
        signals = new Map();
    let serial = 0,
        delay = 500,
        style = 10,
        inside = false,
        trigger = false;
    const settings = {
        get_enum: () => style,
        get_int: () => delay,
        connect(name, cb) {
            signals.set(++serial, {name, cb});
            return serial;
        },
        disconnect(id) {
            signals.delete(id);
        },
    };
    const paints = new Map();
    const paint = () => [...paints.values()].forEach(callback => callback());
    const stage = {
        connect(_signal, callback) {
            paints.set(++serial, callback);
            return serial;
        },
        disconnect(id) {
            paints.delete(id);
        },
    };
    const Mode = vm.runInNewContext(`${code};DockActivityMode`, {
        global: {stage},
        ACTIVITY_STYLE: 10,
        GLib: {
            PRIORITY_DEFAULT: 0,
            SOURCE_REMOVE: false,
            timeout_add(_p, _delay, cb) {
                timers.set(++serial, cb);
                return serial;
            },
            source_remove(id) {
                timers.delete(id);
            },
        },
    });
    const mode = new Mode(settings, {});
    mode._insideDock = () => inside;
    mode.setVisible(true);
    paint();
    const make = () => ({
        style: 10,
        _source: {running: true, mapped: true, hover: true},
        monitor: {batch: cb => cb()},
        _pointerOnIndicator: () => trigger,
        _monitoring() {
            this.active = mode.active;
        },
    });
    const first = make(),
        second = make();
    mode.add(first);
    mode.add(second);
    inside = true;
    mode.updatePointer();
    assert.equal(timers.size, 0, 'ordinary icon hover cannot start dwell');
    trigger = true;
    mode.updatePointer();
    mode.updatePointer();
    assert.equal(timers.size, 1, 'one timer belongs to dock');
    const fire = () => {
        const [id, cb] = timers.entries().next().value;
        timers.delete(id);
        cb();
    };
    fire();
    assert.ok(mode.active && first.active && second.active);
    const otherDock = new Mode(settings, {});
    otherDock._insideDock = () => false;
    otherDock.setVisible(true);
    paint();
    const remote = make();
    remote._pointerOnIndicator = () => false;
    remote._monitoring = () => {
        remote.active = otherDock.active;
    };
    otherDock.add(remote);
    assert.ok(!otherDock.active && !remote.active && mode.active, 'dock states remain independent');
    otherDock.destroy();
    trigger = false;
    mode.updatePointer();
    assert.ok(mode.active && second.active, 'mode persists over dock controls and icons');
    inside = false;
    trigger = true;
    mode.updatePointer();
    assert.ok(mode.active, 'extended indicator region is part of dock hover region');
    trigger = false;
    mode.updatePointer();
    assert.ok(!mode.active && !first.active && !second.active);
    trigger = true;
    mode.updatePointer();
    assert.equal(timers.size, 1);
    mode.remove(first);
    trigger = false;
    fire();
    assert.equal(mode.active, false, 'dwell rechecks moved/destroyed trigger geometry');
    delay = 0;
    mode.updatePointer();
    assert.ok(mode.active && second.active);
    style = 2;
    mode.updatePointer();
    assert.ok(!mode.active && !second.active);
    style = 10;
    delay = 500;
    trigger = true;
    mode.updatePointer();
    assert.equal(timers.size, 1);
    mode.destroy();
    mode.destroy();
    assert.equal(timers.size, 0);
    assert.equal(signals.size, 0);
    assert.equal(mode.members.size, 0);
    assert.equal(second.active, false);
});

test('smoothing strengthens with duration, is time-aware and responds quickly to rises', () => {
    const smooth = vm.runInNewContext(`${code};smoothActivity`);
    const short = smooth(0.5, 0.49, 1, 100, 1);
    const long = smooth(0.5, 0.49, 1, 5000, 1);
    assert.ok(Math.abs(short.value - 0.49) < 0.0001);
    assert.ok(long.value > short.value && long.value < 0.5);
    const rise = smooth(0.1, 0.9, 1, 5000, 1);
    assert.ok(rise.value >= 0.78, 'large rises get fast attack');
    const later = smooth(0.5, 0.1, 4, 5000, 1);
    const sooner = smooth(0.5, 0.1, 1, 5000, 1);
    assert.ok(later.value < sooner.value, 'elapsed time controls settling');
    const twice = smooth(smooth(0.5, 0.1, 1, 5000, 1).value, 0.1, 1, 5000, 1);
    assert.ok(Math.abs(twice.value - smooth(0.5, 0.1, 2, 5000, 1).value) < 1e-10);
    const direct = smooth(0.5, 0.50001, 1, 0, 1);
    assert.equal(direct.value, 0.50001);
    assert.equal(direct.deadband, 0);
    assert.ok(long.deadband > short.deadband);
});

test('visibility suspends mode and rearming requires leaving every indicator strip, not the dock', () => {
    const timers = new Map();
    let serial = 0,
        delay = 500,
        inside = true;
    const trigger = [true, false];
    const settings = {
        get_enum: () => 10,
        get_int: () => delay,
        connect: () => ++serial,
        disconnect() {},
    };
    const paints = new Map();
    const paint = () => [...paints.values()].forEach(callback => callback());
    const stage = {
        connect(_signal, callback) {
            paints.set(++serial, callback);
            return serial;
        },
        disconnect(id) {
            paints.delete(id);
        },
    };
    const Mode = vm.runInNewContext(`${code};DockActivityMode`, {
        global: {stage},
        ACTIVITY_STYLE: 10,
        GLib: {
            PRIORITY_DEFAULT: 0,
            SOURCE_REMOVE: false,
            timeout_add(_p, _delay, cb) {
                timers.set(++serial, cb);
                return serial;
            },
            source_remove(id) {
                timers.delete(id);
            },
        },
    });
    const mode = new Mode(settings, {});
    mode._insideDock = () => inside;
    const members = trigger.map((_value, index) => ({
        style: 10,
        _source: {running: true, mapped: true},
        monitor: {batch: cb => cb()},
        _pointerOnIndicator: () => trigger[index],
        _monitoring() {
            this.active = mode.active;
        },
    }));
    members.forEach(member => mode.add(member));
    assert.ok(!mode.visible && !mode.active && !mode.dwell);
    mode.setVisible(true);
    trigger[0] = false;
    mode.updatePointer();
    assert.ok(mode.needsRearm, 'pre-paint offscreen bounds cannot rearm reveal');
    trigger[0] = true;
    paint();
    assert.ok(mode.needsRearm && !mode.active && !mode.dwell, 'reveal motion does not start Activity');
    trigger[0] = false;
    trigger[1] = true;
    mode.updatePointer();
    assert.ok(mode.needsRearm && !mode.dwell, 'switching indicator strips cannot rearm');
    mode.setVisible(false);
    trigger[1] = false;
    mode.updatePointer();
    assert.ok(mode.needsRearm, 'invisible geometry cannot clear rearming');
    trigger[0] = true;
    mode.setVisible(true);
    paint();
    assert.ok(!mode.dwell);
    trigger[0] = false;
    mode.updatePointer();
    assert.ok(!mode.needsRearm && !mode.active && inside, 'icon interior rearms without leaving dock');
    trigger[0] = true;
    mode.updatePointer();
    assert.equal(timers.size, 1);
    mode.setVisible(false);
    assert.equal(timers.size, 0, 'hiding cancels pending dwell');
    mode.setVisible(true);
    paint();
    assert.ok(mode.needsRearm && !mode.dwell);
    trigger[0] = false;
    mode.updatePointer();
    trigger[0] = true;
    mode.updatePointer();
    const callback = timers.get(mode.dwell);
    timers.delete(mode.dwell);
    callback();
    assert.ok(mode.active && members.every(member => member.active));
    mode.setVisible(false);
    assert.ok(!mode.active && members.every(member => !member.active));
    delay = 0;
    mode.setVisible(true);
    paint();
    assert.ok(mode.active, 'visible zero-delay mode bypasses rearming');
    for (let i = 0; i < 5; i++) {
        mode.setVisible(false);
        assert.equal(mode.active, false);
        mode.setVisible(true);
        paint();
        assert.equal(mode.active, true);
    }
    mode.setVisible(false);
    mode.setVisible(true);
    assert.equal(paints.size, 1);
    mode.destroy();
    assert.equal(timers.size, 0);
    assert.equal(paints.size, 0);
    assert.equal(mode.members.size, 0);
});
