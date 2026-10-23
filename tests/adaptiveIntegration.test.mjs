import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);

// Evaluate actual adaptive methods, without pretending Node runs GNOME Shell.
function method(file, name, prefix = '    ') {
    const source = readFileSync(new URL(file, root), 'utf8');
    const start = source.indexOf(`${prefix}${name}(`);
    assert.notEqual(start, -1);
    const body = source.indexOf('{', start);
    let depth = 1;
    let end = body + 1;
    while (depth && end < source.length) {
        if (source[end] === '{') depth++;
        if (source[end] === '}') depth--;
        end++;
    }
    assert.equal(depth, 0);
    return source.slice(start, end);
}

function positionFixture() {
    const Side = {TOP: 0, RIGHT: 1, BOTTOM: 2, LEFT: 3};
    const settings = {dockPosition: Side.LEFT, autoAvoidJoinedMonitor: true, multiMonitor: false};
    const monitor = {x: 0, y: 0, width: 1000, height: 800};
    const layout = {monitors: [monitor], primaryIndex: 0};
    let direction = 0;
    let preferred = 0;
    const getPosition = vm.runInNewContext(`
        ${method('utils.js', 'getPosition', 'export function ').replace('export ', '')}
        getPosition;
    `, {
        Docking: {DockManager: {settings, getDefault: () => ({_preferredMonitorIndex: preferred})}},
        Main: {layoutManager: layout}, St: {Side},
        Clutter: {TextDirection: {RTL: 1}, get_default_text_direction: () => direction},
    });
    return {Side, settings, layout, monitor, getPosition,
        rtl() { direction = 1; }, prefer(index) { preferred = index; }};
}

test('adaptive ordering groups by earliest relevant workspace before usage', () => {
    let activeWorkspace = 2;
    const settings = {isolateWorkspaces: false, isolateMonitors: false};
    const methods = vm.runInNewContext(`({
        ${method('dash.js', '_getAppWorkspaceIndex')},
        ${method('dash.js', '_compareAppsByWorkspaceAndUsage')},
    })`, {
        AppIcons: {getInterestingWindows: windows => windows.filter(w => !w.skipTaskbar)},
        global: {workspace_manager: {get_active_workspace_index: () => activeWorkspace}},
        Docking: {DockManager: {settings}},
    });
    const makeWindow = (index, sticky = false) => ({
        get_workspace: () => ({index: () => index}),
        is_on_all_workspaces: () => sticky,
    });
    const app = (name, windows) => ({name, get_windows: () => windows});
    const early = app('early', [makeWindow(0)]);
    const mixed = app('mixed', [makeWindow(3), makeWindow(1)]);
    const late = app('late', [makeWindow(2)]);
    const sticky = app('sticky', [makeWindow(0, true)]);
    const dash = {...methods, _monitorIndex: 0,
        _compareAppsByUsage: (a, b) => b.name.localeCompare(a.name)};
    assert.equal(dash._getAppWorkspaceIndex(mixed), 1);
    assert.equal(dash._compareAppsByWorkspaceAndUsage(early, mixed) < 0, true);
    assert.equal(dash._compareAppsByWorkspaceAndUsage(mixed, late) < 0, true);
    assert.equal(dash._getAppWorkspaceIndex(sticky), activeWorkspace);
    activeWorkspace = 0;
    assert.equal(dash._getAppWorkspaceIndex(sticky), 0);
    assert.equal(dash._getAppWorkspaceIndex(app('pending', [])), Infinity);
    assert.equal(dash._compareAppsByWorkspaceAndUsage(early,
        app('another', [makeWindow(0)])) < 0, true,
    'usage remains the tie-breaker within a workspace');
});

test('monitor joins use the symmetric opposite edge and disconnects restore the saved preference', () => {
    const f = positionFixture();
    const {LEFT, RIGHT, TOP, BOTTOM} = f.Side;
    for (const [side, opposite, x, y] of [
        [LEFT, RIGHT, -1000, 0], [RIGHT, LEFT, 1000, 0],
        [TOP, BOTTOM, 0, -800], [BOTTOM, TOP, 0, 800],
    ]) {
        f.settings.dockPosition = side;
        f.layout.monitors = [f.monitor, {...f.monitor, x, y}];
        assert.equal(f.getPosition(), opposite);
        assert.equal(f.settings.dockPosition, side, 'never rewrite the saved edge');
        f.layout.monitors = [f.monitor];
        assert.equal(f.getPosition(), side);
    }
});

test('corner contacts, gaps, the opt-out and multi-monitor mode do not flip the dock', () => {
    const f = positionFixture();
    for (const [x, y] of [[-1000, 800], [-1001, 0]]) {
        f.layout.monitors = [f.monitor, {...f.monitor, x, y}];
        assert.equal(f.getPosition(), f.Side.LEFT);
    }
    f.layout.monitors = [f.monitor, {...f.monitor, x: -1000}];
    f.settings.autoAvoidJoinedMonitor = false;
    assert.equal(f.getPosition(), f.Side.LEFT);
    f.settings.autoAvoidJoinedMonitor = true;
    f.settings.multiMonitor = true;
    assert.equal(f.getPosition(), f.Side.LEFT);
});

test('monitor avoidance respects RTL and the preferred dock monitor', () => {
    const f = positionFixture();
    f.rtl();
    f.layout.monitors = [f.monitor, {...f.monitor, x: 1000}];
    assert.equal(f.getPosition(), f.Side.LEFT, 'RTL preference is physically right, then flips left');
    f.layout.monitors = [f.monitor];
    assert.equal(f.getPosition(), f.Side.RIGHT);
    f.layout.monitors = [{...f.monitor, x: -1000}, f.monitor];
    f.prefer(1);
    assert.equal(f.getPosition(), f.Side.RIGHT, 'the left neighbour does not occupy the physical right edge');
});

test('crowding measures the full desired layout at preferred icon size before hiding secondary items', () => {
    const settings = {adaptiveAppsOnlyWhenCrowded: true, showShowAppsButton: true};
    const context = {Docking: {DockManager: {settings}}, Main: {overview: {isDummy: false}}};
    const methods = vm.runInNewContext(`({
        ${method('dash.js', '_isSecondaryDockApp')},
        ${method('dash.js', '_shouldUseAdaptiveAppsOnlyMode')},
    })`, context);
    const calls = [];
    const dash = {...methods, iconSize: 24, _availableIconSizes: [16, 24, 48],
        _dockWouldExceedIconSize(...args) { calls.push(args); return true; }};
    const apps = [{id: 'primary'}, {isTrash: true}, {location: '/media/disk'}];
    assert.equal(dash._shouldUseAdaptiveAppsOnlyMode(apps, 1), true);
    assert.deepEqual(calls, [[3, true, true, 48]], 'neither the shrunken size nor apps-only count is used');
    settings.adaptiveAppsOnlyWhenCrowded = false;
    assert.equal(dash._shouldUseAdaptiveAppsOnlyMode(apps, 1), false);
    settings.adaptiveAppsOnlyWhenCrowded = true;
    settings.showShowAppsButton = false;
    assert.equal(dash._shouldUseAdaptiveAppsOnlyMode([apps[0]], 1), false);
    assert.equal(calls.length, 1, 'no secondary targets means nothing can be hidden');
});
