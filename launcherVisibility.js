// SPDX-FileCopyrightText: Eidrien
// SPDX-License-Identifier: GPL-2.0-or-later

export function visibleWindow(window, settings) {
    if (settings.hideTransientWindows && window.get_transient_for())
        return false;
    if (settings.hideFloatingWindows && !window.is_fullscreen() &&
        !window.maximized_horizontally && !window.maximized_vertically &&
        !window.get_tile_match?.())
        return false;
    return true;
}

export function visibleApp(app, settings) {
    return !settings.hiddenApplications.includes(app.get_id());
}
