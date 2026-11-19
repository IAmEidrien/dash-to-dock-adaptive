// SPDX-FileCopyrightText: Eidrien
// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import test from 'node:test';
import vm from 'node:vm';
const activity = readFileSync(new URL('../activityIndicator.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replace(/export /g, '');
const upstream = readFileSync(new URL('../appIconIndicators.js', import.meta.url), 'utf8');
const solid = upstream.slice(
    upstream.indexOf('class RunningIndicatorSolid '),
    upstream.indexOf('class RunningIndicatorSquares ')
);
const metro = upstream.slice(
    upstream.indexOf('class RunningIndicatorMetro '),
    upstream.indexOf('class RunningIndicatorBinary ')
);
const state = {backlit: false, custom: false, idle: 'dot'};
const settings = {
    get_boolean: key => key === 'unity-backlit-items' ? state.backlit : state.custom,
    get_string: () => state.idle,
    get_enum: () => 10,
};
const Utils = {cairoSetSourceColor: (cr, color) => cr.colors.push(color)};
const {Indicator, solidDraw} = vm.runInNewContext(
    `
    ${activity}
    class RunningIndicatorDots {}
    ${solid}
    ${metro}
    ({Indicator: createActivityIndicator(RunningIndicatorDots, {
        5: RunningIndicatorSolid.prototype._drawIndicator,
        7: RunningIndicatorMetro.prototype._drawIndicator
    }, Utils), solidDraw: RunningIndicatorSolid.prototype._drawIndicator})`,
    {
        ACTIVITY_STYLE: 10,
        Utils,
        Docking: {
            DockManager: {
                settings: {
                    get unityBacklitItems() {
                        return state.backlit;
                    },
                    get customThemeCustomizeRunningDots() {
                        return state.custom;
                    },
                },
            },
        },
    }
);
const context = () => ({
    arcs: [],
    rects: [],
    colors: [],
    offset: [0, 0],
    arc(...args) {
        this.arcs.push(args);
    },
    rectangle(...args) {
        this.rects.push(args);
    },
    translate(x, y) {
        this.offset = [x, y];
    },
    setLineWidth() {},
    newSubPath() {},
    closePath() {},
    strokePreserve() {},
    fill() {},
});

test('Activity capsule matches actual Solid thickness and placement at both scales and border modes', () => {
    for (const scale of [1, 2]) {
        for (const border of [0, 2 * scale, 8 * scale]) {
            for (const backlit of [false, true]) {
                for (const custom of [false, true]) {
                    state.backlit = backlit;
                    state.custom = custom;
                    const i = Object.assign(Object.create(Indicator.prototype), {
                        _source: {running: true},
                        _width: 50 * scale,
                        _height: 50 * scale,
                        _borderWidth: border,
                        _borderColor: 'border',
                        _bodyColor: 'body',
                        style: 10,
                        active: true,
                        _cpu: 100,
                        fraction: 1,
                        morph: false,
                        settings,
                    });
                    const line = context(),
                        capsule = context();
                    solidDraw.call(i, line);
                    if (border === 0) {
                        assert.equal(
                            line.rects[0][3],
                            2.5 * scale,
                            'Solid keeps its established width/20 body height'
                        );
                    }
                    i._drawIndicator(capsule);
                    assert.equal(capsule.arcs[0][2] * 2, line.rects[0][3]);
                    assert.equal(capsule.arcs[0][1] - capsule.arcs[0][2], line.offset[1]);
                    assert.deepEqual(capsule.colors, line.colors);
                    i.fraction = 0;
                    const dot = context();
                    i._drawIndicator(dot);
                    assert.equal(dot.arcs[0][0], dot.arcs[1][0], 'zero activity is circular');
                }
            }
        }
    }
});

test('idle Line delegates to Solid and Metro is confined to idle state and owned styling', () => {
    const classes = new Set();
    const i = Object.assign(Object.create(Indicator.prototype), {
        _source: {
            running: true,
            focused: true,
            add_style_class_name: name => classes.add(name),
            remove_style_class_name: name => classes.delete(name),
        },
        _width: 50,
        _height: 50,
        _number: 1,
        _borderWidth: 0,
        _borderColor: 'border',
        _bodyColor: 'body',
        style: 10,
        active: false,
        fraction: 1,
        morph: false,
        settings,
    });
    state.idle = 'line';
    state.backlit = false;
    state.custom = false;
    const line = context(),
        expected = context();
    i._drawIndicator(line);
    solidDraw.call(i, expected);
    assert.deepEqual(
        [line.rects, line.colors, line.offset],
        [expected.rects, expected.colors, expected.offset]
    );
    state.idle = 'metro';
    i.syncIdleStyle();
    assert.ok(classes.has('activity-idle-metro'));
    const m = context();
    i._drawIndicator(m);
    assert.equal(m.rects[0][3], 2.5);
    i.active = true;
    i.syncIdleStyle();
    assert.equal(classes.size, 0, 'entering Activity mode restores normal launcher rounding');
    i.active = false;
    i.syncIdleStyle();
    i.retiring = true;
    i.syncIdleStyle();
    assert.equal(classes.size, 0, 'retiring renderer relinquishes its style class');
});
