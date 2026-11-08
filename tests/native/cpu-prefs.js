// SPDX-FileCopyrightText: Eidrien
// SPDX-License-Identifier: MIT
/* eslint-disable no-await-in-loop */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import System from 'system';
Gio.resources_register(
    Gio.Resource.load('/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource')
);
const {ExtensionPreferences} =
    await import('resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js');
const dir = Gio.File.new_for_path(ARGV[0]),
    output = ARGV[1];
const meta = JSON.parse(new TextDecoder().decode(dir.get_child('metadata.json').load_contents(null)[1]));
Object.assign(meta, {dir, path: dir.get_path()});
const {default: Preferences} = await import(dir.get_child('prefs.js').get_uri());
const app = new Adw.Application({application_id: 'org.eidrien.CpuPreferencesTest'});
const wait = ms =>
    new Promise(resolve =>
        GLib.timeout_add(0, ms, () => {
            resolve();
            return false;
        })
    );
const walk = w => {
    const a = [w];
    for (let c = w.get_first_child(); c; c = c.get_next_sibling())
        a.push(...walk(c));
    return a;
};
app.connect('activate', () => {
    (async () => {
        const checks = [],
            check = (ok, label) => {
                if (!ok)
                    throw Error(label);
                checks.push(label);
            };
        const prefs = new Preferences(meta);
        ExtensionPreferences.lookupByURL = () => prefs;
        const window = new Adw.PreferencesWindow({application: app});
        prefs.fillPreferencesWindow(window);
        window.present();
        await wait(200);
        const widgets = walk(window),
            byId = id =>
                [...widgets, ...Gtk.Window.list_toplevels().flatMap(walk)].find(
                    w => w.get_buildable_id?.() === id
                );
        const settings = prefs.getSettings('org.gnome.shell.extensions.dash-to-dock');
        const combo = byId('running_indicators_combo');
        check(
            combo.get_model().get_value(combo.get_model().get_iter_first()[1], 0) ===
                'Activity (Experimental)',
            'Activity is first indicator option'
        );
        const activityTitle = widgets.find(
            w => w instanceof Gtk.Label && w.label === 'CPU Activity mode — Experimental'
        );
        settings.set_enum('running-indicator-style', 0);
        check(!activityTitle.get_parent().visible, 'CPU options hidden for ordinary style');
        settings.set_enum('running-indicator-style', 10);
        check(activityTitle.get_parent().visible, 'CPU options shown for Activity mode');
        const idle = widgets
            .find(w => w instanceof Gtk.Label && w.label === 'Idle appearance')
            .get_parent()
            .get_last_child();
        for (const name of ['dot', 'line', 'metro']) {
            idle.set_active_id(name);
            check(settings.get_string('adaptive-cpu-idle') === name, `idle appearance saved: ${name}`);
        }
        settings.set_enum('running-indicator-style', 2);
        settings.set_enum('running-indicator-style', 10);
        check(idle.get_active_id() === 'metro', 'Metro idle survives style changes');
        settings.reset('adaptive-cpu-animation');
        check(settings.get_int('adaptive-cpu-animation') === 1000, 'animation default is one second');
        const animationRow = widgets
            .find(w => w instanceof Gtk.Label && w.label === 'Animation duration (seconds)')
            .get_parent();
        const animation = animationRow.get_last_child();
        check(
            animation.digits === 1 && animation.adjustment.upper === 5,
            'fractional seconds through five seconds'
        );
        animation.value = 4.7;
        check(
            settings.get_int('adaptive-cpu-animation') === 4700,
            'seconds control preserves millisecond storage'
        );
        settings.set_int('adaptive-cpu-animation', 700);
        check(
            Math.abs(animation.value - 0.7) < 0.001,
            'stored milliseconds display as fractional seconds'
        );
        settings.set_enum('running-indicator-style', 2);
        settings.set_enum('running-indicator-style', 10);
        check(settings.get_int('adaptive-cpu-animation') === 700, 'style changes preserve CPU settings');
        for (const mode of [0, 1, 3]) {
            settings.set_enum('transparency-mode', mode);
            check(byId('custom_opacity').visible === (mode === 1), `opacity slider relevance ${mode}`);
            check(
                byId('dynamic_opacity_button').visible === (mode === 3),
                `opacity button relevance ${mode}`
            );
        }
        settings.set_boolean('multi-monitor', true);
        check(
            !byId('dock_monitor_combo').visible && !byId('dock_monitor_label').visible,
            'all monitors hides selector and label'
        );
        settings.set_boolean('multi-monitor', false);
        check(byId('dock_monitor_combo').visible, 'single monitor selection restored');
        for (const mode of [0, 1, 2]) {
            settings.set_enum('scroll-action', mode);
            check(
                byId('workspace_scroll_delay_spinbutton').visible === (mode !== 0),
                `scroll delay relevance ${mode}`
            );
        }
        settings.set_boolean('focus-overview-app-on-hover', false);
        check(
            !byId('overview_hover_focus_delay_spinbutton').visible,
            'hover delay hidden when hover navigation off'
        );
        settings.set_boolean('extend-height', true);
        check(
            !byId('dock_size_scale').visible && byId('dock_center_icons_check').visible,
            'panel mode hides size limit and reveals centering'
        );
        settings.set_boolean('show-mounts', false);
        check(!byId('show_only_mounted_devices_check').visible, 'mount details hidden when mounts off');
        settings.set_boolean('show-icons-emblems', false);
        check(
            !byId('notifications_counter_check').visible &&
                !byId('applications_override_counter').visible,
            'emblem details contextual'
        );
        settings.set_boolean('hot-keys', false);
        check(!byId('overlay_button').visible, 'shortcut details contextual');
        settings.set_boolean('custom-background-color', false);
        check(!byId('custom_background_color').visible, 'background color contextual');
        settings.set_boolean('show-windows-preview', false);
        check(!byId('preview_size_listboxrow').visible, 'preview size hidden when previews off');
        settings.set_boolean('dock-fixed', false);
        byId('intelligent_autohide_button').emit('clicked');
        await wait(100);
        settings.set_boolean('intellihide', false);
        check(!byId('intellihide_mode_box').visible, 'dodge modes hidden when intellihide off');
        settings.set_boolean('autohide', true);
        settings.set_boolean('require-pressure-to-show', true);
        check(
            byId('pressure_threshold_spinbutton').visible && !byId('show_timeout_spinbutton').visible,
            'pressure threshold replaces show delay'
        );
        settings.set_boolean('require-pressure-to-show', false);
        check(
            !byId('pressure_threshold_spinbutton').visible && byId('show_timeout_spinbutton').visible,
            'show delay replaces pressure threshold'
        );
        settings.set_boolean('autohide', false);
        check(
            !byId('require_pressure_checkbutton').visible && !byId('show_timeout_spinbutton').visible,
            'autohide details hidden when off'
        );
        for (const w of Gtk.Window.list_toplevels()) {
            if (w instanceof Gtk.Dialog)
                w.response(Gtk.ResponseType.CLOSE);
        }


        byId('running_indicators_advance_settings_button').emit('clicked');
        await wait(100);
        settings.set_boolean('custom-theme-customize-running-dots', true);
        check(
            byId('dot_style_settings_box').visible && !byId('dominant_color_switch').visible,
            'manual indicator colors hide ignored dominant option'
        );
        settings.set_boolean('custom-theme-customize-running-dots', false);
        check(
            !byId('dot_style_settings_box').visible && byId('dominant_color_switch').visible,
            'ordinary indicator color options restored'
        );
        for (const w of Gtk.Window.list_toplevels()) {
            if (w instanceof Gtk.Dialog)
                w.response(Gtk.ResponseType.CLOSE);
        }


        settings.set_enum('transparency-mode', 3);
        byId('dynamic_opacity_button').emit('clicked');
        await wait(100);
        settings.set_boolean('customize-alphas', false);
        check(
            !byId('min_alpha_box').visible && !byId('max_alpha_box').visible,
            'manual alpha ranges contextual'
        );
        settings.set_boolean('customize-alphas', true);
        check(
            byId('min_alpha_box').visible && byId('max_alpha_box').visible,
            'manual alpha ranges restored'
        );
        for (const w of Gtk.Window.list_toplevels()) {
            if (w instanceof Gtk.Dialog)
                w.response(Gtk.ResponseType.CLOSE);
        }


        app.hold();
        window.close();
        await wait(100);
        GLib.file_set_contents(`${output}/prefs-result.json`, JSON.stringify({pass: true, checks}));
        app.release();
        app.quit();
    })().catch(error => {
        logError(error);
        GLib.file_set_contents(
            `${output}/prefs-result.json`,
            JSON.stringify({error: String(error), stack: error.stack})
        );
        System.exit(1);
    });
});
await app.runAsync([]);
