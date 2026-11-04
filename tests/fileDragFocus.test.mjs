import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const {visibleWindow} = await import(`data:text/javascript,${encodeURIComponent(readFileSync(new URL('launcherVisibility.js', root), 'utf8'))}`);
const controllerSource = readFileSync(new URL('fileDragFocus.js', root), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export class', 'class');

// Exercise the real Shell-facing methods without importing GJS GI modules into
// Node. Extraction fails explicitly if a method is removed or renamed.
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

class Signals {
    listeners = new Map();
    nextId = 1;

    connect(name, callback) {
        const id = this.nextId++;
        this.listeners.set(id, {name, callback});
        return id;
    }

    disconnect(id) {
        assert.ok(this.listeners.delete(id), 'disconnect a live signal');
    }

    emit(name) {
        for (const [id, signal] of [...this.listeners]) {
            if (signal.name === name && this.listeners.has(id))
                signal.callback(this);
        }
    }
}

function setup(t) {
    const handler = new Signals();
    const timers = new Map();
    const monitors = new Set();
    const activations = [];
    const activeWorkspace = {};
    const global = {
        display: {focus_window: null},
        workspace_manager: {get_active_workspace: () => activeWorkspace},
    };
    const Main = {
        xdndHandler: handler,
        overview: {visible: false, visibleTarget: false},
        activateWindow: window => {
            activations.push(window);
            global.display.focus_window = window;
            Main.overview.visible = Main.overview.visibleTarget = false;
        },
    };
    const settings = {dockFixed: false, manualhide: false};
    const dock = {
        dockState: 2,
        intellihideEnabled: true,
        overlap: false,
        _intellihide: {getOverlapStatus: () => dock.overlap},
    };
    class Icon extends Signals {
        mapped = true;
        parent = null;
        windows = [];
        hoverCancellations = 0;
        _delegate = this;

        get_parent() { return this.parent; }
        getInterestingWindows() { return filterWindows(this.windows, 0); }
        _cancelOverviewHoverFocus() { this.hoverCancellations++; }
    }
    const box = {
        contains: actor => {
            for (let current = actor; current; current = current.get_parent?.()) {
                if (current === box) return true;
            }
            return false;
        },
    };
    const dash = {_box: box};
    let clock = 0;
    let nextTimer = 1;
    const context = {
        Main,
        global,
        AppIcons: {DockAbstractAppIcon: Icon},
        DockManager: {settings},
        Docking: {DockManager: {settings}},
        visibleWindow,
        State: {SHOWN: 2},
        GLib: {
            PRIORITY_DEFAULT: 0,
            SOURCE_REMOVE: false,
            timeout_add: (_priority, delay, callback) => {
                const id = nextTimer++;
                timers.set(id, {at: clock + delay, callback});
                return id;
            },
            source_remove: id => assert.ok(timers.delete(id), 'remove a live timer'),
        },
        DND: {
            DragMotionResult: {CONTINUE: 0},
            addDragMonitor: monitor => {
                assert.ok(!monitors.has(monitor), 'register monitor only once');
                monitors.add(monitor);
            },
            removeDragMonitor: monitor => assert.ok(monitors.delete(monitor)),
        },
    };
    const filterWindows = vm.runInNewContext(`
        ${method('appIcons.js', 'isWindowUrgent', 'function ')}
        ${method('appIcons.js', 'getInterestingWindows', 'export function ').replace('export ', '')}
        getInterestingWindows;
    `, context);
    const source = `${controllerSource}
        FileDragFocus;
    `;
    const Controller = vm.runInNewContext(source, context);
    Object.assign(dock, vm.runInNewContext(
        `({${method('docking.js', '_isVisibleForFileDrag')}})`, context));
    Object.assign(dash, vm.runInNewContext(
        `({${method('dash.js', 'getAppIconAtActor')}})`, context));
    Object.assign(Icon.prototype, vm.runInNewContext(
        `({${method('appIcons.js', '_getOverviewHoverWindow')}})`, context));
    const controller = new Controller(
        actor => dash.getAppIconAtActor(actor), () => dock._isVisibleForFileDrag());
    t.after(() => {
        controller.destroy();
        assert.equal(timers.size, 0);
        assert.equal(monitors.size, 0);
        assert.equal(handler.listeners.size, 0);
    });

    return {
        handler, timers, monitors, activations, Main, global, settings, dock, controller,
        icon(windows = [this.window()]) {
            const icon = new Icon();
            icon.windows = windows;
            icon.parent = box;
            return icon;
        },
        child(parent) { return {get_parent: () => parent}; },
        window(workspace = activeWorkspace, time = 1, sequence = 1, monitor = 0) {
            return {
                get_workspace: () => workspace,
                get_user_time: () => time,
                get_stable_sequence: () => sequence,
                get_monitor: () => monitor,
            };
        },
        begin() { handler.emit('drag-begin'); },
        end() { handler.emit('drag-end'); },
        motion(actor, source = handler) {
            for (const monitor of monitors)
                assert.equal(monitor.dragMotion({targetActor: actor, source}), 0,
                    'observe the drag without consuming it');
        },
        tick(ms = 200) {
            clock += ms;
            for (const [id, timer] of [...timers]) {
                if (timer.at <= clock && timers.delete(id))
                    assert.equal(timer.callback(), false);
            }
        },
    };
}

test('fixed and unobstructed intellihide docks raise a window after a continuous dwell', t => {
    for (const fixed of [true, false]) {
        const f = setup(t);
        f.settings.dockFixed = fixed;
        const icon = f.icon();
        f.begin();
        f.motion(f.child(icon));
        f.tick(199);
        assert.equal(f.activations.length, 0);
        f.motion(icon); // repeated motion over the same icon must not restart dwell
        f.tick(1);
        assert.deepEqual(f.activations, [icon.windows[0]]);
        assert.equal(icon.hoverCancellations, 1);
        f.motion(icon);
        f.tick();
        assert.equal(f.activations.length, 1);
    }
});

test('Overview permits drag activation even with an otherwise hidden dock', t => {
    for (const property of ['visible', 'visibleTarget']) {
        const f = setup(t);
        f.dock.dockState = 0;
        f.Main.overview[property] = true;
        const icon = f.icon();
        f.global.display.focus_window = icon.windows[0];
        f.begin();
        f.motion(icon);
        f.tick();
        assert.equal(f.activations.length, 1, 'exit Overview to expose even an already-focused window');
        assert.equal(f.Main.overview[property], false);
    }
});

test('a completed pointer peek is not sufficient outside Overview', t => {
    for (const obstructed of [true, false]) {
        const f = setup(t);
        f.dock.intellihideEnabled = obstructed;
        f.dock.overlap = obstructed;
        f.begin(); // SHOWN, but only because the pointer revealed it
        f.motion(f.icon());
        f.tick();
        assert.equal(f.activations.length, 0);
    }
});

test('revealing a previously hidden dock during the drag cannot arm it', t => {
    const f = setup(t);
    f.dock.dockState = 0;
    f.begin();
    f.dock.dockState = 2;
    f.settings.dockFixed = true;
    f.motion(f.icon());
    f.tick();
    assert.equal(f.activations.length, 0);
});

test('leaving an icon cancels, and changing target requires a fresh dwell', t => {
    const f = setup(t);
    const first = f.icon();
    const second = f.icon();
    f.begin();
    f.motion(first);
    f.tick(150);
    f.motion(null);
    f.tick();
    assert.equal(f.activations.length, 0);
    f.motion(first);
    f.tick(150);
    f.motion(second);
    f.tick(100);
    assert.equal(f.activations.length, 0);
    f.tick(100);
    assert.deepEqual(f.activations, [second.windows[0]]);
});

test('internal drags, foreign dock actors, and non-app buttons are ignored', t => {
    const f = setup(t);
    const icon = f.icon();
    f.begin();
    f.motion(icon, {app: {}});
    const foreign = f.icon();
    foreign.parent = null;
    f.motion(foreign);
    f.motion({get_parent: () => null});
    f.tick();
    assert.equal(f.activations.length, 0);
    assert.equal(f.timers.size, 0);
});

test('closed windows and unused launchers do not activate or launch anything', t => {
    const f = setup(t);
    const icon = f.icon();
    f.begin();
    f.motion(icon);
    icon.windows = [];
    f.tick();
    f.motion(f.icon([]));
    f.tick();
    assert.equal(f.activations.length, 0);
});

test('actor destruction, unmapping, visibility changes, and drag-end cancel pending activation', t => {
    for (const action of [
        (f, icon) => icon.emit('destroy'),
        (f, icon) => { icon.mapped = false; },
        f => { f.settings.manualhide = true; },
        f => { f.dock.overlap = true; },
        f => f.end(),
    ]) {
        const f = setup(t);
        const icon = f.icon();
        f.begin();
        f.motion(icon);
        action(f, icon);
        f.tick();
        assert.equal(f.activations.length, 0);
    }
});

test('re-entering the shell resets the old target and unregisters the old monitor', t => {
    const f = setup(t);
    const icon = f.icon();
    f.begin();
    f.motion(icon);
    f.begin();
    f.tick();
    assert.equal(f.activations.length, 0);
    assert.equal(f.monitors.size, 1);
    assert.equal(icon.listeners.size, 0);
    f.motion(icon);
    f.tick();
    assert.equal(f.activations.length, 1);
    f.end();
    assert.equal(f.monitors.size, 0);
});

test('window choice preserves focus, prefers active workspace MRU, and uses filtered windows', t => {
    const f = setup(t);
    const elsewhere = f.window({}, 100);
    const recent = f.window(undefined, 20);
    const old = f.window(undefined, 10);
    const icon = f.icon([elsewhere, old, recent]);
    f.begin();
    f.motion(icon);
    f.tick();
    assert.deepEqual(f.activations, [recent]);
    f.end();
    f.global.display.focus_window = old;
    f.begin();
    f.motion(icon);
    f.tick();
    assert.equal(f.activations.length, 1, 'do not switch away from the focused app window');
    f.end();
    icon.windows = [elsewhere]; // workspace/monitor filters supply the relevant set
    f.begin();
    f.motion(icon);
    f.tick();
    assert.deepEqual(f.activations, [recent, elsewhere]);
});

test('workspace and monitor isolation exclude inappropriate window targets', t => {
    const f = setup(t);
    const otherWorkspace = f.window({}, 100);
    const otherMonitor = f.window(undefined, 90, 1, 1);
    const local = f.window(undefined, 1);
    const icon = f.icon([otherWorkspace, otherMonitor, local]);
    f.settings.isolateWorkspaces = true;
    f.settings.isolateMonitors = true;
    f.begin();
    f.motion(icon);
    f.tick();
    assert.deepEqual(f.activations, [local]);
    f.end();
    icon.windows = [otherWorkspace, otherMonitor];
    f.begin();
    f.motion(icon);
    f.tick();
    assert.equal(f.activations.length, 1, 'do not fall back to isolated-away windows');
});

test('disabling during an active drag releases every signal, monitor and timer', t => {
    const f = setup(t);
    const icon = f.icon();
    f.begin();
    f.motion(icon);
    f.controller.destroy();
    assert.equal(f.timers.size, 0);
    assert.equal(f.monitors.size, 0);
    assert.equal(f.handler.listeners.size, 0);
    assert.equal(icon.listeners.size, 0);
    f.tick();
    assert.equal(f.activations.length, 0);
});
