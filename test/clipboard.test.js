// Screenshot paste against a stand-in for Electron 44's async clipboard API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readClipboardImage } from '../src/main/ocr/clipboard.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function fakeClipboard({ types = [], text = false, bytes = PNG } = {}) {
  return {
    has: async mime => mime === 'text/plain' && text,
    read: async () => (types.length ? [{ types, getType: async () => new Blob([bytes], { type: 'image/png' }) }] : []),
  };
}
const decode = size => () => ({ isEmpty: () => !size, getSize: () => size ?? { width: 0, height: 0 } });

test('a Win+Shift+S screenshot (image/png) is returned with its size', async () => {
  const cb = fakeClipboard({ types: ['image/png', 'electron application/osclipboard;format="DataObject"'] });
  const r = await readClipboardImage(cb, decode({ width: 373, height: 321 }));
  assert.equal(r.error, undefined);
  assert.deepEqual([...r.png], [...PNG]);
  assert.deepEqual([r.width, r.height, r.hasText], [373, 321, false]);
});

test('no image on the clipboard is reported as no-image, with whether text is there', async () => {
  const r = await readClipboardImage(fakeClipboard({ text: true }), decode(null));
  assert.equal(r.error.code, 'no-image');
  assert.equal(r.hasText, true);
});

test('an image that does not decode is reported as no-image', async () => {
  const r = await readClipboardImage(fakeClipboard({ types: ['image/png'] }), decode(null));
  assert.equal(r.error.code, 'no-image');
});
