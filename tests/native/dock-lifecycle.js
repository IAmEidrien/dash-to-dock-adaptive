// SPDX-FileCopyrightText: Eidrien
// SPDX-License-Identifier: MIT
/* global global */
/* Sequential compositor transitions are intentional in this integration probe. */
/* eslint-disable no-await-in-loop */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
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
                GLib.file_set_contents(`${root}/progress.json`, JSON.stringify(checks));
            };
        Main.overview.hide();
        Main.extensionManager.enableExtension(uuid);
        await wait(1000);
        const info = Main.extensionManager.lookup(uuid);
        check(info.state === 1, 'enabled');
        const module = await import(Gio.File.new_for_path(`${info.path}/extension.js`).get_uri());
        const settings = info.stateObj.getSettings('org.gnome.shell.extensions.dash-to-dock');
        settings.set_enum('transparency-mode', 3);
        const manager = module.dockManager;
        const dash = () => module.dockManager.mainDock.dash;
        const ids = () =>
            dash()
                .getAppIcons()
                .map(i => i.app.get_id());
        const notifications = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        const clients = [];
        for (const name of ['First', 'Second']) {
            clients.push(
                Gio.Subprocess.new(['gjs', '-m', `${root}/client.js`, `org.eidrien.D2DReview${name}`], 0)
            );
            await wait(900);
        }
        const windows = () =>
            global
                .get_window_actors()
                .map(a => a.meta_window)
                .filter(w => w.title?.startsWith('org.eidrien.D2DReview'));
        for (let i = 0; i < 50 && windows().length < 2; i++)
            await wait(200);
        check(windows().length === 2, 'two real clients');
        for (let n = 0; n < 4; n++) {
            const beforeDnd = manager.mainDock;
            notifications.set_boolean('show-banners', n % 2 === 0);
            await wait(150);
            check(manager.mainDock === beforeDnd, 'DND updates indicators without reconstructing dock');
            const old = manager.mainDock;
            const transparency = old._themeManager._transparency;
            const actor = global.get_window_actors().find(a => a.meta_window.title?.endsWith('Second'));
            transparency._onWindowActorAdded(null, actor);
            transparency._onWindowActorAdded(null, actor);
            check(
                GLib.getenv('D2D_BASELINE') || transparency._trackedWindows.get(actor).length === 3,
                'one set of transparency handlers'
            );
            old.dash._queueRedisplay(); // Leave redraw work pending across reconstruction.
            settings.set_enum('dock-position', n % 2 === 0 ? 2 : 3);
            await wait(650);
            check(manager.mainDock !== old, 'dock reconstructed');
            check(transparency._trackedWindows.size === 0, 'old transparency handlers released');
            check(!old.dash._redisplayLater, 'old pending reconciliation cancelled');
            const first = windows().find(w => w.title.endsWith('First'));
            const second = windows().find(w => w.title.endsWith('Second'));
            first.change_workspace_by_index(n % 2, false);
            second.change_workspace_by_index(1 - (n % 2), false);
            await wait(400);
            const list = ids();
            check(
                list.includes('org.eidrien.D2DReviewSecond.desktop'),
                'running launcher survives DND and reconstruction'
            );
            check(
                list.indexOf('org.eidrien.D2DReviewFirst.desktop') <
                    list.indexOf('org.eidrien.D2DReviewSecond.desktop') ===
                    (n % 2 === 0),
                'adaptive order follows workspace changes'
            );
        }
        const current = dash(),
            original = current._redisplay;
        current._redisplay = () => {
            throw Error('D2D_TEST_EXPECTED_REDISPLAY_FAILURE');
        };
        current._queueRedisplay();
        await wait(200);
        current._redisplay = original;
        current._queueRedisplay();
        await wait(250);
        check(!current._redisplayLater, 'reconciliation source clears after injected failure');
        windows()
            .find(w => w.title.endsWith('Second'))
            .delete(global.get_current_time());
        await wait(800);
        if (GLib.getenv('D2D_BASELINE')) {
            check(dash().getAppIcons().find(i => i.app.get_id().endsWith('Second.desktop'))?.running === false,
                'baseline running indicator updates while launcher list is frozen');
        }
        check(
            !ids().includes('org.eidrien.D2DReviewSecond.desktop'),
            'launcher removal still reconciles after failure'
        );
        clients[1] = Gio.Subprocess.new(['gjs', '-m', `${root}/client.js`, 'org.eidrien.D2DReviewSecond'], 0);
        await wait(1000);
        check(
            ids().includes('org.eidrien.D2DReviewSecond.desktop'),
            'launcher creation still reconciles after failure'
        );
        Main.extensionManager.disableExtension(uuid);
        await wait(200);
        Main.extensionManager.enableExtension(uuid);
        await wait(900);
        check(
            ids().includes('org.eidrien.D2DReviewSecond.desktop'),
            'disable and re-enable retains live roster'
        );
        Main.extensionManager.disableExtension(uuid);
        clients.forEach(c => {
            try {
                c.force_exit();
            } catch {}
        });
        GLib.file_set_contents(`${root}/result.json`, JSON.stringify({pass: true, checks}));
    }
}
