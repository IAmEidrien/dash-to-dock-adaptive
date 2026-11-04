import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

function method(file, name) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const start = source.indexOf(`    ${name}(`);
    assert.notEqual(start, -1);
    let end = source.indexOf('{', start) + 1, depth = 1;
    while (depth) {
        if (source[end] === '{') depth++;
        if (source[end] === '}') depth--;
        end++;
    }
    return source.slice(start, end);
}

test('workspace navigation avoids explicit focus unless the suboption is enabled', () => {
    let switches = 0, focuses = 0;
    const workspace = {activate() {switches++;}};
    const window = {get_workspace: () => workspace, focus() {focuses++;}};
    const settings = {overviewHoverFocusWindow: false};
    const context = {Docking: {DockManager: {settings}}, Main: {overview: {visible: true}},
        global: {get_current_time: () => 1, workspace_manager: {get_active_workspace: () => ({})}}};
    const icon = vm.runInNewContext(`({${method('appIcons.js', '_focusOverviewAppOnHover')}})`, context);
    icon._getOverviewHoverWindow = () => window;
    icon._focusOverviewAppOnHover();
    assert.equal(switches, 1);assert.equal(focuses, 0);
    settings.overviewHoverFocusWindow = true;
    icon._focusOverviewAppOnHover();
    assert.equal(switches, 2);assert.equal(focuses, 1);
});

test('padding uses visual endpoints on both axes, excludes controls and stays inside the dock', () => {
    for (const horizontal of [false, true]) {
        const actor = (start, size) => ({mapped: true,
            get_transformed_position: () => horizontal ? [start, 0] : [0, start],
            get_transformed_size: () => horizontal ? [size, 20] : [20, size]});
        const container = actor(0, 100);
        const icons = [actor(20, 20), actor(60, 20)];
        icons.forEach(icon => Object.assign(icon, {app: {}, _onOverviewHoverChanged() {},
            _cancelOverviewHoverFocus() {}}));
        const settings = {overviewHoverExtendPadding: true, focusOverviewAppOnHover: true};
        const context = {Docking: {DockManager: {settings}}, Main: {overview: {visible: true}},
            global: {stage: {get_event_actor: () => container}}};
        const dash = vm.runInNewContext(`({${method('dash.js', '_updatePaddingHover')},
            ${method('dash.js', '_clearPaddingHover')}})`, context);
        Object.assign(dash, {_isHorizontal: horizontal, _dashContainer: container,
            getAppIcons: () => [...icons].reverse()});
        const move = position => dash._updatePaddingHover({get_coords: () =>
            horizontal ? [position, 5] : [5, position]});
        move(5);assert.equal(dash._paddingHoverIcon, icons[0]);
        move(95);assert.equal(dash._paddingHoverIcon, icons[1]);
        move(110);assert.equal(dash._paddingHoverIcon, null);
        dash._showAppsIcon = actor(0, 10);
        move(5);assert.equal(dash._paddingHoverIcon, null);
        move(15);assert.equal(dash._paddingHoverIcon, icons[0]);
        settings.overviewHoverExtendPadding = false;
        move(15);assert.equal(dash._paddingHoverIcon, null);
    }
});
