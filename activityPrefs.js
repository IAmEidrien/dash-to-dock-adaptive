// SPDX-FileCopyrightText: Eidrien
// SPDX-License-Identifier: MIT
import Gtk from 'gi://Gtk';

export function activityPreferences(settings, __) {
    const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8, margin_top: 12});
    const ids = [];
    const add = (title, control) => {
        const row = new Gtk.Box({spacing: 16});
        row.append(new Gtk.Label({label: title, xalign: 0, hexpand: true}));
        row.append(control);
        box.append(row);
    };
    const combo = (key, title, values, names) => {
        const control = new Gtk.ComboBoxText();
        names.forEach((name, index) => control.append(values[index], name));
        const sync = () => control.set_active_id(settings.get_string(key));
        sync();
        control.connect('changed', () => {
            if (control.get_active_id() !== settings.get_string(key))
                settings.set_string(key, control.get_active_id());
        });
        ids.push(settings.connect(`changed::${key}`, sync));
        if (key === 'adaptive-cpu-idle') {
            control.tooltip_text = __(
                'Baseline before hover monitoring. Active CPU uses the dot-to-line scale.'
            );
        }
        add(title, control);
    };
    const spin = (key, title, lower, upper, step) => {
        const control = new Gtk.SpinButton({
            numeric: true,
            digits: 0,
            adjustment: new Gtk.Adjustment({
                lower,
                upper,
                step_increment: step,
                page_increment: step * 5,
            }),
        });
        settings.bind(key, control, 'value', 0);
        add(title, control);
    };
    box.append(new Gtk.Label({label: __('Adaptive CPU activity — Experimental'), xalign: 0}));
    combo('adaptive-cpu-idle', __('Idle appearance'), ['dot', 'line'], [__('Dot'), __('Line')]);
    combo(
        'adaptive-cpu-scale',
        __('CPU scale'),
        ['core', 'total'],
        [__('Per-core'), __('Total system capacity')]
    );
    spin('adaptive-cpu-hover-delay', __('Hover delay (ms; 0 = always active)'), 0, 5000, 50);
    spin('adaptive-cpu-interval', __('Polling interval (seconds)'), 1, 60, 1);
    spin('adaptive-cpu-animation', __('Animation duration (ms)'), 0, 1000, 50);
    box.append(
        new Gtk.Label({
            label: __('Per-core: 100% = one CPU. Total: 100% = all CPUs. Process-tree estimates.'),
            wrap: true,
            xalign: 0,
            max_width_chars: 55,
        })
    );
    const syncVisible = () => {
        box.visible = settings.get_enum('running-indicator-style') === 10;
    };
    ids.push(settings.connect('changed::running-indicator-style', syncVisible));
    syncVisible();
    return {
        box,
        destroy() {
            ids.forEach(id => settings.disconnect(id));
        },
    };
}
