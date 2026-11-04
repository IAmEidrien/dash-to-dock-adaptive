// SPDX-FileCopyrightText: Eidrien
// SPDX-License-Identifier: GPL-2.0-or-later
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import {gettext as __} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export function showVisibilityPreferences(parent, settings) {
    const dialog = new Gtk.Dialog({
        title: __('Launcher visibility'), transient_for: parent,
        modal: true, destroy_with_parent: true, default_width: 480, default_height: 420,
    });
    dialog.add_button(__('Close'), Gtk.ResponseType.CLOSE);
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL, spacing: 12,
        margin_top: 18, margin_bottom: 18, margin_start: 18, margin_end: 18,
    });
    dialog.get_content_area().append(box);
    const toggles = [];
    for (const [key, label] of [
        ['hide-floating-windows', 'Hide floating windows'],
        ['hide-transient-windows', 'Hide transient/dialog windows'],
        ['retain-unavailable-applications', 'Retain unavailable application entries'],
    ]) {
        const toggle = new Gtk.CheckButton({label: __(label)});
        settings.bind(key, toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        toggles.push(toggle);
        box.append(toggle);
    }
    box.append(new Gtk.Label({
        label: `${__('Floating means unmaximized, unfullscreened and untiled.')}\n${
            __('Hidden apps include pinned launchers.')}`, wrap: true, xalign: 0,
    }));
    const list = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE});
    box.append(new Gtk.ScrolledWindow({vexpand: true, min_content_height: 120, child: list}));
    const rebuild = () => {
        while (list.get_first_child())
            list.remove(list.get_first_child());
        for (const id of settings.get_strv('hidden-applications')) {
            const app = Gio.DesktopAppInfo.new(id);
            const row = new Gtk.Box({spacing: 8, margin_top: 4, margin_bottom: 4});
            row.append(new Gtk.Image({
                gicon: app?.get_icon() ?? new Gio.ThemedIcon({name: 'application-x-executable'}),
                pixel_size: 24,
            }));
            row.append(new Gtk.Label({
                label: app?.get_display_name() ?? id, tooltip_text: id,
                hexpand: true, xalign: 0, ellipsize: 3,
            }));
            const remove = new Gtk.Button({icon_name: 'list-remove-symbolic', tooltip_text: __('Remove')});
            remove.connect('clicked', () => settings.set_strv('hidden-applications',
                settings.get_strv('hidden-applications').filter(entry => entry !== id)));
            row.append(remove);
            list.append(row);
        }
    };
    const signal = settings.connect('changed::hidden-applications', rebuild);
    rebuild();
    const add = new Gtk.Button({label: __('Choose installed application…')});
    box.append(add);
    add.connect('clicked', () => {
        const chooser = new Gtk.AppChooserDialog({
            transient_for: dialog, modal: true, destroy_with_parent: true,
        });
        chooser.get_widget().set_show_all(true);
        chooser.connect('response', (_chooser, response) => {
            const id = chooser.get_app_info()?.get_id();
            if (response === Gtk.ResponseType.OK && id) {
                settings.set_strv('hidden-applications',
                    [...new Set([...settings.get_strv('hidden-applications'), id])]);
            }
            chooser.destroy();
        });
        chooser.present();
    });
    let cleaned = false;
    const cleanup = () => {
        if (cleaned)
            return;
        cleaned = true;
        settings.disconnect(signal);
        toggles.forEach(toggle => Gio.Settings.unbind(toggle, 'active'));
    };
    dialog.connect('response', () => {
        cleanup();
        dialog.destroy();
    });
    dialog.connect('close-request', () => {
        cleanup();
        return false;
    });
    dialog.connect('destroy', cleanup);
    dialog.present();
    return dialog;
}
