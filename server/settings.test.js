import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WALL_SETTINGS_DEFAULTS,
  WALL_SETTINGS_BOUNDS,
  normalizeWallSettings,
} from './settings.js';

test('empty patch over defaults returns the defaults', () => {
  assert.deepEqual(normalizeWallSettings({}, WALL_SETTINGS_DEFAULTS), {
    maxColumns: 6,
    polaroidWidth: 180,
  });
});

test('clamps maxColumns to its bounds', () => {
  assert.equal(normalizeWallSettings({ maxColumns: 99 }).maxColumns, WALL_SETTINGS_BOUNDS.maxColumns.max);
  assert.equal(normalizeWallSettings({ maxColumns: 0 }).maxColumns, WALL_SETTINGS_BOUNDS.maxColumns.min);
});

test('rounds fractional maxColumns', () => {
  assert.equal(normalizeWallSettings({ maxColumns: 3.7 }).maxColumns, 4);
});

test('clamps polaroidWidth to its bounds', () => {
  assert.equal(normalizeWallSettings({ polaroidWidth: 999 }).polaroidWidth, WALL_SETTINGS_BOUNDS.polaroidWidth.max);
  assert.equal(normalizeWallSettings({ polaroidWidth: 10 }).polaroidWidth, WALL_SETTINGS_BOUNDS.polaroidWidth.min);
});

test('non-numeric value keeps the base value', () => {
  const base = { maxColumns: 4, polaroidWidth: 200 };
  assert.equal(normalizeWallSettings({ maxColumns: 'abc' }, base).maxColumns, 4);
});

test('partial patch updates only the provided key', () => {
  const base = { maxColumns: 4, polaroidWidth: 200 };
  const result = normalizeWallSettings({ polaroidWidth: 260 }, base);
  assert.deepEqual(result, { maxColumns: 4, polaroidWidth: 260 });
});

test('ignores unknown keys', () => {
  const result = normalizeWallSettings({ speed: 5, maxColumns: 3 });
  assert.deepEqual(result, { maxColumns: 3, polaroidWidth: 180 });
});

test('sanitizes a corrupt base object', () => {
  const result = normalizeWallSettings({}, { maxColumns: 999, polaroidWidth: 'x' });
  assert.deepEqual(result, { maxColumns: 8, polaroidWidth: 180 });
});

test('non-object patch is treated as empty', () => {
  assert.deepEqual(normalizeWallSettings(null), { maxColumns: 6, polaroidWidth: 180 });
});

test('null / boolean / array / whitespace inputs fall back to base', () => {
  const base = { maxColumns: 4, polaroidWidth: 200 };
  assert.equal(normalizeWallSettings({ maxColumns: null }, base).maxColumns, 4);
  assert.equal(normalizeWallSettings({ maxColumns: true }, base).maxColumns, 4);
  assert.equal(normalizeWallSettings({ maxColumns: [5] }, base).maxColumns, 4);
  assert.equal(normalizeWallSettings({ maxColumns: '   ' }, base).maxColumns, 4);
  assert.equal(normalizeWallSettings({ polaroidWidth: null }, base).polaroidWidth, 200);
});

test('numeric strings are still accepted', () => {
  assert.equal(normalizeWallSettings({ maxColumns: '3' }).maxColumns, 3);
  assert.equal(normalizeWallSettings({ polaroidWidth: '250' }).polaroidWidth, 250);
});
