// Window chrome decisions: Mica support, title bar overlay colours, test overrides (src/main/window-chrome.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SIZE, MIN_SIZE, SOLID_BACKGROUND, TRANSPARENT, initialSize, themeSourceFrom, titleBarOverlay, wantsMica,
  windowBackground, windowsBuild, zoomFor, ZOOM_LIMITS,
} from '../src/main/window-chrome.js';

test('Mica only on Windows 11 22H2+, without high contrast or the test switch', () => {
  assert.equal(windowsBuild('10.0.22631'), 22631);
  assert.equal(windowsBuild('garbage'), 0);
  assert.equal(wantsMica({ platform: 'win32', release: '10.0.22621' }), true);
  assert.equal(wantsMica({ platform: 'win32', release: '10.0.26300' }), true);
  assert.equal(wantsMica({ platform: 'win32', release: '10.0.22000' }), false, 'Windows 11 21H2');
  assert.equal(wantsMica({ platform: 'win32', release: '10.0.19045' }), false, 'Windows 10');
  assert.equal(wantsMica({ platform: 'linux', release: '6.1.0' }), false);
  assert.equal(wantsMica({ platform: 'win32', release: '10.0.26300', env: { UF_NO_MICA: '1' } }), false);
  assert.equal(wantsMica({ platform: 'win32', release: '10.0.26300', highContrast: true }), false);
});

test('caption glyphs follow the theme and high contrast', () => {
  assert.deepEqual(titleBarOverlay({ dark: false }), { color: TRANSPARENT, symbolColor: '#242424', height: 48 });
  assert.equal(titleBarOverlay({ dark: true }).symbolColor, '#FFFFFF');
  assert.equal(titleBarOverlay({ dark: true, highContrast: true, highContrastText: '#ffff00ff' }).symbolColor, '#ffff00');
  assert.equal(titleBarOverlay({ dark: false, highContrast: true, highContrastText: null }).symbolColor, '#242424');
});

test('window background is transparent under Mica, else the WinUI base colour', () => {
  assert.equal(windowBackground({ backdrop: 'mica', dark: true }), TRANSPARENT);
  assert.equal(windowBackground({ backdrop: 'solid', dark: true }), SOLID_BACKGROUND.dark);
  assert.equal(windowBackground({ backdrop: 'solid', dark: false }), SOLID_BACKGROUND.light);
});

test('test overrides: UF_THEME and UF_WINDOW_SIZE', () => {
  assert.equal(themeSourceFrom({ UF_THEME: 'dark' }), 'dark');
  assert.equal(themeSourceFrom({ UF_THEME: 'LIGHT' }), 'light');
  assert.equal(themeSourceFrom({ UF_THEME: 'purple' }), 'system');
  assert.equal(themeSourceFrom({}), 'system');
  assert.deepEqual(initialSize({ UF_WINDOW_SIZE: '1920x1080' }), { width: 1920, height: 1080 });
  assert.deepEqual(initialSize({ UF_WINDOW_SIZE: '800x600' }), MIN_SIZE, 'never below the minimum');
  assert.deepEqual(initialSize({ UF_WINDOW_SIZE: 'big' }), DEFAULT_SIZE);
  assert.deepEqual(initialSize({}), DEFAULT_SIZE);
});

test('zoom keys work without a menu, within limits', () => {
  const key = (k, code, extra = {}) => ({ type: 'keyDown', key: k, code, control: true, ...extra });
  assert.equal(zoomFor(key('=', 'Equal'), 0), 0.5);
  assert.equal(zoomFor(key('+', 'Equal', { shift: true }), 1), 1.5);
  assert.equal(zoomFor(key('+', 'NumpadAdd'), 0), 0.5);
  assert.equal(zoomFor(key('-', 'Minus'), 0), -0.5);
  assert.equal(zoomFor(key('0', 'Digit0'), 2.5), 0);
  assert.equal(zoomFor(key('=', 'Equal'), ZOOM_LIMITS.max), ZOOM_LIMITS.max);
  assert.equal(zoomFor(key('-', 'Minus'), ZOOM_LIMITS.min), ZOOM_LIMITS.min);
  assert.ok(ZOOM_LIMITS.max >= Math.log(2) / Math.log(1.2), '200% is reachable');
  assert.equal(zoomFor(key('s', 'KeyS'), 0), null);
  assert.equal(zoomFor({ type: 'keyDown', key: '=', code: 'Equal' }, 0), null, 'needs Ctrl');
  assert.equal(zoomFor({ ...key('=', 'Equal'), type: 'keyUp' }, 0), null);
  assert.equal(zoomFor(key('=', 'Equal', { alt: true }), 0), null);
});
