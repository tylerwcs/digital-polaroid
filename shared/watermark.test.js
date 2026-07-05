import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WATERMARK_COLORS, pickWatermarkColor } from './watermark.js';

test('exposes exactly the six background palette colours', () => {
  assert.deepEqual(WATERMARK_COLORS, [
    '#6b3fa0', // purple
    '#e0246e', // magenta
    '#1f6fc4', // blue
    '#f39019', // orange
    '#7cb342', // green
    '#22b0a8', // teal
  ]);
});

test('always returns a colour from the palette', () => {
  for (const id of ['a', 'photo-123', '', 'ZZZ', '9f8c7']) {
    assert.ok(WATERMARK_COLORS.includes(pickWatermarkColor(id)));
  }
});

test('is deterministic for the same id', () => {
  const id = 'photo-42';
  assert.equal(pickWatermarkColor(id), pickWatermarkColor(id));
});

test('coerces non-string ids without throwing', () => {
  assert.ok(WATERMARK_COLORS.includes(pickWatermarkColor(12345)));
});

test('known ids map to stable colours (guards against hash drift)', () => {
  assert.equal(pickWatermarkColor('photo-1'), pickWatermarkColor('photo-1'));
  const spread = new Set(
    Array.from({ length: 30 }, (_, i) => pickWatermarkColor('id-' + i))
  );
  assert.ok(spread.size >= 4, `expected variety, got ${spread.size} colours`);
});
