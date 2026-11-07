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
        new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).set_boolean('enable-animations', true);
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
        settings.set_int('adaptive-cpu-interval', 1);
        settings.set_int('adaptive-cpu-hover-delay', 0);
        settings.set_enum('dock-position', Number(GLib.getenv('REVIEW_POSITION') ?? 2));
        await wait(400);
        Gio.Subprocess.new(['gjs', '-m', `${root}/client.js`, 'org.eidrien.D2DReviewSecond'], 0);
        await wait(1500);
        const manager = module.dockManager;
        const icon = () =>
            manager.mainDock.dash
                .getAppIcons()
                .find(i => i.app.get_id() === 'org.eidrien.D2DReviewSecond.desktop');
        const indicator = () => icon()._indicator._running;
        // Software-rendered nested shells may take longer to map the GTK client.
        for (let i = 0; i < 100 && !icon(); i++)
            await wait(100);
        check(!!icon(), 'real launcher present');
        const roster = manager.mainDock.dash
            .getAppIcons()
            .map(i => i.app.get_id())
            .join();
        settings.set_enum('running-indicator-style', 10);
        for (let i = 0; i < 60 && !(indicator()._cpu > 0); i++)
            await wait(100);
        check(indicator()._cpu > 0, 'real application CPU sample includes busy descendant');
        check(
            manager.cpuActivity.tokens.size >= 1 && !!manager.cpuActivity.timer,
            'shared sampler active'
        );
        indicator().token.changed({percent: 80}, 4);
        check(indicator().timeline?.get_actor() === indicator()._area, 'animation owns the drawing actor frame clock');
        await wait(450);
        check(
            Math.abs(indicator().fraction - 0.8) < 0.02,
            'animation advances real rendered CPU geometry'
        );
        print(`RENDER ${JSON.stringify({
            fraction: indicator().fraction,
            width: indicator()._width,
            height: indicator()._height,
            scale: St.ThemeContext.get_for_stage(global.stage).scale_factor,
        })}`);
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
        check(indicator().fraction > 0.98, 'inactive hover monitoring renders idle line');
        settings.set_string('adaptive-cpu-idle', 'dot');
        await wait(450);
        check(indicator().fraction < 0.02, 'idle preference change renders dot');
        settings.set_string('adaptive-cpu-idle', 'line');
        settings.set_int('adaptive-cpu-hover-delay', 0);
        const area = indicator()._area;
        settings.set_enum('running-indicator-style', 5);
        await wait(400);
        check(indicator()._area === area, 'compatible line transition reuses drawing actor');
        check(
            !manager.cpuActivity.timer && !manager.cpuActivity.process,
            'switching style stops sampling'
        );
        settings.set_enum('running-indicator-style', 10);
        await wait(1300);
        check(indicator()._area === area, 'return to Adaptive reuses drawing actor');
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
        check(!manager.cpuActivity.timer, 'hover mode suspends sampling when inactive');
        for (let i = 0; i < 5; i++) {
            icon().set_hover(true);
            indicator()._monitoring();
            await wait(20);
            icon().set_hover(false);
            indicator()._monitoring();
        }
        await wait(200);
        check(
            !manager.cpuActivity.timer && !indicator().dwell,
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
        move(point());
        await wait(100);
        check(indicator().label?.text === 'Waiting…', 'hover dwell shows waiting without app title');
        await wait(600);
        check(indicator().active && indicator().label.text === 'Waiting…', 'first CPU snapshot remains a waiting state');
        await wait(1000);
        check(indicator().active, 'real pointer activates monitoring after dwell');
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
        icon().get_parent().showLabel();
        check(!icon().get_parent().label.visible, 'delayed ordinary label cannot bypass hide setting');
        move(point(true));
        await wait(700);
        check(
            indicator().active && indicator().label.visible,
            'screen edge behind indicator remains hover target'
        );
        move(point());
        await wait(100);
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
        check(indicator().label.text.includes('unavailable'), 'failed worker remains distinguishable from waiting');
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
            renderer = indicator();
        Main.extensionManager.disableExtension(uuid);
        await wait(200);
        check(
            !monitor.timer &&
                !monitor.process &&
                monitor.tokens.size === 0 &&
                !renderer.timeline &&
                !renderer.dwell,
            'disable clears worker, subscriptions, animation and hover'
        );
        Main.extensionManager.enableExtension(uuid);
        await wait(1300);
        check(module.dockManager.cpuActivity !== monitor, 're-enable creates fresh shared backend');
        Main.extensionManager.disableExtension(uuid);
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
