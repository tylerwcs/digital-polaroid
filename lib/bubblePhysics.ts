// PHYSICS is mutable so the dev DebugPanel can tweak values at runtime.
// The rAF loop reads each field every frame, so changes take effect immediately.
export const PHYSICS = {
  // Wander-based drift (replaces old per-frame random wind, which caused jitter)
  WANDER_STRENGTH: 0.45,       // Max target velocity magnitude per axis
  WANDER_EASING: 0.068,        // How fast velocity eases toward target (0–1)
  WANDER_INTERVAL_MS: 3600,    // How often each bubble picks a new target velocity

  DAMPING: 0.951,              // Velocity damping per frame (1.0 = no damping)
  MAX_SPEED: 1.0,              // Max velocity magnitude (px/frame)
  WALL_BOUNCE_DAMP: 0.25,      // Velocity scale on wall collision
  COLLISION_DAMP: 0.45,        // Velocity scale on bubble-bubble collision

  RADIUS_MIN: 195,
  RADIUS_MAX: 425,
  RADIUS_RATIO_MIN: 0.16,      // Min radius as fraction of min(viewportW, viewportH)
  RADIUS_RATIO_MAX: 0.22,

  MAX_BUBBLES: 8,
};

export interface BubbleState {
  id: string;
  photoId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  // Wander target velocity — re-randomized every WANDER_INTERVAL_MS
  targetVx: number;
  targetVy: number;
  lastWanderTs: number;
  radius: number;
  spawnTime: number;
  lifecycle: 'entering' | 'live' | 'exiting';
}

export const randomInRange = (min: number, max: number) => min + Math.random() * (max - min);

export const computeSpawnRadius = (viewportW: number, viewportH: number): number => {
  const dim = Math.min(viewportW, viewportH);
  const r = dim * randomInRange(PHYSICS.RADIUS_RATIO_MIN, PHYSICS.RADIUS_RATIO_MAX);
  return Math.max(PHYSICS.RADIUS_MIN, Math.min(PHYSICS.RADIUS_MAX, r));
};

export const randomWanderTarget = () => ({
  vx: (Math.random() * 2 - 1) * PHYSICS.WANDER_STRENGTH,
  vy: (Math.random() * 2 - 1) * PHYSICS.WANDER_STRENGTH,
});

// Clamp a bubble's position so its edge stays inside [0, w] x [0, h].
// Returns new (x, y, vx, vy) — velocity is reflected and damped if a wall was hit.
export const resolveWallCollision = (
  x: number, y: number, vx: number, vy: number, radius: number, w: number, h: number
) => {
  let nx = x, ny = y, nvx = vx, nvy = vy;
  if (nx - radius < 0) { nx = radius; nvx = -nvx * PHYSICS.WALL_BOUNCE_DAMP; }
  if (nx + radius > w) { nx = w - radius; nvx = -nvx * PHYSICS.WALL_BOUNCE_DAMP; }
  if (ny - radius < 0) { ny = radius; nvy = -nvy * PHYSICS.WALL_BOUNCE_DAMP; }
  if (ny + radius > h) { ny = h - radius; nvy = -nvy * PHYSICS.WALL_BOUNCE_DAMP; }
  return { x: nx, y: ny, vx: nvx, vy: nvy };
};

// Resolve elastic collision between two bubbles of equal mass.
// Mutates positions to remove overlap and exchanges normal velocity components.
export const resolveBubbleCollision = (a: BubbleState, b: BubbleState): void => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const minDist = a.radius + b.radius;
  if (dist === 0 || dist >= minDist) return;

  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = minDist - dist;

  a.x -= nx * overlap * 0.5;
  a.y -= ny * overlap * 0.5;
  b.x += nx * overlap * 0.5;
  b.y += ny * overlap * 0.5;

  const an = a.vx * nx + a.vy * ny;
  const bn = b.vx * nx + b.vy * ny;

  if (an - bn <= 0) return;

  const damp = PHYSICS.COLLISION_DAMP;
  a.vx += (bn - an) * nx * damp;
  a.vy += (bn - an) * ny * damp;
  b.vx += (an - bn) * nx * damp;
  b.vy += (an - bn) * ny * damp;
};

export const clampSpeed = (vx: number, vy: number) => {
  const speed = Math.sqrt(vx * vx + vy * vy);
  if (speed <= PHYSICS.MAX_SPEED) return { vx, vy };
  const scale = PHYSICS.MAX_SPEED / speed;
  return { vx: vx * scale, vy: vy * scale };
};
