// SPDX-FileCopyrightText: Eidrien
// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {URL} from 'node:url';
import vm from 'node:vm';
const theme = readFileSync(new URL('../theming.js', import.meta.url), 'utf8');
const start = theme.indexOf('class Transparency {');
const {Transparency} = vm.runInNewContext(
    `(()=>{${theme.slice(start).replace(/Signals.addSignalMethods\(Transparency.prototype\);/, '')};return {Transparency};})()`,
    {Labels: {TRANSPARENCY: Symbol('transparency')}}
);
class Window {
    signals = new Map();
    connect(name, fn) {
        const id = this.signals.size + 1;
        this.signals.set(id, fn);
        return id;
    }

    disconnect(id) {
        assert.ok(this.signals.delete(id));
    }
}
test('duplicate transparency tracking cannot leak handlers across disable/destroy', () => {
    const t = Object.create(Transparency.prototype);
    Object.assign(t, {
        _enabled: true,
        _trackedWindows: new Map(),
        _signalsHandler: {removeWithLabel() {}, destroy() {}},
        emit() {},
        _dockIsNear() {
            throw Error('disposed dock accessed');
        },
    });
    const window = new Window();
    t._onWindowActorAdded(null, window);
    t._onWindowActorAdded(null, window);
    assert.equal(window.signals.size, 3);
    t.destroy();
    t.destroy();
    assert.equal(window.signals.size, 0);
    t._updateSolidStyle(); // A captured callback cannot touch the disposed actor.
    t._onWindowActorAdded(null, window);
    assert.equal(window.signals.size, 0);
});
// Evaluate the production scheduler without any Shell deferred-work dependency.
const source = readFileSync(new URL('../dash.js', import.meta.url), 'utf8');
const method = source.slice(source.indexOf('    _queueRedisplay() {'), source.indexOf('    _hookUpLabel('));
test('reconciliation coalesces, recovers after failure, and rejects work after teardown', () => {
    let serial = 0,
        calls = 0;
    const pending = new Map(),
        errors = [];
    const obj = vm.runInNewContext(`({${method}})`, {
        Meta: {LaterType: {BEFORE_REDRAW: 0}},
        GLib: {SOURCE_REMOVE: false},
        Utils: {
            laterAdd(_type, fn) {
                pending.set(++serial, fn);
                return serial;
            },
        },
        logError: e => errors.push(e),
    });
    obj._redisplay = () => {
        calls++;
        throw Error('injected redisplay failure');
    };
    obj._queueRedisplay();
    obj._queueRedisplay();
    assert.equal(pending.size, 1);
    pending.get(serial)();
    pending.clear();
    assert.equal(errors.length, 1);
    obj._redisplay = () => calls++;
    obj._queueRedisplay();
    pending.get(serial)();
    assert.equal(calls, 2);
    obj._queueRedisplay();
    obj._destroying = true;
    pending.get(serial)();
    obj._queueRedisplay();
    assert.equal(calls, 2);
});
