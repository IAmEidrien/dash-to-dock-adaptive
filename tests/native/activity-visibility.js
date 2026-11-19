// SPDX-FileCopyrightText: Eidrien
// SPDX-License-Identifier: MIT
/* global global */
/* eslint-disable no-await-in-loop */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export async function validateVisibility({manager, settings, check, wait, backend, path}) {
    const {State} = await import(Gio.File.new_for_path(`${path}/docking.js`).get_uri());
    const dock = manager.mainDock,
        mode = dock.dash.activityMode,
        monitor = manager.cpuActivity;
    const icon = () => dock.dash.getAppIcons().find(i => i.app.get_id().endsWith('Second.desktop'));
    const renderer = () => icon()._indicator._running;
    const display = Main.layoutManager.monitors[dock.monitorIndex];
    const move = coords => backend.notify_absolute_motion(GLib.get_monotonic_time(), ...coords);
    const away = [display.x + display.width / 2, display.y + display.height / 2];
    const [x, y] = icon()._iconContainer.get_transformed_position();
    const [width, height] = icon()._iconContainer.get_transformed_size();
    const center = [x + width / 2, y + height / 2];
    let strip, edge;
    switch (renderer()._side) {
    case St.Side.LEFT:
        strip = [x + 2, center[1]];
        edge = [display.x, center[1]];
        break;
    case St.Side.RIGHT:
        strip = [x + width - 2, center[1]];
        edge = [display.x + display.width - 1, center[1]];
        break;
    case St.Side.TOP:
        strip = [center[0], y + 2];
        edge = [center[0], display.y];
        break;
    default:
        strip = [center[0], y + height - 2];
        edge = [center[0], display.y + display.height - 1];
    }
    const until = async (predicate, label) => {
        for (let i = 0; i < 150 && !predicate(); i++)
            await wait(20);
        check(!!predicate(), label);
    };
    const saved = {
        fixed: settings.get_boolean('dock-fixed'),
        autohide: settings.get_boolean('autohide'),
        intellihide: settings.get_boolean('intellihide'),
        pressure: settings.get_boolean('require-pressure-to-show'),
        mode: settings.get_enum('intellihide-mode'),
        animation: settings.get_double('animation-time'),
        hide: settings.get_double('hide-delay'),
        cpuAnimation: settings.get_int('adaptive-cpu-animation'),
        cpuHover: settings.get_int('adaptive-cpu-hover-delay'),
        position: settings.get_enum('dock-position'),
    };
    const motion = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    const animations = motion.get_boolean('enable-animations');
    motion.set_boolean('enable-animations', true);
    settings.set_int('adaptive-cpu-hover-delay', 0);
    settings.set_int('adaptive-cpu-animation', 5000);
    await wait(100);
    renderer().animate(renderer().fraction > 0.5 ? 0.1 : 0.9);
    check(!!renderer().timeline, 'visibility test begins with an in-progress Activity animation');
    move(away);
    await wait(100);
    settings.set_double('animation-time', 0.08);
    settings.set_double('hide-delay', 0);
    settings.set_boolean('require-pressure-to-show', false);
    settings.set_boolean('intellihide', false);
    settings.set_boolean('autohide', true);
    settings.set_boolean('dock-fixed', false);
    dock.dash.requiresVisibility = false;
    dock.updateDashVisibility();
    await until(() => dock.dockState === State.HIDDEN, 'real autohide hides dock');
    check(
        !mode.visible && !mode.active && !monitor.timer && !monitor.bootstrap && !monitor.process,
        'hidden zero-delay dock suspends all sampling'
    );
    check(
        !renderer().timeline && renderer()._cpu === null && renderer().filtered === undefined,
        'hiding stops obsolete animation and clears measured state'
    );
    settings.set_int('adaptive-cpu-hover-delay', 120);
    settings.set_double('hide-delay', 0.5);
    move(edge);
    dock.showDock();
    await until(() => dock.dockState === State.SHOWN, 'autohide reveal reaches shown state');
    await wait(150);
    print(
        `REVEAL ${JSON.stringify({
            visible: mode.visible,
            needsRearm: mode.needsRearm,
            active: mode.active,
            dwell: mode.dwell,
            pointer: global.get_pointer(),
            edge,
            actual: icon()._iconContainer.get_transformed_position(),
            size: icon()._iconContainer.get_transformed_size(),
        })}`
    );
    check(
        mode.visible && mode.needsRearm && !mode.active && !mode.dwell,
        'screen-edge reveal cannot activate Activity mode'
    );
    move(center);
    await wait(50);
    check(!mode.needsRearm && !mode.active, 'icon interior rearms without leaving dock');
    const activated = GLib.get_monotonic_time() / 1e6;
    move(strip);
    await until(() => mode.active, 're-entering indicator strip activates after dwell');
    await until(() => renderer()._cpu !== null, 'revealed dock obtains a fresh measurement');
    check(monitor.previous.time >= activated, 'resume uses a post-reveal baseline');
    move(away);
    await until(() => dock.dockState === State.HIDDEN, 'leaving revealed dock autohides again');
    for (let i = 0; i < 4; i++) {
        dock._animateIn(0.08, 0);
        await wait(20);
        dock._animateOut(0.08, 0);
        await wait(20);
    }
    await until(() => dock.dockState === State.HIDDEN, 'rapid interrupted reveals settle hidden');
    check(
        !monitor.timer && !monitor.bootstrap && !renderer().timeline && !mode.dwell,
        'rapid hide/show leaves no Activity work behind'
    );
    settings.set_int('adaptive-cpu-hover-delay', 0);
    move(strip);
    dock.showDock();
    await until(() => mode.visible && mode.active, 'visible zero-delay mode bypasses rearming');

    const windows = global
        .get_window_actors()
        .map(actor => actor.meta_window)
        .filter(window => window.title?.startsWith('org.eidrien.D2DReview'));
    const place = window => {
        window.unmaximize(Meta.MaximizeFlags.BOTH);
        window.move_resize_frame(
            false,
            display.x + Math.round(display.width / 3),
            display.y + Math.round(display.height / 3),
            280,
            180
        );
    };
    windows.forEach(place);
    settings.set_boolean('autohide', false);
    settings.set_boolean('intellihide', true);
    settings.set_enum('intellihide-mode', 0);
    move(away);
    dock._intellihide.forceUpdate();
    await until(() => dock.dockState === State.SHOWN, 'intellihide keeps non-overlapping dock visible');
    const window = windows.find(w => w.title.endsWith('Second'));
    window.activate(global.get_current_time());
    window.maximize(Meta.MaximizeFlags.BOTH);
    dock._intellihide.forceUpdate();
    await until(
        () => dock._intellihide.getOverlapStatus() && dock.dockState === State.HIDDEN,
        'maximized real window triggers intellihide'
    );
    check(
        !mode.visible && !mode.active && !monitor.timer && !renderer().timeline,
        'intellihide suspends Activity and animation'
    );
    place(window);
    dock._intellihide.forceUpdate();
    await until(
        () => dock.dockState === State.SHOWN && mode.active,
        'removing overlap resumes visible zero-delay Activity'
    );

    settings.set_boolean('dock-fixed', true);
    const secondDock = manager._createDock({monitorIndex: dock.monitorIndex, isMain: false});
    await until(() => secondDock.dash.activityMode.active, 'second actual dock enters Activity mode');
    await until(() => renderer()._cpu !== null, 'primary dock ready before multi-dock hiding');
    const otherMode = secondDock.dash.activityMode;
    const other = secondDock.dash.getAppIcons().find(i => i.app.get_id().endsWith('Second.desktop'))
        ._indicator._running;
    const generation = monitor.generation,
        periodic = monitor.timer;
    await until(() => !monitor.process, 'shared worker settles before in-flight hide test');
    monitor.sample();
    const inFlight = monitor.process;
    secondDock._animateOut(0, 0);
    check(
        monitor.process === inFlight && monitor.generation === generation && monitor.timer === periodic,
        'hiding one dock preserves other dock worker and cadence'
    );
    await until(() => secondDock.dockState === State.HIDDEN, 'secondary dock hidden independently');
    check(
        mode.active && !otherMode.active && other._cpu === null && !other.timeline,
        'only hidden dock loses Activity state'
    );
    await wait(350);
    check(renderer()._cpu !== null, 'visible dock keeps receiving CPU measurements');
    secondDock._animateIn(0, 0);
    await until(() => otherMode.active, 'secondary dock resumes zero-delay Activity');
    check(other._cpu === null, 'secondary resume cannot reuse previous CPU value');
    await until(
        () => !other.token.awaitingFresh && other._cpu !== null,
        'secondary dock waits for its own fresh baseline window'
    );
    check(
        monitor.generation === generation && monitor.timer === periodic,
        'secondary resume never restarts primary sampler'
    );
    secondDock.destroy();
    check(
        otherMode.members.size === 0 && !otherMode.dwell && !other.timeline,
        'secondary destruction releases Activity state'
    );

    const oldMode = dock.dash.activityMode;
    const oldRenderers = dock.dash.getAppIcons().map(i => i._indicator._running);
    settings.set_enum('dock-position', saved.position === 3 ? 2 : 3);
    await until(
        () => manager.mainDock !== dock && manager.mainDock.dash.activityMode.visible,
        'dock reconstruction creates a fresh visible Activity controller'
    );
    check(
        oldMode.destroyed &&
            oldMode.members.size === 0 &&
            !oldMode.dwell &&
            oldRenderers.every(i => !i.timeline),
        'reconstruction clears old Activity timers and animations'
    );
    settings.set_enum('dock-position', saved.position);
    await until(
        () => manager.mainDock.position === saved.position && manager.mainDock.dash.activityMode.visible,
        'original dock position restored'
    );
    settings.set_boolean('dock-fixed', saved.fixed);
    settings.set_boolean('autohide', saved.autohide);
    settings.set_boolean('intellihide', saved.intellihide);
    settings.set_boolean('require-pressure-to-show', saved.pressure);
    settings.set_enum('intellihide-mode', saved.mode);
    settings.set_double('animation-time', saved.animation);
    settings.set_double('hide-delay', saved.hide);
    settings.set_int('adaptive-cpu-animation', saved.cpuAnimation);
    settings.set_int('adaptive-cpu-hover-delay', saved.cpuHover);
    motion.set_boolean('enable-animations', animations);
}
