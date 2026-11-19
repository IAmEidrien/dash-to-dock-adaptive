// SPDX-FileCopyrightText: Eidrien
// SPDX-License-Identifier: MIT
// Visibility follows relevance, never writes a preference or clears its value.
export const preferenceRules = [
    [['dock_monitor_combo', 'dock_monitor_label'], enabled => !enabled('multi-monitor')],
    [['dock_size_scale', 'dock_size_label'], enabled => !enabled('extend-height')],
    [['dock_center_icons_check'], enabled => enabled('extend-height')],
    [['preview_size_listboxrow'], enabled => enabled('show-windows-preview')],
    [['intelligent_autohide_button'], enabled => !enabled('dock-fixed')],
    [['intellihide_mode_box'], enabled => enabled('intellihide')],
    [
        [
            'require_pressure_checkbutton',
            'autohide_enable_in_fullscreen_checkbutton',
            'show_dock_urgent_notify_checkbutton',
        ],
        enabled => enabled('autohide'),
    ],
    [
        ['show_timeout_spinbutton', 'show_timeout_label'],
        enabled => enabled('autohide') && !enabled('require-pressure-to-show'),
    ],
    [
        ['pressure_threshold_spinbutton', 'pressure_threshold_label'],
        enabled => enabled('autohide') && enabled('require-pressure-to-show'),
    ],
    [
        [
            'overview_hover_focus_delay_label',
            'overview_hover_focus_delay_spinbutton',
            'overview_hover_focus_switch_workspace_check',
            'overview_hover_padding_check',
        ],
        enabled => enabled('focus-overview-app-on-hover'),
    ],
    [['show_only_mounted_devices_check', 'show_network_volumes_check'], enabled => enabled('show-mounts')],
    [['isolate_locations_row'], enabled => enabled('show-trash') || enabled('show-mounts')],
    [['notifications_counter_check'], enabled => enabled('show-icons-emblems')],
    [
        ['applications_override_counter'],
        enabled => enabled('show-icons-emblems') && enabled('show-icons-notifications-counter'),
    ],
    [
        [
            'application_button_first_button',
            'application_button_animation_button',
            'show_apps_always_in_the_edge',
        ],
        enabled => enabled('show-show-apps-button'),
    ],
    [['overlay_button'], enabled => enabled('hot-keys')],
    [['dot_style_settings_box'], enabled => enabled('custom-theme-customize-running-dots')],
    [
        ['dominant_color_label', 'dominant_color_switch'],
        enabled => !enabled('custom-theme-customize-running-dots'),
    ],
    [['custom_background_color'], enabled => enabled('custom-background-color')],
    [['min_alpha_box', 'max_alpha_box'], enabled => enabled('customize-alphas')],
    [['apply_gloss_effect_checkbutton'], enabled => enabled('unity-backlit-items')],
];

export function conditionalPreferences(builder, settings) {
    const rules = preferenceRules.map(([ids, predicate]) => [
        ids.map(widgetId => {
            const widget = builder.get_object(widgetId);
            if (!widget)
                throw Error(`Missing conditional preference ${widgetId}`);
            return widget;
        }),
        predicate,
    ]);
    const sync = () => {
        for (const [widgets, predicate] of rules) {
            const visible = predicate(settingKey => settings.get_boolean(settingKey));
            widgets.forEach(widget => {
                widget.visible = visible;
            });
        }
        builder.get_object('running_indicators_advance_settings_button').visible =
            settings.get_enum('running-indicator-style') !== 0;
    };
    const settingsSignalId = settings.connect('changed', sync);
    sync();
    return {
        destroy() {
            settings.disconnect(settingsSignalId);
        },
    };
}
