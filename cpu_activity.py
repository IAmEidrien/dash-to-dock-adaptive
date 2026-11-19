# SPDX-FileCopyrightText: Eidrien
# SPDX-License-Identifier: MIT
"""Bounded, unprivileged /proc CPU snapshot. Never runs in Shell's event loop."""
import json
import os
from pathlib import Path
import sys
import time

MAX_PROCESSES = 16384


def stat_process(path):
    text = path.read_text()
    fields = text[text.rindex(')') + 2:].split()
    return {'ppid': int(fields[1]), 'ticks': int(fields[11]) + int(fields[12]),
            'start': int(fields[19])}


def sample(request, proc=Path('/proc')):
    started = time.monotonic()
    previous = request.get('previous') or {}
    previous_rows = previous.get('rows', {})
    elapsed = started - previous.get('time', started)
    hz = os.sysconf('SC_CLK_TCK')
    apps = request.get('apps', {})
    if len(apps) > 256:
        raise ValueError('too many applications')
    rows = {}
    denied = set()
    inaccessible = False
    names = [p for p in proc.iterdir() if p.name.isdecimal()]
    if len(names) > MAX_PROCESSES:
        raise ValueError('process limit')
    for path in names:
        owned = False
        if time.monotonic() - started > 0.7:
            raise TimeoutError('process scan budget')
        try:
            if path.stat().st_uid != os.getuid():
                continue
            owned = True
            rows[int(path.name)] = stat_process(path / 'stat')
        except PermissionError:
            inaccessible |= owned
            denied.add(int(path.name))
        except (OSError, ValueError, IndexError):
            denied.add(int(path.name))
    children = {}
    for pid, row in rows.items():
        children.setdefault(row['ppid'], []).append(pid)
    owners = {}
    groups = {}
    for app, roots in apps.items():
        if time.monotonic() - started > 0.7:
            raise TimeoutError('attribution budget')
        if len(roots) > 256:
            raise ValueError('root limit')
        roots = set(int(p) for p in roots if int(p) > 1)
        group = set()
        pending = [(pid, 0) for pid in roots if pid in rows]
        bounded = True
        while pending:
            pid, depth = pending.pop()
            if pid in group:
                continue
            if depth > 64:
                bounded = False
                break
            group.add(pid)
            pending.extend((child, depth + 1) for child in children.get(pid, []))
        groups[app] = (group, not inaccessible and bounded and bool(roots) and roots <= group and not (roots & denied))
        for pid in group:
            owners.setdefault(pid, set()).add(app)
    result = {}
    kept = {}
    for app, (group, valid) in groups.items():
        ticks = 0
        for pid in group:
            row = rows[pid]
            key = f"{pid}:{row['start']}"
            kept[key] = row['ticks']
            old = previous_rows.get(key)
            if old is None or row['ticks'] < old or len(owners[pid]) != 1:
                valid = False
            else:
                ticks += row['ticks'] - old
        # Process churn/reuse warms up again rather than displaying a false zero.
        result[app] = {'percent': 100 * ticks / hz / elapsed if valid and elapsed >= 0.1 else None,
                       'processes': len(group), 'estimated': True}
    return {'time': started, 'rows': kept, 'cpus': max(1, os.cpu_count() or 1), 'apps': result}


if __name__ == '__main__':
    payload = sys.stdin.read(262145)
    if len(payload) > 262144:
        raise ValueError('request limit')
    print(json.dumps(sample(json.loads(payload)), allow_nan=False))
