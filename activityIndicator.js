// SPDX-FileCopyrightText: Eidrien
// SPDX-License-Identifier: MIT
import {Clutter, GLib, St} from './dependencies/gi.js';
import {Main} from './dependencies/shell/ui.js';
import {ADAPTIVE_STYLE} from './cpuActivity.js';

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
                this._target();
                this._tooltip();
            });
            this._signalsHandler.add(source, 'notify::hover', () => this._monitoring());
            this._signalsHandler.add(source, 'notify::mapped', () => this._monitoring());
            this._signalsHandler.add(source, 'notify::running', () => this._monitoring());
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
                    this._scaleSample();
                    this._monitoring();
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

        // The dock forwards motion without consuming it. Extend only the indicator
        // strip toward the monitor edge, keeping the launcher's along-axis bounds.
        updatePointer(clear = false) {
            const before = this.edgeHover;
            this.edgeHover =
                !clear &&
                this.style === ADAPTIVE_STYLE &&
                this._source.mapped &&
                this._pointerOnIndicator();
            if (before !== this.edgeHover)
                this._monitoring();
            else
                this._tooltip();
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
            const wasAdaptive = this.style === ADAPTIVE_STYLE;
            const previous = this.style;
            this.style = style;
            if (style !== ADAPTIVE_STYLE)
                this.edgeHover = false;
            if (style === ADAPTIVE_STYLE && previous !== undefined && previous !== ADAPTIVE_STYLE)
                this.fraction = this._ordinaryFraction(previous);
            if (style === ADAPTIVE_STYLE && previous !== ADAPTIVE_STYLE)
                this.morph = true;
            this._monitoring();
            if (wasAdaptive && style !== ADAPTIVE_STYLE) {
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

        _monitoring() {
            if (this.dead)
                return;
            if (this.dwell)
                GLib.source_remove(this.dwell);
            this.dwell = 0;
            const adaptive = this.style === ADAPTIVE_STYLE && this._source.running;
            const delay = this.settings.get_int('adaptive-cpu-hover-delay');
            const wanted =
                adaptive &&
                (delay === 0 || (this._source.mapped && (this._source.hover || this.edgeHover)));
            if (!wanted) {
                this.monitor.activate(this.token, false);
                this.active = false;
                this._cpu = null;
                this.rawPercent = null;
                this._hideTooltip();
                this._target();
                return;
            }
            if (this.active) {
                this._target();
                this._tooltip();
                return;
            }
            const activate = () => {
                this.dwell = 0;
                if (this.dead)
                    return GLib.SOURCE_REMOVE;
                this.active = true;
                this.sampleState = 'waiting';
                this.monitor.activate(this.token, true);
                this._target();
                this._tooltip();
                return GLib.SOURCE_REMOVE;
            };
            if (delay === 0)
                activate();
            else
                this.dwell = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, activate);
            this._tooltip();
        }

        _target() {
            if (this.dead || this.style !== ADAPTIVE_STYLE)
                return;
            let target = this.settings.get_string('adaptive-cpu-idle') === 'line' ? 1 : 0;
            if (this.active)
                target = this._cpu === null ? 0 : Math.min(1, this._cpu / 100);
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
            this.stopAnimation();
            const from = this.fraction;
            const duration = this._area.mapped ? this.duration() : 0;
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
                (!this.morph && this.style !== ADAPTIVE_STYLE) ||
                (this.style === ADAPTIVE_STYLE && this.active && this._cpu === null && !this.morph)
            ) {
                (ordinary[this.style] ?? ordinary[9]).call(this, cr);
                return;
            }
            const border = this._borderWidth;
            const thickness = Math.max(2 * this._radius, border + 1);
            const length =
                thickness + (Math.max(thickness, this._width - border) - thickness) * this.fraction;
            const radius = thickness / 2;
            const x = (this._width - length) / 2,
                y = this._height - radius - border / 2;
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
                this.style !== ADAPTIVE_STYLE ||
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
            this._signalsHandler.destroy();
            if (this.dwell)
                GLib.source_remove(this.dwell);
            this.dwell = 0;
            this.stopAnimation();
            this.monitor.unwatch(this.token);
            this._hideTooltip(false);
            this.label?.destroy();
            super.destroy();
        }
    };
}
