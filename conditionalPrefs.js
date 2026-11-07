// SPDX-FileCopyrightText: Eidrien
// SPDX-License-Identifier: MIT
// Visibility follows relevance, never writes a preference or clears its value.
export const preferenceRules = [
    [['dock_monitor_combo', 'dock_monitor_label'], b => !b('multi-monitor')],
    [['dock_size_scale', 'dock_size_label'], b => !b('extend-height')],
    [['dock_center_icons_check'], b => b('extend-height')],
    [['preview_size_listboxrow'], b => b('show-windows-preview')],
    [['intelligent_autohide_button'], b => !b('dock-fixed')],
    [['intellihide_mode_box'], b => b('intellihide')],
    [
        [
            'require_pressure_checkbutton',
            'autohide_enable_in_fullscreen_checkbutton',
            'show_dock_urgent_notify_checkbutton',
        ],
        b => b('autohide'),
    ],
    [
        ['show_timeout_spinbutton', 'show_timeout_label'],
        b => b('autohide') && !b('require-pressure-to-show'),
    ],
    [
        ['pressure_threshold_spinbutton', 'pressure_threshold_label'],
        b => b('autohide') && b('require-pressure-to-show'),
    ],
    [
        [
            'overview_hover_focus_delay_label',
            'overview_hover_focus_delay_spinbutton',
            'overview_hover_focus_switch_workspace_check',
            'overview_hover_padding_check',
        ],
        b => b('focus-overview-app-on-hover'),
    ],
    [['show_only_mounted_devices_check', 'show_network_volumes_check'], b => b('show-mounts')],
    [['isolate_locations_row'], b => b('show-trash') || b('show-mounts')],
    [['notifications_counter_check'], b => b('show-icons-emblems')],
    [
        ['applications_override_counter'],
        b => b('show-icons-emblems') && b('show-icons-notifications-counter'),
    ],
    [
        [
            'application_button_first_button',
            'application_button_animation_button',
            'show_apps_always_in_the_edge',
        ],
        b => b('show-show-apps-button'),
    ],
    [['overlay_button'], b => b('hot-keys')],
    [['dot_style_settings_box'], b => b('custom-theme-customize-running-dots')],
    [
        ['dominant_color_label', 'dominant_color_switch'],
        b => !b('custom-theme-customize-running-dots'),
    ],
    [['custom_background_color'], b => b('custom-background-color')],
    [['min_alpha_box', 'max_alpha_box'], b => b('customize-alphas')],
    [['apply_gloss_effect_checkbutton'], b => b('unity-backlit-items')],
];

export function conditionalPreferences(builder, settings) {
    const rules = preferenceRules.map(([ids, predicate]) => [
        ids.map(id => {
            const widget = builder.get_object(id);
            if (!widget)
                throw Error(`Missing conditional preference ${id}`);
            return widget;
        }),
        predicate,
    ]);
    const sync = () => {
        for (const [widgets, predicate] of rules) {
            const visible = predicate(key => settings.get_boolean(key));
            widgets.forEach(widget => {
                widget.visible = visible;
            });
        }
        builder.get_object('running_indicators_advance_settings_button').visible =
            settings.get_enum('running-indicator-style') !== 0;
    };
    const id = settings.connect('changed', sync);
    sync();
    return {
        destroy() {
            settings.disconnect(id);
        },
    };
}
