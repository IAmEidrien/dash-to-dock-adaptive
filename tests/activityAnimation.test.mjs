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
        constructor({actor}) {
            assert.ok(actor, 'timeline needs the real drawing actor for its frame clock');
            this.actor = actor;
        }

        set_actor(actor) {
            this.actor = actor;
        }

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
            this._area = {mapped: true, queue_repaint() {}};
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
    assert.equal(first.actor, null);
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
    indicator._area.mapped = false;
    indicator.animate(0.5);
    assert.equal(indicator.fraction, 0.5);
    assert.equal(indicator.timeline, null, 'unstaged actors never start a timeline');
    indicator._area.mapped = true;
    indicator.animate(1);
    const pending = indicator.timeline;
    indicator.destroy();
    assert.ok(removed && pending.stopped);
    assert.equal(pending.callbacks.size, 0);
});


test('indicator hover extends only its strip to each monitor edge at both UI scales', () => {
    const code = readFileSync(new URL('../activityIndicator.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/gm, '').replace(/export /g, '');
    let pointer = [0, 0], scale = 1, box = [30, 100, 80, 80];
    const monitor = {x: 0, y: 0, width: 500, height: 400};
    const Side = {TOP: 0, RIGHT: 1, BOTTOM: 2, LEFT: 3};
    const factory = vm.runInNewContext(`${code};createActivityIndicator`, {
        St: {Side, ThemeContext: {get_for_stage: () => ({scale_factor: scale})}},
        Main: {layoutManager: {findMonitorForActor: () => monitor}},
        global: {stage: {}, get_pointer: () => pointer},
    });
    const Indicator = factory(class {}, {}, {});
    const indicator = Object.create(Indicator.prototype);
    indicator._source = {
        _iconContainer: {
            get_transformed_position: () => box.slice(0, 2),
            get_transformed_size: () => box.slice(2),
        },
        get_transformed_position: () => [box[0] - 10, box[1] - 10],
        get_transformed_size: () => [100, 100],
    };
    const hit = (x, y) => {
        pointer = [x, y];
        return indicator._pointerOnIndicator();
    };
    for (scale of [1, 2]) {
        indicator._side = Side.LEFT;
        box = [30, 100, 80, 80];
        assert.ok(hit(0, 140));
        assert.ok(hit(30 + 10 * scale, 140));
        assert.equal(hit(70, 140), false);
        assert.equal(hit(-1, 140), false);
        assert.equal(hit(0, 89), false);
        indicator._side = Side.RIGHT;
        box = [390, 100, 80, 80];
        assert.ok(hit(499, 140));
        assert.equal(hit(500, 140), false);
        assert.equal(hit(430, 140), false);
        indicator._side = Side.TOP;
        box = [180, 50, 80, 80];
        assert.ok(hit(220, 0));
        assert.equal(hit(220, -1), false);
        assert.equal(hit(220, 90), false);
        indicator._side = Side.BOTTOM;
        box = [180, 290, 80, 80];
        assert.ok(hit(220, 399));
        assert.equal(hit(220, 400), false);
        assert.equal(hit(220, 330), false);
        assert.equal(hit(600, 399), false);
    }
});
