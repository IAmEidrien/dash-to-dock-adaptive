// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

import {DockManager} from './docking.js';
import {Gio, GLib} from './dependencies/gi.js';
import {visibleWindow} from './launcherVisibility.js';
import {Extension} from './dependencies/shell/extensions/extension.js';

// We export this so it can be accessed by other extensions
export let dockManager;

export default class DashToDockExtension extends Extension.Extension {
    enable() {
        // TODO: Remove this when upstream will disable extensions on shutdown
        // See: https://gitlab.gnome.org/GNOME/gnome-shell/-/merge_requests/4214
        this._shutdownID = global.connect('shutdown', () => this.disable());
        dockManager = new DockManager(this);
        const settings = this.getSettings('org.gnome.shell.extensions.dash-to-dock');
        if (!settings.get_boolean('retain-unavailable-applications')) {
            const ids = settings.get_strv('hidden-applications');
            const retained = ids.filter(id => Gio.DesktopAppInfo.new(id));
            if (retained.length !== ids.length)
                settings.set_strv('hidden-applications', retained);
        }
        this._visibilitySignals = [];
        this._visibilityWindows = new Map();
        const connect = (object, signal, callback) =>
            this._visibilitySignals.push([object, object.connect(signal, callback)]);
        const refresh = () => {
            if (this._visibilityIdle)
                return;
            this._visibilityIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._visibilityIdle = 0;
                DockManager.allDocks.forEach(dock => dock.dash.resetAppIcons());
                return GLib.SOURCE_REMOVE;
            });
        };
        const watch = window => {
            let visible = visibleWindow(window, DockManager.settings);
            const changed = () => {
                const next = visibleWindow(window, DockManager.settings);
                if (next === visible)
                    return;
                visible = next;
                refresh();
            };
            this._visibilityWindows.set(window, changed);
            for (const signal of ['notify::maximized-horizontally',
                'notify::maximized-vertically', 'notify::fullscreen',
                'notify::is-fullscreen', 'size-changed'])
                connect(window, signal, changed);
            connect(window, 'unmanaged', () => {
                this._visibilityWindows.delete(window);
                this._visibilitySignals = this._visibilitySignals.filter(([object, id]) => {
                    if (object !== window)
                        return true;
                    object.disconnect(id);
                    return false;
                });
            });
        };
        global.get_window_actors().forEach(actor => watch(actor.meta_window));
        connect(global.display, 'window-created', (_display, window) => watch(window));
        for (const key of ['hidden-applications', 'hide-floating-windows', 'hide-transient-windows']) {
            connect(settings, `changed::${key}`, () => {
                this._visibilityWindows.forEach(changed => changed());
                refresh();
            });
        }
    }

    disable() {
        if (this._visibilityIdle)
            GLib.source_remove(this._visibilityIdle);
        this._visibilityIdle = 0;
        for (const [object, id] of this._visibilitySignals ?? [])
            object.disconnect(id);
        this._visibilitySignals = [];
        this._visibilityWindows?.clear();
        global.disconnect(this._shutdownID);
        delete this._shutdownID;
        dockManager?.destroy();
        dockManager = null;
    }
}
