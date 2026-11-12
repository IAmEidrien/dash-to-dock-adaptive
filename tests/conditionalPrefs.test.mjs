// SPDX-FileCopyrightText: Eidrien
// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {URL} from 'node:url';
import test from 'node:test';
import vm from 'node:vm';
test('conditional rules hide irrelevant controls without writing saved preferences', () => {
    const text = readFileSync(new URL('../conditionalPrefs.js', import.meta.url), 'utf8').replace(
        /export /g,
        ''
    );
    const {conditionalPreferences, preferenceRules} = vm.runInNewContext(
        `(()=>{${text};return {conditionalPreferences,preferenceRules};})()`
    );
    const xml = readFileSync(new URL('../Settings.ui', import.meta.url), 'utf8');
    const objects = new Map();
    for (const [ids] of preferenceRules) {
        for (const id of ids) {
            assert.ok(xml.includes(`id="${id}"`), id);
            objects.set(id, {});
        }
    }
    objects.set('running_indicators_advance_settings_button', {});
    const values = {'multi-monitor': true, 'extend-height': true};
    let refresh,
        disconnected = false;
    const settings = {
        get_boolean: key => !!values[key],
        get_enum: () => 0,
        connect(_signal, cb) {
            refresh = cb;
            return 1;
        },
        disconnect() {
            disconnected = true;
        },
    };
    const handle = conditionalPreferences({get_object: id => objects.get(id)}, settings);
    assert.equal(objects.get('dock_monitor_combo').visible, false);
    assert.equal(objects.get('dock_monitor_label').visible, false);
    assert.equal(objects.get('dock_size_scale').visible, false);
    assert.equal(objects.get('dock_center_icons_check').visible, true);
    values['multi-monitor'] = false;
    values['focus-overview-app-on-hover'] = true;
    refresh();
    assert.equal(objects.get('dock_monitor_combo').visible, true);
    assert.equal(objects.get('overview_hover_focus_delay_spinbutton').visible, true);
    handle.destroy();
    assert.ok(disconnected);
});
