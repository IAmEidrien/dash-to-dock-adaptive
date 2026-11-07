// SPDX-FileCopyrightText: Eidrien
// SPDX-License-Identifier: MIT
import Gtk from 'gi://Gtk?version=4.0';
const app = new Gtk.Application({application_id: ARGV[0]});
app.connect('activate', () =>
    new Gtk.ApplicationWindow({
        application: app,
        title: ARGV[0],
        default_width: 400,
        default_height: 300,
    }).present()
);
app.run([]);
