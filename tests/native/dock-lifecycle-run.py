# SPDX-FileCopyrightText: Eidrien
# SPDX-License-Identifier: MIT
import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import time

p = argparse.ArgumentParser()
p.add_argument('--baseline', action='store_true')
p.add_argument('--baseline-source', type=Path)
p.add_argument('--baseline-ref', default='30c263c')
p.add_argument('--output', required=True, type=Path)
p.add_argument('--dnd', choices=['on', 'off'], default='on')
p.add_argument('--counter', choices=['true', 'false'], default='true')
a = p.parse_args()
root = a.output.resolve()
root.mkdir(parents=True, exist_ok=False)
for name in ['config', 'data', 'cache', 'runtime']:
    (root / name).mkdir(mode=0o700)
extensions = root / 'data/gnome-shell/extensions'
extensions.mkdir(parents=True)
target = extensions / 'dash-to-dock-adaptive@eidrien.local'
shutil.copytree(Path(__file__).resolve().parents[2], target,
                ignore=shutil.ignore_patterns('.git', '_build', '__pycache__'))
if a.baseline:
    for filename in ['dash.js', 'docking.js', 'theming.js']:
        (target / filename).write_bytes((a.baseline_source / filename).read_bytes() if a.baseline_source else
            subprocess.check_output(['git', 'show', f'{a.baseline_ref}:{filename}'], cwd=Path(__file__).resolve().parents[2]))
subprocess.run(['glib-compile-schemas', '--strict', str(target / 'schemas')], check=True)
probe = extensions / 'd2d-review@eidrien.local'
probe.mkdir()
(probe / 'metadata.json').write_text(json.dumps(dict(uuid=probe.name, name='D2D review probe', description='Isolated PR review', **{'shell-version':['46']})))
shutil.copy(Path(__file__).with_name('dock-lifecycle.js'), probe / 'extension.js')
shutil.copy(Path(__file__).with_name('dock-client.js'), root / 'client.js')
apps = root / 'data/applications'
apps.mkdir()
for name in ['First', 'Second']:
    appid = f'org.eidrien.D2DReview{name}'
    (apps / f'{appid}.desktop').write_text(f'[Desktop Entry]\nType=Application\nName={name} review client\nExec=gjs -m {root}/client.js {appid}\nIcon=utilities-terminal\nStartupWMClass={appid}\n')
env = dict(os.environ, D2D_BASELINE='1' if a.baseline else '', REVIEW_ROOT=str(root), LIBGL_ALWAYS_SOFTWARE='1', GALLIUM_DRIVER='llvmpipe',
           XDG_CONFIG_HOME=str(root/'config'), XDG_DATA_HOME=str(root/'data'), XDG_CACHE_HOME=str(root/'cache'),
           XDG_RUNTIME_DIR=str(root/'runtime'), XDG_SESSION_TYPE='wayland', XDG_CURRENT_DESKTOP='GNOME',
           GSETTINGS_BACKEND='dconf', DBUS_SYSTEM_BUS_ADDRESS=f'unix:path={root}/runtime/system-bus')
(root / 'session.sh').write_text('''set -eu
gsettings set org.gnome.shell enabled-extensions '["d2d-review@eidrien.local"]'
gsettings set org.gnome.shell disabled-extensions '[]'
gsettings set org.gnome.shell favorite-apps '["org.eidrien.D2DReviewFirst.desktop"]'
gsettings set org.gnome.shell welcome-dialog-last-shown-version '46'
gsettings set org.gnome.desktop.notifications show-banners ''' + ('false' if a.dnd=='on' else 'true') + '''
gsettings --schemadir "$REVIEW_ROOT/data/gnome-shell/extensions/dash-to-dock-adaptive@eidrien.local/schemas" set org.gnome.shell.extensions.dash-to-dock show-icons-emblems true
gsettings --schemadir "$REVIEW_ROOT/data/gnome-shell/extensions/dash-to-dock-adaptive@eidrien.local/schemas" set org.gnome.shell.extensions.dash-to-dock show-icons-notifications-counter ''' + a.counter + '''
gsettings --schemadir "$REVIEW_ROOT/data/gnome-shell/extensions/dash-to-dock-adaptive@eidrien.local/schemas" set org.gnome.shell.extensions.dash-to-dock dock-fixed true
gsettings --schemadir "$REVIEW_ROOT/data/gnome-shell/extensions/dash-to-dock-adaptive@eidrien.local/schemas" set org.gnome.shell.extensions.dash-to-dock show-trash false
gsettings --schemadir "$REVIEW_ROOT/data/gnome-shell/extensions/dash-to-dock-adaptive@eidrien.local/schemas" set org.gnome.shell.extensions.dash-to-dock show-mounts false
gsettings set org.gnome.mutter dynamic-workspaces false
gsettings set org.gnome.desktop.wm.preferences num-workspaces 3
exec gnome-shell --nested --wayland --no-x11 --sm-disable
''')
script = '''set -eu
dbus-daemon --session --address="$DBUS_SYSTEM_BUS_ADDRESS" --nofork > "$REVIEW_ROOT/system-bus.log" 2>&1 &
trap 'kill $! 2>/dev/null || true' EXIT
dbus-run-session -- xvfb-run -a -s '-screen 0 1280x800x24 +extension GLX' bash "$REVIEW_ROOT/session.sh"
'''
with (root/'shell.log').open('w') as log:
    process = subprocess.Popen(['bash','-c',script],env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
    try:
        for _ in range(110):
            if (root/'result.json').exists():
                result = json.loads((root/'result.json').read_text())
                print(json.dumps(result), flush=True)
                if not result.get('pass'):
                    raise RuntimeError(result)
                break
            if process.poll() is not None:
                raise RuntimeError(f'Shell exited {process.returncode}')
            time.sleep(1)
        else:
            raise TimeoutError(str(root))
    finally:
        try:
            os.killpg(process.pid,signal.SIGTERM)
            process.wait(timeout=5)
        except ProcessLookupError:
            pass
        except subprocess.TimeoutExpired:
            os.killpg(process.pid,signal.SIGKILL)
            process.wait()
