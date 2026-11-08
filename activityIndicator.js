// SPDX-FileCopyrightText: Eidrien
// SPDX-License-Identifier: MIT
import {Clutter, GLib, St} from './dependencies/gi.js';
import {Main} from './dependencies/shell/ui.js';
import {ACTIVITY_STYLE} from './cpuActivity.js';

// Each dash owns one hover dwell and mode; the sampler remains manager-owned.
export class DockActivityMode {
    constructor(settings, host) {
        this.settings = settings;
        this.host = host;
        this.members = new Set();
        this.active = false;
        this.visible = false;
        this.needsRearm = true;
        this.ids = ['running-indicator-style', 'adaptive-cpu-hover-delay'].map(key =>
            settings.connect(`changed::${key}`, () => {
                this._cancelDwell();
                this.updatePointer();
            })
        );
    }

    add(indicator) {
        this.members.add(indicator);
        this.updatePointer();
    }

    remove(indicator) {
        this.members.delete(indicator);
        if (!this.destroyed)
            this.updatePointer();
    }

    setVisible(visible) {
        if (this.destroyed || this.visible === visible)
            return;
        this._cancelRevealCheck();
        this.visible = visible;
        this.needsRearm = true;
        if (visible) {
            // SHOWN can precede the final slide allocation. Check the fixed
            // regions only after a painted frame, never against offscreen bounds.
            this.revealPaintId = global.stage.connect('after-paint', () => {
                this._cancelRevealCheck();
                this.updatePointer();
            });
        }
        this._cancelDwell();
        this.active = false;
        this.updatePointer();
    }

    _cancelRevealCheck() {
        if (this.revealPaintId)
            global.stage.disconnect(this.revealPaintId);
        this.revealPaintId = 0;
    }

    _cancelDwell() {
        if (this.dwell)
            GLib.source_remove(this.dwell);
        this.dwell = 0;
    }

    _insideDock() {
        const actor = this.host._dashContainer;
        if (!actor?.mapped)
            return false;
        const [x, y] = actor.get_transformed_position();
        const [width, height] = actor.get_transformed_size();
        const [px, py] = global.get_pointer();
        return px >= x && px < x + width && py >= y && py < y + height;
    }

    updatePointer(clear = false) {
        if (this.destroyed)
            return;
        const enabled =
            this.visible && this.settings.get_enum('running-indicator-style') === ACTIVITY_STYLE;
        let trigger = false;
        for (const indicator of this.members) {
            indicator.edgeHover =
                !clear &&
                enabled &&
                !indicator.dead &&
                indicator.style === ACTIVITY_STYLE &&
                indicator._source.running &&
                indicator._source.mapped &&
                indicator._pointerOnIndicator();
            trigger ||= indicator.edgeHover;
        }
        const delay = this.settings.get_int('adaptive-cpu-hover-delay');
        // Hidden/sliding geometry cannot rearm a pointer-only reveal. Once shown,
        // observing the pointer outside every fixed indicator strip is sufficient.
        if (this.visible && !this.revealPaintId && !clear && !trigger)
            this.needsRearm = false;
        const inside = this.visible && !clear && (trigger || this._insideDock());
        if (!enabled || (delay > 0 && (!inside || this.needsRearm))) {
            this._cancelDwell();
            this.active = false;
        } else if (delay === 0) {
            this._cancelDwell();
            this.active = true;
        } else if (!this.active) {
            if (!trigger) {
                this._cancelDwell();
            } else if (!this.dwell) {
                this.dwell = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                    this.dwell = 0;
                    // Recheck actual geometry: actors may have moved during dwell.
                    const stillTriggered = [...this.members].some(
                        indicator =>
                            !indicator.dead &&
                            indicator.style === ACTIVITY_STYLE &&
                            indicator._source.running &&
                            indicator._source.mapped &&
                            indicator._pointerOnIndicator()
                    );
                    this.active =
                        this.visible &&
                        !this.needsRearm &&
                        stillTriggered &&
                        this.settings.get_enum('running-indicator-style') === ACTIVITY_STYLE;
                    this._syncMembers();
                    return GLib.SOURCE_REMOVE;
                });
            }
        }
        this._syncMembers();
    }

    _syncMembers() {
        const sync = () => {
            for (const indicator of this.members)
                indicator._monitoring();
        };
        const monitor = this.members.values().next().value?.monitor;
        if (monitor)
            monitor.batch(sync);
    }

    destroy() {
        if (this.destroyed)
            return;
        this.destroyed = true;
        this.ids.forEach(id => this.settings.disconnect(id));
        this._cancelRevealCheck();
        this._cancelDwell();
        this.active = false;
        this.visible = false;
        this._syncMembers();
        this.members.clear();
        this.host = null;
    }
}

// Time-aware asymmetric EMA. Inputs/outputs are normalized visual lengths only.
export function smoothActivity(previous, target, elapsed, animation, interval) {
    if (!animation || previous === undefined)
        return {value: target, deadband: 0};
    const seconds = animation / 1000;
    const strength = seconds / (seconds + Math.max(0.001, interval));
    const rising = target > previous;
    const tau = seconds * strength * (rising ? 0.2 : 0.65);
    let alpha = 1 - Math.exp(-Math.max(0, elapsed) / Math.max(0.001, tau));
    if (target - previous >= 0.15)
        alpha = Math.max(alpha, 0.85);
    return {value: previous + (target - previous) * alpha, deadband: 0.008 * strength ** 2};
}

// Share Solid's established body height and edge padding with the capsule.
export function solidIndicatorGeometry(width, height, border, backlit, custom) {
    const thickness = Math.max(width / 20, border);
    const padding = backlit && !custom ? 0 : border;
    return {thickness, y: height - padding - thickness};
}

// The drawing area, style computation, colors and rotation belong to Base.
export function createActivityIndicator(Base, ordinary, utils) {
    return class ActivityIndicator extends Base {
        constructor(source, style, manager) {
            super(source);
            this.settings = manager._settings;
            this.monitor = manager.cpuActivity;
            this.fraction = 0;
            this._cpu = null;
            this.sampleState = 'waiting';
            this.token = this.monitor.watch(source.app, (sample, cpus, state) => {
                this.rawPercent = sample?.percent;
                this.sampleCpus = cpus;
                this.sampleState = state ?? 'unavailable';
                this._scaleSample();
                this._target(true);
                this._tooltip();
            });
            for (const signal of ['notify::hover', 'notify::mapped', 'notify::running'])
                this._signalsHandler.add(source, signal, () => this.mode?.updatePointer());
            this._signalsHandler.add(source, 'motion-event', () => {
                this._tooltip();
                return Clutter.EVENT_PROPAGATE;
            });
            this._signalsHandler.add(this.settings, 'changed::hide-tooltip', () => {
                if (this.settings.get_boolean('hide-tooltip'))
                    this._source.get_parent()?.label?.hide();
                this._tooltip();
            });
            for (const key of [
                'adaptive-cpu-idle',
                'adaptive-cpu-hover-delay',
                'adaptive-cpu-scale',
                'adaptive-cpu-animation',
            ]) {
                this._signalsHandler.add(this.settings, `changed::${key}`, () => {
                    if (key === 'adaptive-cpu-scale')
                        this._resetSmoothing();
                    this._scaleSample();
                    this._monitoring(true);
                });
            }
            this._signalsHandler.add(St.Settings.get(), 'notify::enable-animations', () => {
                if (!St.Settings.get().enable_animations) {
                    this.stopAnimation();
                    this.morph = false;
                    this._target();
                    this._area.queue_repaint();
                }
            });
            this.setStyle(style);
            this.setDockMode(source.activityMode ?? null);
        }

        _scaleSample() {
            this._cpu =
                Number.isFinite(this.rawPercent) && this.rawPercent >= 0
                    ? this.rawPercent /
                      (this.settings.get_string('adaptive-cpu-scale') === 'total'
                          ? Math.max(1, this.sampleCpus)
                          : 1)
                    : null;
        }

        _hideTooltip(restore = true) {
            this.label?.hide();
            if (this._source._activityTooltipOwner !== this)
                return;
            this._source._activityTooltipOwner = null;
            if (
                restore &&
                !this.dead &&
                this._source.hover &&
                !this.settings.get_boolean('hide-tooltip') &&
                this._source.shouldShowTooltip?.()
            )
                this._source.get_parent()?.showLabel?.();
        }

        setDockMode(mode) {
            if (this.mode === mode)
                return;
            this.mode?.remove(this);
            this.mode = mode;
            this.mode?.add(this);
            this._monitoring();
        }

        _pointerOnIndicator() {
            const [x, y] = this._source._iconContainer.get_transformed_position();
            const [width, height] = this._source._iconContainer.get_transformed_size();
            const [sx, sy] = this._source.get_transformed_position();
            const [sw, sh] = this._source.get_transformed_size();
            const [px, py] = global.get_pointer();
            const monitor = Main.layoutManager.findMonitorForActor(this._source);
            if (
                !monitor ||
                x + width <= monitor.x ||
                x >= monitor.x + monitor.width ||
                y + height <= monitor.y ||
                y >= monitor.y + monitor.height
            )
                return false;
            const band = 10 * St.ThemeContext.get_for_stage(global.stage).scale_factor;
            switch (this._side) {
            case St.Side.LEFT:
                return py >= sy && py < sy + sh && px >= monitor.x && px <= x + band;
            case St.Side.RIGHT:
                return (
                    py >= sy &&
                        py < sy + sh &&
                        px < monitor.x + monitor.width &&
                        px >= x + width - band
                );
            case St.Side.TOP:
                return px >= sx && px < sx + sw && py >= monitor.y && py <= y + band;
            case St.Side.BOTTOM:
                return (
                    px >= sx &&
                        px < sx + sw &&
                        py < monitor.y + monitor.height &&
                        py >= y + height - band
                );
            default:
                return false;
            }
        }

        duration() {
            return St.Settings.get().enable_animations
                ? this.settings.get_int('adaptive-cpu-animation')
                : 0;
        }

        setStyle(style) {
            const wasActivity = this.style === ACTIVITY_STYLE;
            const previous = this.style;
            this.style = style;
            if (style !== ACTIVITY_STYLE)
                this.edgeHover = false;
            if (style === ACTIVITY_STYLE && previous !== undefined && previous !== ACTIVITY_STYLE)
                this.fraction = this._ordinaryFraction(previous);
            if (style === ACTIVITY_STYLE && previous !== ACTIVITY_STYLE)
                this.morph = true;
            this._monitoring(true);
            if (wasActivity && style !== ACTIVITY_STYLE) {
                this.morph = true;
                this.animate(this._ordinaryFraction(style), () => {
                    this.morph = false;
                    this._area.queue_repaint();
                });
            }
        }

        _ordinaryFraction(style) {
            if (style === 5)
                return 1;
            if (style === 3)
                return 0.15;
            return 0;
        }

        _monitoring(force = false) {
            if (this.dead)
                return;
            const wanted = !!(
                this.style === ACTIVITY_STYLE &&
                this._source.running &&
                this.mode?.active &&
                this.mode.visible !== false
            );
            const changed = wanted !== this.active;
            if (changed) {
                this.active = !!wanted;
                this._resetSmoothing();
                this._cpu = null;
                this.rawPercent = null;
                this.sampleState = 'waiting';
                this.monitor.activate(this.token, this.active);
            }
            this.syncIdleStyle();
            if (this.mode?.visible === false) {
                // Snap to a clean idle state while offscreen, never retain or
                // restart a timeline carrying measurements from before hiding.
                if (!this.suspended || changed || force) {
                    this.stopAnimation();
                    this._resetSmoothing();
                    this.rawPercent = null;
                    this._cpu = null;
                    this.sampleState = 'waiting';
                    this.morph = false;
                    this.fraction =
                        this.style === ACTIVITY_STYLE
                            ? Number(this.settings.get_string('adaptive-cpu-idle') !== 'dot')
                            : this._ordinaryFraction(this.style);
                    this._source.get_parent()?.label?.hide();
                }
                this.suspended = true;
                this._hideTooltip(false);
                return;
            }
            const resumed = this.suspended;
            this.suspended = false;
            if (changed || force || resumed)
                this._target();
            this._tooltip();
        }

        syncIdleStyle() {
            const metro =
                !this.dead &&
                !this.retiring &&
                this.style === ACTIVITY_STYLE &&
                this.settings.get_enum('running-indicator-style') === ACTIVITY_STYLE &&
                !this.active &&
                this.settings.get_string('adaptive-cpu-idle') === 'metro';
            if (metro) {
                this._source.add_style_class_name('activity-idle-metro');
                this.idleMetro = true;
            } else {
                this.clearIdleStyle();
            }
        }

        clearIdleStyle() {
            if (this.idleMetro)
                this._source.remove_style_class_name('activity-idle-metro');
            this.idleMetro = false;
        }

        _resetSmoothing() {
            this.filtered = undefined;
            this.visualTarget = undefined;
            this.sampleTime = undefined;
        }

        _target(newSample = false) {
            if (this.dead || this.style !== ACTIVITY_STYLE)
                return;
            let target = this.settings.get_string('adaptive-cpu-idle') === 'dot' ? 0 : 1;
            if (this.active) {
                target = this._cpu === null ? 0 : Math.min(1, this._cpu / 100);
                if (this._cpu === null || !this.duration()) {
                    this._resetSmoothing();
                } else if (newSample) {
                    const now = GLib.get_monotonic_time() / 1e6;
                    const interval = this.settings.get_int('adaptive-cpu-interval');
                    const elapsed = this.sampleTime === undefined ? interval : now - this.sampleTime;
                    const smoothed = smoothActivity(
                        this.filtered,
                        target,
                        elapsed,
                        this.duration(),
                        interval
                    );
                    this.filtered = smoothed.value;
                    this.sampleTime = now;
                    if (
                        this.visualTarget === undefined ||
                        Math.abs(smoothed.value - this.visualTarget) >= smoothed.deadband
                    )
                        this.visualTarget = smoothed.value;
                }
                if (this.duration() && this.visualTarget !== undefined)
                    target = this.visualTarget;
            }
            if (this._cpu === null && this.fraction > 0)
                this.morph = true;
            this.animate(target, () => {
                this.morph = false;
                this._area.queue_repaint();
            });
        }

        stopAnimation() {
            if (!this.timeline)
                return;
            const {timeline} = this;
            this.timeline = null;
            this.animationIds.forEach(id => timeline.disconnect(id));
            timeline.stop();
            timeline.set_actor(null);
        }

        animate(target, completed = () => {}) {
            const duration = this._area.mapped && this.mode?.visible !== false ? this.duration() : 0;
            if (this.timeline && this.animationTarget === target && this.animationDuration === duration)
                return;
            this.stopAnimation();
            this.animationTarget = target;
            this.animationDuration = duration;
            const from = this.fraction;
            if (!duration || Math.abs(target - from) < 0.001) {
                this.fraction = target;
                this._area.queue_repaint();
                completed();
                return;
            }
            // Mutter schedules timelines through an actor's stage-view frame clock.
            // Without it, animations freeze when GNOME animations are enabled.
            this.timeline = new Clutter.Timeline({duration, actor: this._area});
            this.animationIds = [
                this.timeline.connect('new-frame', timeline => {
                    const progress = 1 - (1 - timeline.get_progress()) ** 3;
                    this.fraction = from + (target - from) * progress;
                    this._area.queue_repaint();
                }),
                this.timeline.connect('completed', () => {
                    this.stopAnimation();
                    this.fraction = target;
                    completed();
                }),
            ];
            this.timeline.start();
        }

        _drawIndicator(cr) {
            if (!this._source.running)
                return;
            if (
                (!this.morph && this.style !== ACTIVITY_STYLE) ||
                (this.style === ACTIVITY_STYLE && this.active && this._cpu === null && !this.morph)
            ) {
                (ordinary[this.style] ?? ordinary[9]).call(this, cr);
                return;
            }
            if (this.style === ACTIVITY_STYLE && !this.active && !this.morph) {
                const idle = this.settings.get_string('adaptive-cpu-idle');
                if (idle === 'line' || idle === 'metro') {
                    ordinary[idle === 'metro' ? 7 : 5].call(this, cr);
                    return;
                }
            }
            const border = this._borderWidth;
            const {thickness, y: top} = solidIndicatorGeometry(
                this._width,
                this._height,
                border,
                this.settings.get_boolean('unity-backlit-items'),
                this.settings.get_boolean('custom-theme-customize-running-dots')
            );
            const length =
                thickness + (Math.max(thickness, this._width - border) - thickness) * this.fraction;
            const radius = thickness / 2;
            const x = (this._width - length) / 2,
                y = top + radius;
            cr.setLineWidth(border);
            cr.newSubPath();
            cr.arc(x + radius, y, radius, Math.PI / 2, Math.PI * 1.5);
            cr.arc(x + length - radius, y, radius, -Math.PI / 2, Math.PI / 2);
            cr.closePath();
            utils.cairoSetSourceColor(cr, this._borderColor);
            cr.strokePreserve();
            utils.cairoSetSourceColor(cr, this._bodyColor);
            cr.fill();
        }

        _tooltip() {
            if (
                this.dead ||
                this.mode?.visible === false ||
                this.style !== ACTIVITY_STYLE ||
                !this._source.running ||
                !this._source.mapped ||
                !(this._source.hover || this.edgeHover) ||
                !this._pointerOnIndicator()
            ) {
                this._hideTooltip();
                return;
            }
            const [x, y] = this._source._iconContainer.get_transformed_position();
            const [width, height] = this._source._iconContainer.get_transformed_size();
            const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            const side = this._side;
            this.label ??= new St.Label({style_class: 'dash-label', reactive: false});
            if (!this.label.get_parent())
                Main.uiGroup.add_child(this.label);
            let value = 'Waiting…';
            if (this.active && this._cpu !== null)
                value = `~${this._cpu.toFixed(1)}% CPU · process-tree estimate`;
            else if (this.active && this.sampleState !== 'waiting')
                value = 'CPU measurement unavailable';
            this._source._activityTooltipOwner = this;
            this._source.get_parent()?.label?.hide();
            this.label.text = this.settings.get_boolean('hide-tooltip')
                ? value
                : `${this._source.app.get_name()}: ${value}`;
            this.label.show();
            const [, naturalWidth] = this.label.get_preferred_width(-1);
            const [, naturalHeight] = this.label.get_preferred_height(naturalWidth);
            const monitor =
                Main.layoutManager.findMonitorForActor(this._source) ??
                Main.layoutManager.primaryMonitor;
            let tx = x + width / 2 - naturalWidth / 2;
            let ty = y + height / 2 - naturalHeight / 2;
            if (side === St.Side.LEFT)
                tx = x + width + 6 * scale;
            else if (side === St.Side.RIGHT)
                tx = x - naturalWidth - 6 * scale;
            if (side === St.Side.TOP)
                ty = y + height + 6 * scale;
            else if (side === St.Side.BOTTOM)
                ty = y - naturalHeight - 6 * scale;
            this.label.set_position(
                Math.max(monitor.x, Math.min(tx, monitor.x + monitor.width - naturalWidth)),
                Math.max(monitor.y, Math.min(ty, monitor.y + monitor.height - naturalHeight))
            );
        }

        destroy() {
            if (this.dead)
                return;
            this.dead = true;
            this.clearIdleStyle();
            this._signalsHandler.destroy();
            this.mode?.remove(this);
            this.mode = null;
            this.stopAnimation();
            this.monitor.unwatch(this.token);
            this._hideTooltip(false);
            this.label?.destroy();
            super.destroy();
        }
    };
}
