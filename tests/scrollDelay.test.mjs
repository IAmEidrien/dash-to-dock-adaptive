// SPDX-FileCopyrightText: Eidrien
// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import test from 'node:test';
import vm from 'node:vm';
test('window cycling honors the shared scroll delay and zero disables throttling', () => {
    const source = readFileSync(new URL('../appIcons.js', import.meta.url), 'utf8');
    const method = source.slice(source.indexOf('    vfunc_scroll_event('), source.indexOf('    _updateWindows()'));
    let delay, next = 0, cycles = 0;
    const settings = {scrollAction: 1, workspaceScrollDelay: 77};
    const Clutter = {EVENT_PROPAGATE: 0, EVENT_STOP: 1, ScrollDirection: {UP: 0, DOWN: 1, SMOOTH: 2}};
    const object = vm.runInNewContext(`({${method}})`, {
        Docking: {DockManager: {settings}},
        scrollAction: {CYCLE_WINDOWS: 1}, Clutter, Meta: {MotionDirection: {UP: 0, DOWN: 1}},
        Main: {overview: {visible: false}}, GLib: {
            PRIORITY_DEFAULT: 0, SOURCE_REMOVE: false,
            timeout_add(_priority, value, cb) {
                delay = value; next = cb; return 1;
            }, source_remove() {},
        },
    });
    Object.assign(object, {
        running: true, focused: true, _urgentWindows: new Set(),
        _cycleThroughWindows() {
            cycles++;
        },
    });
    const event = {direction: 1};
    object.vfunc_scroll_event(event); object.vfunc_scroll_event(event);
    assert.equal(delay, 77); assert.equal(cycles, 1);
    next(); object.vfunc_scroll_event(event); assert.equal(cycles, 2);
    settings.workspaceScrollDelay = 0;
    object.vfunc_scroll_event(event); object.vfunc_scroll_event(event);
    assert.equal(cycles, 4); assert.equal(object._optionalScrollCycleWindowsDeadTimeId, 0);
});
