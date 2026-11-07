// SPDX-FileCopyrightText: Eidrien
// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import test from 'node:test';
import vm from 'node:vm';
test('CPU morphs retarget from displayed width and clean up timeline callbacks', () => {
    let update,
        removed = false,
        fallback = 0;
    const motion = {enable_animations: true};
    class Timeline {
        callbacks = new Map();
        serial = 0;
        progress = 0;
        connect(name, callback) {
            this.callbacks.set(++this.serial, {name, callback});
            return this.serial;
        }

        disconnect(id) {
            this.callbacks.delete(id);
        }

        start() {}
        stop() {
            this.stopped = true;
        }

        get_progress() {
            return this.progress;
        }

        fire(name) {
            for (const entry of [...this.callbacks.values()]) {
                if (entry.name === name)
                    entry.callback(this);
            }
        }
    }
    const code = readFileSync(new URL('../activityIndicator.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '')
        .replace(/export /g, '');
    const factory = vm.runInNewContext(`${code};createActivityIndicator`, {
        Clutter: {Timeline},
        St: {Settings: {get: () => motion}},
        GLib: {SOURCE_REMOVE: false},
        ADAPTIVE_STYLE: 10,
    });
    class Base {
        constructor(source) {
            this._source = source;
            this._signalsHandler = {add() {}, destroy() {}};
            this._area = {queue_repaint() {}};
        }

        destroy() {}
    }
    const Indicator = factory(
        Base,
        {
            9() {
                fallback++;
            },
        },
        {}
    );
    const settings = {
        get_int: key => key === 'adaptive-cpu-hover-delay' ? 0 : 300,
        get_string: key => key === 'adaptive-cpu-scale' ? 'core' : 'dot',
    };
    const monitor = {
        watch(_app, fn) {
            update = fn;
            return {};
        },
        activate() {},
        unwatch() {
            removed = true;
        },
    };
    const source = {app: {}, running: true, hover: false};
    const indicator = new Indicator(source, 10, {_settings: settings, cpuActivity: monitor});
    update({percent: 50}, 1);
    const first = indicator.timeline;
    first.progress = 0.5;
    first.fire('new-frame');
    const displayed = indicator.fraction;
    assert.ok(displayed > 0 && displayed < 0.5);
    update({percent: 250}, 1);
    assert.ok(first.stopped);
    assert.equal(first.callbacks.size, 0);
    const second = indicator.timeline;
    second.fire('new-frame');
    assert.equal(indicator.fraction, displayed);
    second.progress = 1;
    second.fire('new-frame');
    second.fire('completed');
    assert.equal(indicator.fraction, 1);
    update(null, 1);
    const missing = indicator.timeline;
    missing.progress = 1;
    missing.fire('new-frame');
    missing.fire('completed');
    indicator._drawIndicator({});
    assert.equal(fallback, 1);
    motion.enable_animations = false;
    indicator.animate(0.25);
    assert.equal(indicator.fraction, 0.25);
    assert.equal(indicator.timeline, null);
    motion.enable_animations = true;
    indicator.animate(1);
    const pending = indicator.timeline;
    indicator.destroy();
    assert.ok(removed && pending.stopped);
    assert.equal(pending.callbacks.size, 0);
});
