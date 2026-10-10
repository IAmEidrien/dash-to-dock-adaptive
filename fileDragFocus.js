// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

import {GLib} from './dependencies/gi.js';
import {DND, Main} from './dependencies/shell/ui.js';

const FILE_DRAG_FOCUS_DELAY = 200;

/**
 * Raise a running application's window during an external file drag. This only
 * observes GNOME's drag session: the application remains the actual drop target.
 */
export class FileDragFocus {
    constructor(getIcon, isDockVisible) {
        this._getIcon = getIcon;
        this._isDockVisible = isDockVisible;
        this.active = false;
        this._visibleAtStart = false;
        this._icon = null;
        this._iconDestroyId = 0;
        this._timeoutId = 0;
        this._dragMonitor = {dragMotion: event => this._onMotion(event)};
        this._beginId = Main.xdndHandler.connect('drag-begin', () => this._begin());
        this._endId = Main.xdndHandler.connect('drag-end', () => this._end());
    }

    _begin() {
        this._end();
        // The backend emits enter/leave as the drag crosses shell/client areas,
        // not necessarily at button press. isDockVisible excludes pointer-only
        // reveals even if the dock has already finished its peek animation.
        this._visibleAtStart = this._isDockVisible();
        this.active = true;
        DND.addDragMonitor(this._dragMonitor);
    }

    _canFocus() {
        return this.active && (Main.overview.visible || Main.overview.visibleTarget ||
            (this._visibleAtStart && this._isDockVisible()));
    }

    _onMotion(event) {
        if (event.source !== Main.xdndHandler)
            return DND.DragMotionResult.CONTINUE;

        const icon = this._canFocus() ? this._getIcon(event.targetActor) : null;
        if (icon === this._icon)
            return DND.DragMotionResult.CONTINUE;

        this._clearTarget();
        if (!icon)
            return DND.DragMotionResult.CONTINUE;

        this._icon = icon;
        // Keep ordinary Overview hover focus from competing with file dragging.
        icon._cancelOverviewHoverFocus();
        this._iconDestroyId = icon.connect('destroy', () => this._clearTarget());
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FILE_DRAG_FOCUS_DELAY, () => {
            this._timeoutId = 0;
            if (!this._canFocus() || !icon.mapped || this._getIcon(icon) !== icon)
                return GLib.SOURCE_REMOVE;

            // Resolve at activation time: windows can close during the dwell.
            const window = icon._getOverviewHoverWindow();
            if (window && (global.display.focus_window !== window ||
                Main.overview.visible || Main.overview.visibleTarget)) {
                // Unlike ordinary Overview hover, bring the real window back
                // into view so the ongoing native drag can be dropped into it.
                Main.activateWindow(window);
            }
            return GLib.SOURCE_REMOVE;
        });

        return DND.DragMotionResult.CONTINUE;
    }

    _clearTarget() {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);
        this._timeoutId = 0;

        if (this._iconDestroyId)
            this._icon.disconnect(this._iconDestroyId);
        this._iconDestroyId = 0;
        this._icon = null;
    }

    _end() {
        this._clearTarget();
        if (this.active)
            DND.removeDragMonitor(this._dragMonitor);
        this.active = false;
        this._visibleAtStart = false;
    }

    destroy() {
        this._end();
        if (this._beginId)
            Main.xdndHandler.disconnect(this._beginId);
        if (this._endId)
            Main.xdndHandler.disconnect(this._endId);
        this._beginId = this._endId = 0;
    }
}
