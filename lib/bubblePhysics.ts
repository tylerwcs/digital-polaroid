export const PHYSICS = {
  WIND_FORCE: 0.02,        // Max random force per axis per frame
  DAMPING: 0.985,          // Velocity damping per frame
  MAX_SPEED: 0.6,          // Max velocity magnitude (px/frame)
  WALL_BOUNCE_DAMP: 0.5,   // Velocity scale on wall collision
  COLLISION_DAMP: 0.7,     // Velocity scale on bubble-bubble collision
  RADIUS_MIN: 90,
  RADIUS_MAX: 200,
  RADIUS_RATIO_MIN: 0.09,  // Min radius as fraction of min(viewportW, viewportH)
  RADIUS_RATIO_MAX: 0.13,
  MAX_BUBBLES: 8,
} as const;

export interface BubbleState {
  id: string;
  photoId: string;        // PhotoEntry.id, used to look up image/signature
  x: number;              // center x in container coordinates
  y: number;              // center y
  vx: number;             // velocity x (px/frame)
  vy: number;             // velocity y
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

  const nx = dx / dist;  // collision normal
  const ny = dy / dist;
  const overlap = minDist - dist;

  // Positional correction (each moves half the overlap)
  a.x -= nx * overlap * 0.5;
  a.y -= ny * overlap * 0.5;
  b.x += nx * overlap * 0.5;
  b.y += ny * overlap * 0.5;

  // Normal velocity components
  const an = a.vx * nx + a.vy * ny;
  const bn = b.vx * nx + b.vy * ny;

  // Only resolve if moving toward each other
  if (an - bn <= 0) return;

  const damp = PHYSICS.COLLISION_DAMP;
  // Swap normal components, damped
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
