# Git-managed installation and upstream workflow

## Active repository and branch

The active public repository is
[`IAmEidrien/dash-to-dock-adaptive`](https://github.com/IAmEidrien/dash-to-dock-adaptive),
a genuine fork of `micheleg/dash-to-dock`. Its default/update branch is
**`master`**, matching upstream. Adaptive 8 is based on the official v110 tag
(`2dfae3474d6984b566ef0c3dab1524a675bbba48`).

The private `Dash-to-Dock-Adaptive-Old` repository retains the original snapshot
history, through Adaptive 7's 200 ms drag update (`b1b0ee9`). That unrelated
history has not been rewritten or transplanted into the public fork. It remains
a historical reference, while all its current custom behavior is carried here.

## One-time switch for an existing installed checkout

Keep the extension at
`~/.local/share/gnome-shell/extensions/dash-to-dock-adaptive@eidrien.local`.
The extension UUID, settings schema and gettext domain are unchanged. Personal
GSettings values are outside Git and are not replaced by the branch switch.

First inspect the checkout:

```sh
cd ~/.local/share/gnome-shell/extensions/dash-to-dock-adaptive@eidrien.local
git status --short
```

Proceed when that output is empty. Preserve or commit any local tracked edits
first. Generated `schemas/gschemas.compiled` is ignored and stays local.

For the original checkout on `main`, with no existing local `master` branch:

```sh
git remote set-url origin git@github.com:IAmEidrien/dash-to-dock-adaptive.git
git fetch --prune origin
git switch --track origin/master
```

This creates a local `master` tracking the public fork. The local `main` branch
still preserves the old commits. There is no reset, force-push, history deletion
or merge of unrelated histories. If `master` already exists locally, inspect its
history before reusing it; do not overwrite it with a forced checkout.

Log out/back in on Wayland. Reopen or refresh this checkout in Gitpulsar and
use **Pull** on `master` for subsequent updates. A renamed repository's redirect
is not sufficient here: the old `main` branch is not the fork's update branch.
Adaptive 8 does not change the schema XML from Adaptive 7, so this migration
does not itself require schema recompilation.

## Ordinary updates and runtime assets

Use Gitpulsar Pull, or `git pull --ff-only`, on this fork's `master`. Recompile
schema changes with `glib-compile-schemas --strict schemas`, then log out/back
in when runtime code changes. Documentation-only updates need no session
restart. Keep personal GSettings values outside Git.

The repository root is directly installable, with these source/artifact pairs:

| Editable source | Runtime artifact committed to Git |
| --- | --- |
| `_stylesheet.scss` | `stylesheet.css` |
| `po/*.po` | `locale/*/LC_MESSAGES/dashtodock.mo` |
| `schemas/*.gschema.xml` | None: `gschemas.compiled` stays local/ignored |

Run `make refresh-runtime` after source changes. It builds schemas, stylesheet
and translations. Rebuild CSS explicitly with `make -B stylesheet.css` (or
`SASS=dart` for Dart Sass). Do not hand-edit generated CSS. `make clean` removes
local artifacts including the tracked stylesheet; rebuild or restore it before
committing. `make check` runs adaptive regression tests and upstream ESLint.

Do not run copy-based `make install` over a Git-managed extension checkout.
The install target refuses to replace a directory containing `.git`. Build
packages outside the installed checkout with `make zip-file`.

## Future upstream updates

Maintain an `upstream` remote pointing to `micheleg/dash-to-dock`. Fetch its
release tags and choose a release compatible with the supported GNOME versions.
Merge it on a development branch based on Adaptive `master`, inspect the custom
diff, regenerate affected runtime assets and validate before publishing an
ordinary fast-forward update to Adaptive `master`. Never force-push shared
history or turn the installed checkout into an automatic upstream deployment.

Preserve upstream copyright notices and `COPYING`. Version declarations inherit
upstream support claims; automated checks do not establish native runtime
compatibility for every adaptive feature on every listed Shell version.
