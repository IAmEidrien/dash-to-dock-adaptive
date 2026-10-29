import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Exercise the actual monitor and model-management code. These fixtures model
// synchronous GJS signal delivery; native Shell checks cover the real widgets.
class Signals {
    connect(signal, callback) {
        this.listeners ??= new Map();
        this.nextId = (this.nextId ?? 0) + 1;
        this.listeners.set(this.nextId, {signal, callback});
        return this.nextId;
    }

    disconnect(id) {
        this.listeners.delete(id);
    }

    emit(signal, ...args) {
        for (const [id, listener] of [...(this.listeners ?? [])]) {
            if (this.listeners.has(id) && listener.signal === signal)
                listener.callback(this, ...args);
        }
    }
}

class Handler {
    entries = [];
    add(object, signal, callback) {
        this.addWithLabel(null, object, signal, callback);
    }

    addWithLabel(label, object, signal, callback) {
        this.entries.push({label, object, id: object.connect(signal, callback)});
    }

    removeWithLabel(label) {
        this.entries = this.entries.filter(entry => {
            if (entry.label !== label)
                return true;
            entry.object.disconnect(entry.id);
            return false;
        });
    }

    destroy() {
        for (const {object, id} of this.entries)
            object.disconnect(id);
        this.entries = [];
    }
}

const monitorSource = readFileSync(new URL('../notificationsMonitor.js', import.meta.url), 'utf8')
    .replace(/^import[\s\S]*?from '[^']+';\n/gm, '')
    .replace('export class NotificationsMonitor', 'class NotificationsMonitor');
const dockingSource = readFileSync(new URL('../docking.js', import.meta.url), 'utf8');
const modelStart = dockingSource.indexOf('        const needsRemoteModel =');
const modelEnd = dockingSource.indexOf('        ensureRemoteModel();', modelStart);
assert(modelStart >= 0 && modelEnd > modelStart);
const modelSource = dockingSource.slice(modelStart, modelEnd);

function fixture(dnd, counter, emblems) {
    const notifications = new Signals();
    notifications.banners = !dnd;
    notifications.get_boolean = () => notifications.banners;
    const settings = new Signals();
    Object.assign(settings, {showIconsNotificationsCounter: counter, showIconsEmblems: emblems});
    const tray = new Signals();
    tray.getSources = () => [];
    const models = [];
    class Model {
        constructor() {
            models.push(this);
        }

        destroy() {
            this.destroyed = true;
        }
    }
    const context = vm.createContext({
        Gio: {Settings: class { constructor() { return notifications; } }},
        Main: {messageTray: tray},
        Docking: {DockManager: {settings}},
        Utils: {GlobalSignalsHandler: Handler},
        LauncherAPI: {LauncherEntryRemoteModel: Model},
        AppIconsDecorator: {AppIconsDecorator: class { destroy() {} }},
        imports: {signals: {addSignalMethods(prototype) {
            for (const name of ['connect', 'disconnect', 'emit'])
                prototype[name] = Signals.prototype[name];
        }}},
    });
    const Monitor = vm.runInContext(`${monitorSource}\nNotificationsMonitor;`, context);
    const monitor = new Monitor();
    const manager = {_notificationsMonitor: monitor, _settings: settings};
    const ensureModel = vm.runInContext(`(function () {
        ${modelSource}
        ensureRemoteModel();
        return ensureRemoteModel;
    })`, context).call(manager);
    // Deliberately register icons first: model readiness must not depend on
    // the registration order of consumers of state-changed.
    const observed = [];
    monitor.connect('state-changed', () => {
        assert.equal(!!manager._remoteModel, !monitor.dndMode && settings.showIconsEmblems);
        assert.equal(monitor.enabled, !monitor.dndMode && settings.showIconsNotificationsCounter);
        observed.push(monitor.dndMode);
    });
    monitor.connect('dnd-changed', ensureModel);
    return {monitor, manager, settings, models, observed,
        setDnd(value) {
            notifications.banners = !value;
            notifications.emit('changed::show-banners');
        },
        setCounter(value) {
            settings.showIconsNotificationsCounter = value;
            settings.emit('changed::show-icons-notifications-counter');
        },
        notifications};
}

for (const dnd of [false, true]) {
    for (const counter of [false, true]) {
        for (const emblems of [false, true]) {
            test(`DND lifecycle: login=${dnd}, counter=${counter}, emblems=${emblems}`, () => {
                const f = fixture(dnd, counter, emblems);
                assert.equal(f.monitor.enabled, !dnd && counter);
                assert.equal(!!f.manager._remoteModel, !dnd && emblems);
                for (let i = 0; i < 3; i++) {
                    f.setDnd(!dnd);
                    f.setDnd(dnd);
                }
                assert.equal(f.observed.length, 6);
                f.setDnd(false);
                const model = f.manager._remoteModel;
                f.setCounter(!counter);
                f.setCounter(counter);
                assert.equal(f.manager._remoteModel, model);
                f.setDnd(true);
                assert(f.models.every(m => m.destroyed));
                f.monitor.destroy();
                assert.equal(f.notifications.listeners.size, 0);
                assert.equal(f.settings.listeners.size, 0);
            });
        }
    }
}
