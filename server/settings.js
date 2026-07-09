// Pure, dependency-free settings logic shared by the API and its tests.
// Kept importable (no side effects) so the clamp/merge rules can be unit-tested.

export const WALL_SETTINGS_BOUNDS = {
  maxColumns: { min: 1, max: 8 },
  polaroidWidth: { min: 100, max: 320 },
};

export const WALL_BACKGROUND_PRESET_IDS = ['generali-boomerang', 'generali', 'bg'];

export const DEFAULT_BACKGROUND = { type: 'preset', value: 'generali-boomerang' };

export const WALL_SETTINGS_DEFAULTS = {
  maxColumns: 6,
  polaroidWidth: 180,
  background: DEFAULT_BACKGROUND,
};

const clamp = (value, min, max, fallback, round) => {
  if (typeof value !== 'number' && typeof value !== 'string') return fallback;
  if (typeof value === 'string' && value.trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const v = round ? Math.round(n) : n;
  return Math.min(max, Math.max(min, v));
};

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const isValidBackground = (type, value) => {
  if (type === 'color') return typeof value === 'string' && HEX_COLOR.test(value);
  if (type === 'preset') return WALL_BACKGROUND_PRESET_IDS.includes(value);
  if (type === 'custom') return typeof value === 'string' && value.length > 0 && value.length <= 2048;
  return false;
};

// Accept a valid {type,value} pair (stripped to just those keys); otherwise keep base.
const normalizeBackground = (bg, base) => {
  if (!bg || typeof bg !== 'object') return base;
  if (isValidBackground(bg.type, bg.value)) return { type: bg.type, value: bg.value };
  return base;
};

const sanitize = (source, base) => ({
  maxColumns: clamp(
    source.maxColumns,
    WALL_SETTINGS_BOUNDS.maxColumns.min,
    WALL_SETTINGS_BOUNDS.maxColumns.max,
    base.maxColumns,
    true,
  ),
  polaroidWidth: clamp(
    source.polaroidWidth,
    WALL_SETTINGS_BOUNDS.polaroidWidth.min,
    WALL_SETTINGS_BOUNDS.polaroidWidth.max,
    base.polaroidWidth,
    false,
  ),
  background: normalizeBackground(source.background, base.background),
});

// Merge an untrusted patch over a base, clamping every field. Missing/invalid
// keys keep the (sanitized) base value; unknown keys are ignored.
export const normalizeWallSettings = (patch = {}, base = WALL_SETTINGS_DEFAULTS) => {
  const safeBase = sanitize(base && typeof base === 'object' ? base : {}, WALL_SETTINGS_DEFAULTS);
  const source = patch && typeof patch === 'object' ? patch : {};
  return {
    maxColumns: 'maxColumns' in source
      ? clamp(source.maxColumns, WALL_SETTINGS_BOUNDS.maxColumns.min, WALL_SETTINGS_BOUNDS.maxColumns.max, safeBase.maxColumns, true)
      : safeBase.maxColumns,
    polaroidWidth: 'polaroidWidth' in source
      ? clamp(source.polaroidWidth, WALL_SETTINGS_BOUNDS.polaroidWidth.min, WALL_SETTINGS_BOUNDS.polaroidWidth.max, safeBase.polaroidWidth, false)
      : safeBase.polaroidWidth,
    background: 'background' in source
      ? normalizeBackground(source.background, safeBase.background)
      : safeBase.background,
  };
};
