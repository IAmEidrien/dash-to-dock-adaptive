# Licensing and provenance

GPL-2.0-or-later retained: upstream-derived runtime code cannot be relicensed MIT.
COPYING and upstream copyright notices remain unchanged.
desktopIconsIntegration.js retains its separate one-clause BSD notice.
update_baseline.sh is a separate GPL-3.0-or-later maintenance script;
its GPLv3 grant is not downgraded to GPLv2. The full text is included in
LICENSES/GPL-3.0-or-later.txt. Other per-file grants
remain in force; this is not a claim that every repository file is GPLv2.
Source: https://github.com/micheleg/dash-to-dock

The independent CPU sampling, activity renderer/preferences and contextual
preference helpers (`cpu_activity.py`, `cpuActivity.js`, `activityIndicator.js`,
`activityPrefs.js`, `conditionalPrefs.js`) and their new tests carry MIT SPDX
notices. The complete grant is in `LICENSES/MIT.txt`, also included in packages.
Changes to existing upstream-derived files retain those files' existing grants.

## GNOME distribution

Where original sources are marked MIT, that grant does not cover GNOME Shell or other
third-party components. MIT permits reuse in a GPL-covered combination;
distribution of such a combination must also satisfy its applicable GPL terms.
This does not turn GPL-covered third-party code into MIT code. GNOME extension
review requires compatible terms and attribution, not the removal of permissive
source licenses. Licensing alone does not establish extension-store readiness.

Reference: https://gjs.guide/extensions/review-guidelines/review-guidelines.html#licensing
Compatibility: https://www.gnu.org/licenses/gpl-faq.html#WhatDoesCompatMean

## Maintenance policy

Eidrien authorizes MIT for original work wherever compatible. Prefer
GPL-2.0-or-later when copyleft terms are needed and the provenance permits it.
Never downgrade third-party GPLv3 code, remove attribution, or infer a license
from a public repository or extension-store listing. Preserve file-specific
licenses and notices. Audit new copied code, assets and bundled dependencies
before including them. An API dependency is not itself a transfer of ownership.
Previously distributed copies retain their original license grants; this change
does not revoke them. Repository visibility and release versions are unchanged.
