// SPDX-FileCopyrightText: Eidrien
// SPDX-License-Identifier: MIT
/* eslint-disable no-await-in-loop */
/* global global */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
const root = GLib.getenv('REVIEW_ROOT'),
    uuid = 'dash-to-dock-adaptive@eidrien.local';
const wait = ms =>
    new Promise(resolve =>
        GLib.timeout_add(0, ms, () => {
            resolve();
            return false;
        })
    );
export default class Probe extends Extension {
    enable() {
        GLib.timeout_add(0, 3500, () => {
            this.run().catch(e =>
                GLib.file_set_contents(
                    `${root}/result.json`,
                    JSON.stringify({error: String(e), stack: e.stack})
                )
            );
            return false;
        });
    }

    disable() {}
    async run() {
        const checks = [],
            check = (ok, label) => {
                if (!ok)
                    throw Error(label);
                checks.push(label);
                print(label);
                GLib.file_set_contents(`${root}/progress.json`, JSON.stringify(checks));
            };
        Main.overview.hide();
        St.ThemeContext.get_for_stage(global.stage).scale_factor = Number(
            GLib.getenv('REVIEW_SCALE') ?? 1
        );
        new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).set_boolean(
            'enable-animations',
            true
        );
        const themeFile = Gio.File.new_for_path(`${root}/review-theme.css`);
        if (themeFile.query_exists(null))
            St.ThemeContext.get_for_stage(global.stage).get_theme().load_stylesheet(themeFile);
        Main.extensionManager.enableExtension(uuid);
        await wait(1000);
        const info = Main.extensionManager.lookup(uuid);
        check(info.state === 1, 'extension enabled');
        check(St.Settings.get().enable_animations, 'native animations enabled before geometry tests');
        const module = await import(Gio.File.new_for_path(`${info.path}/extension.js`).get_uri());
        const settings = info.stateObj.getSettings('org.gnome.shell.extensions.dash-to-dock');
        settings.set_boolean('apply-custom-theme', false);
        settings.set_boolean('running-indicator-dominant-color', true);
        settings.set_boolean('extend-height', true);
        settings.set_boolean('custom-theme-shrink', true);
        settings.set_boolean('icon-size-fixed', false);
        settings.set_int('dash-max-icon-size', 38);
        settings.set_boolean('show-favorites', false);
        settings.set_boolean('show-apps-at-top', true);
        settings.set_int('adaptive-cpu-interval', 5);
        settings.set_int('adaptive-cpu-animation', 300);
        settings.set_int('adaptive-cpu-hover-delay', 0);
        settings.set_enum('dock-position', Number(GLib.getenv('REVIEW_POSITION') ?? 2));
        await wait(400);
        Gio.Subprocess.new(['gjs', '-m', `${root}/client.js`, 'org.eidrien.D2DReviewFirst'], 0);
        Gio.Subprocess.new(['gjs', '-m', `${root}/client.js`, 'org.eidrien.D2DReviewSecond'], 0);
        await wait(1500);
        const manager = module.dockManager;
        const icon = () =>
            manager.mainDock.dash
                .getAppIcons()
                .find(i => i.app.get_id() === 'org.eidrien.D2DReviewSecond.desktop');
        const indicator = () => icon()._indicator._running;
        const mode = () => manager.mainDock.dash.activityMode;
        const allActive = () =>
            manager.mainDock.dash
                .getAppIcons()
                .filter(i => i.running)
                .every(i => i._indicator._running.active);
        // Software-rendered nested shells may take longer to map the GTK client.
        for (
            let i = 0;
            i < 100 &&
            (!icon() || manager.mainDock.dash.getAppIcons().filter(a => a.running).length !== 2);
            i++
        )
            await wait(100);
        check(
            !!icon() && manager.mainDock.dash.getAppIcons().filter(i => i.running).length === 2,
            'two real running launchers present'
        );
        const roster = manager.mainDock.dash
            .getAppIcons()
            .map(i => i.app.get_id())
            .join();
        const activatedAt = GLib.get_monotonic_time();
        settings.set_enum('running-indicator-style', 10);
        for (let i = 0; i < 60 && !(indicator()._cpu > 0); i++)
            await wait(100);
        check(indicator()._cpu > 0, 'real application CPU sample includes busy descendant');
        check(
            (GLib.get_monotonic_time() - activatedAt) / 1000 < 2500,
            'fast first reading arrives before five-second polling interval'
        );
        check(
            !manager.cpuActivity.bootstrap && !!manager.cpuActivity.timer,
            'startup follow-up yields to normal polling'
        );
        settings.set_int('adaptive-cpu-interval', 1);
        await wait(800);
        check(
            manager.cpuActivity.tokens.size >= 1 && !!manager.cpuActivity.timer,
            'shared sampler active'
        );
        indicator()._resetSmoothing();
        indicator().token.changed({percent: 80}, 4);
        check(
            indicator().timeline?.get_actor() === indicator()._area,
            'animation owns the drawing actor frame clock'
        );
        await wait(450);
        check(
            Math.abs(indicator().fraction - 0.8) < 0.02,
            'animation advances real rendered CPU geometry'
        );
        print(
            `RENDER ${JSON.stringify({
                fraction: indicator().fraction,
                width: indicator()._width,
                height: indicator()._height,
                scale: St.ThemeContext.get_for_stage(global.stage).scale_factor,
            })}`
        );
        const debugStream = Gio.File.new_for_path(`${root}/initial-indicator.png`).replace(
            null,
            false,
            Gio.FileCreateFlags.NONE,
            null
        );
        await new Shell.Screenshot().screenshot(false, debugStream);
        debugStream.close(null);
        settings.set_int('adaptive-cpu-hover-delay', 500);
        settings.set_string('adaptive-cpu-idle', 'line');
        await wait(450);
        check(indicator().fraction > 0.98, 'inactive Activity mode renders idle line');
        settings.set_string('adaptive-cpu-idle', 'dot');
        await wait(450);
        check(indicator().fraction < 0.02, 'idle preference change renders dot');
        settings.set_string('adaptive-cpu-idle', 'metro');
        await wait(450);
        check(
            icon().has_style_class_name('activity-idle-metro'),
            'idle Metro owns its flat launcher style'
        );
        const metroStream = Gio.File.new_for_path(`${root}/idle-metro.png`).replace(
            null,
            false,
            Gio.FileCreateFlags.NONE,
            null
        );
        await new Shell.Screenshot().screenshot(false, metroStream);
        metroStream.close(null);
        settings.set_int('adaptive-cpu-hover-delay', 0);
        check(
            !icon().has_style_class_name('activity-idle-metro'),
            'Activity mode relinquishes idle Metro styling'
        );
        settings.set_string('adaptive-cpu-idle', 'line');
        const area = indicator()._area;
        settings.set_enum('running-indicator-style', 5);
        await wait(400);
        check(indicator()._area === area, 'compatible line transition reuses drawing actor');
        const context = () => ({
            arcs: [],
            rects: [],
            offset: [0, 0],
            arc(...args) {
                this.arcs.push(args);
            },
            rectangle(...args) {
                this.rects.push(args);
            },
            translate(x, y) {
                this.offset = [x, y];
            },
            setLineWidth() {},
            newSubPath() {},
            closePath() {},
            strokePreserve() {},
            fill() {},
            setSourceRGBA() {},
            setSourceColor() {},
        });
        indicator()._computeStyle();
        const solid = context();
        indicator()._drawIndicator(solid);
        const solidThickness = solid.rects[0][3],
            solidTop = solid.offset[1];
        check(
            !manager.cpuActivity.timer && !manager.cpuActivity.process,
            'switching style stops sampling'
        );
        settings.set_enum('running-indicator-style', 10);
        await wait(1300);
        check(indicator()._area === area, 'return to Activity style reuses drawing actor');
        indicator()._computeStyle();
        const comparison = Object.create(indicator());
        Object.assign(comparison, {fraction: 1, active: true, _cpu: 100, morph: false});
        const capsule = context();
        comparison._drawIndicator(capsule);
        check(
            capsule.arcs[0][2] * 2 === solidThickness &&
                capsule.arcs[0][1] - capsule.arcs[0][2] === solidTop,
            'Activity capsule matches actual Solid body height and edge padding at this scale'
        );
        const generation = manager.cpuActivity.generation;
        const extraDock = manager._createDock({monitorIndex: 0, isMain: false});
        await wait(500);
        const duplicate = extraDock.dash
            .getAppIcons()
            .find(i => i.app.get_id().endsWith('Second.desktop'));
        check(
            duplicate?._indicator._running.monitor === manager.cpuActivity,
            'two actual dock actors share backend'
        );
        check(
            manager.cpuActivity.generation === generation,
            'second dock does not restart or duplicate sampler'
        );
        extraDock.destroy();
        await wait(150);
        check(
            manager.cpuActivity.tokens.size > 0 && manager.cpuActivity.timer,
            'destroying one dock keeps other dock monitoring'
        );
        settings.set_string('adaptive-cpu-scale', 'total');
        await wait(1400);
        check(indicator()._cpu !== Infinity, 'total capacity scale remains finite');
        settings.set_int('adaptive-cpu-hover-delay', 120);
        icon().set_hover(false);
        indicator()._monitoring();
        await wait(100);
        check(!manager.cpuActivity.timer, 'inactive Activity mode suspends sampling');
        for (let i = 0; i < 5; i++) {
            icon().set_hover(true);
            indicator()._monitoring();
            await wait(20);
            icon().set_hover(false);
            indicator()._monitoring();
        }
        await wait(200);
        check(
            !manager.cpuActivity.timer && !mode().dwell,
            'rapid hover leaves no sampling or dwell timer'
        );
        const backend = Clutter.get_default_backend()
            .get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const [x, y] = icon()._iconContainer.get_transformed_position(),
            [width, height] = icon()._iconContainer.get_transformed_size();
        const side = indicator()._side;
        const point = (edge = false) => {
            const monitor = Main.layoutManager.primaryMonitor;
            switch (side) {
            case St.Side.LEFT:
                return [edge ? monitor.x : x + 2, y + height / 2];
            case St.Side.RIGHT:
                return [edge ? monitor.x + monitor.width - 1 : x + width - 2, y + height / 2];
            case St.Side.TOP:
                return [x + width / 2, edge ? monitor.y + 25 : y + 2];
            default:
                return [x + width / 2, edge ? monitor.y + monitor.height - 1 : y + height - 2];
            }
        };
        const move = coords => backend.notify_absolute_motion(GLib.get_monotonic_time(), ...coords);
        settings.set_boolean('hide-tooltip', true);
        settings.set_int('adaptive-cpu-hover-delay', 500);
        move([x + width / 2, y + height / 2]);
        await wait(650);
        check(
            !mode().active && !mode().dwell && !manager.cpuActivity.timer,
            'ordinary launcher hover cannot activate Activity mode'
        );
        move(point());
        await wait(100);
        check(indicator().label?.text === 'Waiting…', 'hover dwell shows waiting without app title');
        await wait(600);
        check(indicator().active, 'Activity activation begins startup measurement pair');
        const startupExit = [
            Main.layoutManager.primaryMonitor.x + Main.layoutManager.primaryMonitor.width / 2,
            Main.layoutManager.primaryMonitor.y + Main.layoutManager.primaryMonitor.height / 2,
        ];
        move(startupExit);
        await wait(100);
        check(
            !manager.cpuActivity.bootstrap && !manager.cpuActivity.process && !manager.cpuActivity.timer,
            'leaving during startup cancels follow-up and worker'
        );
        move(point());
        await wait(1400);
        check(
            mode().active && allActive(),
            'indicator dwell activates every running indicator in this dock'
        );
        check(indicator().label?.visible, 'indicator hover shows tooltip beside launcher');
        check(
            !indicator().label.text.includes(icon().app.get_name()),
            'hidden application title omitted from CPU tooltip'
        );
        move([x + width / 2, y + height / 2]);
        await wait(150);
        check(
            !indicator().label.visible && !icon().get_parent().label.visible,
            'return to icon respects hide application tooltip'
        );
        check(mode().active && allActive(), 'Activity mode persists over ordinary launcher area');
        const applications = manager.mainDock.dash._showAppsIcon;
        const [ax, ay] = applications.get_transformed_position();
        const [aw, ah] = applications.get_transformed_size();
        move([ax + aw / 2, ay + ah / 2]);
        await wait(50);
        check(mode().active && allActive(), 'Activity mode persists over Show Applications control');
        const container = manager.mainDock.dash._dashContainer;
        const [cx, cy] = container.get_transformed_position();
        move([cx + 1, cy + 1]);
        await wait(50);
        check(mode().active && allActive(), 'Activity mode persists over dock padding');
        move([x + width / 2, y + height / 2]);
        await wait(50);
        icon().get_parent().showLabel();
        check(!icon().get_parent().label.visible, 'delayed ordinary label cannot bypass hide setting');
        move(point(true));
        await wait(700);
        check(
            indicator().active && indicator().label.visible,
            'screen edge behind indicator remains hover target'
        );
        const outside = [
            Main.layoutManager.primaryMonitor.x + Main.layoutManager.primaryMonitor.width / 2,
            Main.layoutManager.primaryMonitor.y + Main.layoutManager.primaryMonitor.height / 2,
        ];
        move(outside);
        await wait(100);
        check(
            !mode().active && !manager.cpuActivity.timer,
            'leaving effective dock region stops dock-wide monitoring'
        );
        for (let i = 0; i < 4; i++) {
            move(point());
            await wait(20);
            move(outside);
            await wait(20);
        }
        check(
            !mode().active && !mode().dwell && !manager.cpuActivity.timer,
            'rapid indicator entry cancels shared dwell cleanly'
        );
        move(point());
        await wait(1700);
        indicator()._resetSmoothing();
        indicator().token.changed({percent: 250}, 4);
        check(indicator().label.text.includes('62.5%'), 'total-capacity tooltip scales actual percent');
        settings.set_string('adaptive-cpu-scale', 'core');
        indicator().token.changed({percent: 250}, 4);
        check(indicator().label.text.includes('250.0%'), 'tooltip preserves CPU above 100 percent');
        await wait(350);
        check(
            indicator().fraction > 0.98 && indicator().fraction <= 1,
            'visual activity reaches and clamps to full line'
        );
        const originalSample = manager.cpuActivity.sample;
        manager.cpuActivity.sample = () => {};
        while (manager.cpuActivity.process)
            await wait(20);
        settings.set_int('adaptive-cpu-animation', 0);
        indicator().token.changed({percent: 0}, 4);
        settings.set_int('adaptive-cpu-animation', 5000);
        indicator().token.changed({percent: 40}, 4);
        await wait(220);
        const displayed = indicator().fraction;
        check(displayed > 0 && displayed < 0.4, 'five-second animation advances on real frame clock');
        indicator().token.changed({percent: 45}, 4);
        check(
            Math.abs(indicator().fraction - displayed) < 0.00001,
            'long animation retargets without visual jump'
        );
        check(
            indicator().visualTarget < 0.45 && indicator()._cpu === 45,
            'smoothing changes geometry only'
        );
        await wait(220);
        check(
            indicator().fraction > displayed,
            'retargeted animation keeps moving between faster samples'
        );
        indicator().token.changed({percent: 95}, 4);
        check(indicator().visualTarget > 0.85, 'large increase remains promptly visible');
        settings.set_int('adaptive-cpu-animation', 0);
        indicator().token.changed({percent: 37.123}, 4);
        check(
            Math.abs(indicator().fraction - 0.37123) < 1e-8,
            'zero duration bypasses smoothing and deadband'
        );
        settings.set_int('adaptive-cpu-animation', 300);
        manager.cpuActivity.sample = originalSample;
        settings.set_boolean('hide-tooltip', false);
        check(
            indicator().label.text.includes(icon().app.get_name()),
            'application title restored when setting allows it'
        );
        const stream = Gio.File.new_for_path(`${root}/activity-tooltip.png`).replace(
            null,
            false,
            Gio.FileCreateFlags.NONE,
            null
        );
        await new Shell.Screenshot().screenshot(false, stream);
        stream.close(null);

        settings.set_int('adaptive-cpu-hover-delay', 0);
        await wait(1100);
        const originalPath = manager.cpuActivity.path;
        manager.cpuActivity.path = '/missing-worker';
        manager.cpuActivity.sample();
        await wait(1300);
        check(indicator()._cpu === null, 'failed worker falls back to ordinary indicator');
        check(
            indicator().label.text.includes('unavailable'),
            'failed worker remains distinguishable from waiting'
        );
        manager.cpuActivity.path = originalPath;
        await wait(1800);
        settings.set_enum('running-indicator-style', 2);
        await wait(350);
        check(!manager.cpuActivity.timer, 'unsupported shape transition stops worker');
        settings.set_enum('running-indicator-style', 10);
        await wait(150);
        new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).set_boolean(
            'enable-animations',
            false
        );
        await wait(150);
        check(!St.Settings.get().enable_animations, 'native reduced-motion setting applied');
        indicator().animate(1);
        check(!indicator().timeline, 'reduced motion uses immediate geometry');
        check(
            manager.mainDock.dash
                .getAppIcons()
                .map(i => i.app.get_id())
                .join() === roster,
            'CPU changes never alter launcher roster'
        );
        const monitor = manager.cpuActivity,
            renderer = indicator(),
            dockMode = mode();
        Main.extensionManager.disableExtension(uuid);
        await wait(200);
        check(
            !monitor.timer &&
                !monitor.bootstrap &&
                !monitor.process &&
                monitor.tokens.size === 0 &&
                !renderer.timeline &&
                !dockMode.dwell &&
                dockMode.members.size === 0,
            'disable clears worker, subscriptions, animation and hover'
        );
        Main.extensionManager.enableExtension(uuid);
        await wait(1300);
        check(module.dockManager.cpuActivity !== monitor, 're-enable creates fresh shared backend');
        settings.set_int('adaptive-cpu-hover-delay', 500);
        const pendingMode = module.dockManager.mainDock.dash.activityMode;
        pendingMode.updatePointer(true);
        pendingMode.updatePointer();
        await wait(50);
        check(!!pendingMode.dwell, 're-enabled dock owns pending activation dwell');
        Main.extensionManager.disableExtension(uuid);
        await wait(50);
        check(
            !pendingMode.dwell && pendingMode.members.size === 0,
            'disable cancels pending dock activation'
        );
        const file = Gio.File.new_for_path(`${info.path}/tests/native/cpu-prefs.js`);
        Gio.Subprocess.new(['gjs', '-m', file.get_path(), info.path, root], Gio.SubprocessFlags.NONE);
        for (
            let i = 0;
            i < 100 && !Gio.File.new_for_path(`${root}/prefs-result.json`).query_exists(null);
            i++
        )
            await wait(100);
        const prefsResult = JSON.parse(
            new TextDecoder().decode(
                Gio.File.new_for_path(`${root}/prefs-result.json`).load_contents(null)[1]
            )
        );
        check(prefsResult.pass, prefsResult.error ?? 'native preferences passed');
        checks.push(...prefsResult.checks);
        GLib.file_set_contents(`${root}/result.json`, JSON.stringify({pass: true, checks}));
    }
}
