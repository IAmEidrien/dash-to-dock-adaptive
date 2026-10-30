import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
const {visibleApp, visibleWindow} = await import(`data:text/javascript,${encodeURIComponent(readFileSync(new URL('../launcherVisibility.js', import.meta.url), 'utf8'))}`);
const window = values => ({get_transient_for: () => null, is_fullscreen: () => false,
    get_tile_match: () => null, maximized_horizontally: false, maximized_vertically: false, ...values});
test('floating filtering preserves fullscreen, maximized and tiled windows', () => {
    const settings = {hideFloatingWindows: true};
    assert.equal(visibleWindow(window(), settings), false);
    for (const values of [{is_fullscreen: () => true}, {maximized_horizontally: true},
        {maximized_vertically: true}, {get_tile_match: () => ({})}])
        assert.equal(visibleWindow(window(values), settings), true);
    assert.equal(visibleWindow(window(), {}), true);
});
test('transient filtering is independent and app IDs are exact', () => {
    assert.equal(visibleWindow(window({get_transient_for: () => ({})}), {hideTransientWindows: true}), false);
    assert.equal(visibleApp({get_id: () => 'a.desktop'}, {hiddenApplications: ['a.desktop']}), false);
    assert.equal(visibleApp({get_id: () => 'ab.desktop'}, {hiddenApplications: ['a.desktop']}), true);
});
