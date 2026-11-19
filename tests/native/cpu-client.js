// SPDX-FileCopyrightText: Eidrien
// SPDX-License-Identifier: MIT
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';
const app = new Gtk.Application({application_id: ARGV[0]});
let busy;
app.connect('activate', () => {
    busy = Gio.Subprocess.new(
        ['python3', '-c', 'import time\nend=time.monotonic()+45\nwhile time.monotonic()<end: pass'],
        0
    );
    new Gtk.ApplicationWindow({
        application: app,
        title: ARGV[0],
        default_width: 400,
        default_height: 300,
    }).present();
});
app.connect('shutdown', () => busy?.force_exit());
app.run([]);
