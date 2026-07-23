import { useCallback, useEffect, useRef, useState, RefObject } from 'react';
import { BubbleState, PHYSICS, clampSpeed, resolveWallCollision, resolveBubbleCollision, randomWanderTarget } from '../lib/bubblePhysics';

export interface UseBubblePhysicsResult {
  bubbles: BubbleState[];
  containerRef: RefObject<HTMLDivElement>;
  registerBubbleEl: (id: string, el: HTMLDivElement | null) => void;
  spawn: (params: { photoId: string; x: number; y: number; radius: number; vx?: number; vy?: number }) => string;
  remove: (id: string) => void;
  markExiting: (id: string) => void;
  resizeAll: (radius: number) => void;
  getBubble: (id: string) => BubbleState | undefined;
}

export const useBubblePhysics = (): UseBubblePhysicsResult => {
  const containerRef = useRef<HTMLDivElement>(null);
  const bubblesRef = useRef<BubbleState[]>([]);
  const elementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const [renderTrigger, setRenderTrigger] = useState(0);

  // Force a re-render so React renders/unrenders bubble nodes when the set changes.
  const bump = useCallback(() => setRenderTrigger((n) => n + 1), []);

  const registerBubbleEl = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) elementsRef.current.set(id, el);
    else elementsRef.current.delete(id);
  }, []);

  const spawn = useCallback((params: {
    photoId: string; x: number; y: number; radius: number; vx?: number; vy?: number;
  }): string => {
    const id = `b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const wander = randomWanderTarget();
    const bubble: BubbleState = {
      id,
      photoId: params.photoId,
      x: params.x,
      y: params.y,
      vx: params.vx ?? 0,
      vy: params.vy ?? 0,
      targetVx: wander.vx,
      targetVy: wander.vy,
      lastWanderTs: Date.now(),
      radius: params.radius,
      spawnTime: Date.now(),
      lifecycle: 'live',
    };
    bubblesRef.current = [...bubblesRef.current, bubble];
    bump();
    return id;
  }, [bump]);

  const remove = useCallback((id: string) => {
    bubblesRef.current = bubblesRef.current.filter((b) => b.id !== id);
    bump();
  }, [bump]);

  const markExiting = useCallback((id: string) => {
    bubblesRef.current = bubblesRef.current.map((b) =>
      b.id === id ? { ...b, lifecycle: 'exiting' as const } : b
    );
    bump();
  }, [bump]);

  // Resize every non-exiting bubble to a shared radius. Used by the grid wall to
  // keep the display "filled" — bubbles shrink as more arrive, grow as they leave.
  // The physics loop reads radius each frame for both positioning and collisions,
  // so any resulting overlap is resolved (with a bounce) over the next few frames.
  const resizeAll = useCallback((radius: number) => {
    bubblesRef.current = bubblesRef.current.map((b) =>
      b.lifecycle === 'exiting' ? b : { ...b, radius }
    );
    bump();
  }, [bump]);

  const getBubble = useCallback(
    (id: string) => bubblesRef.current.find((b) => b.id === id),
    []
  );

  // Keep elementsRef cleaned up
  useEffect(() => {
    const validIds = new Set(bubblesRef.current.map((b) => b.id));
    for (const id of Array.from(elementsRef.current.keys())) {
      if (!validIds.has(id)) elementsRef.current.delete(id);
    }
  }, [renderTrigger]);

  // Physics loop
  useEffect(() => {
    let rafId: number;
    const reducedMotion = typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const tick = () => {
      const container = containerRef.current;
      if (!container) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      const w = container.clientWidth;
      const h = container.clientHeight;

      const live = bubblesRef.current.filter((b) => b.lifecycle === 'live');

      const now = Date.now();
      // Per-bubble update (skip motion entirely if reduced motion)
      for (const b of live) {
        if (!reducedMotion) {
          // Re-randomize wander target periodically (per-bubble, staggered)
          if (now - b.lastWanderTs > PHYSICS.WANDER_INTERVAL_MS) {
            const w = randomWanderTarget();
            b.targetVx = w.vx;
            b.targetVy = w.vy;
            b.lastWanderTs = now;
          }
          // Ease velocity toward wander target (smooth drift, no jitter)
          b.vx += (b.targetVx - b.vx) * PHYSICS.WANDER_EASING;
          b.vy += (b.targetVy - b.vy) * PHYSICS.WANDER_EASING;
          // Damping (mostly for post-collision settle)
          b.vx *= PHYSICS.DAMPING;
          b.vy *= PHYSICS.DAMPING;
          // Speed clamp
          const c = clampSpeed(b.vx, b.vy);
          b.vx = c.vx; b.vy = c.vy;
          // Integrate
          b.x += b.vx;
          b.y += b.vy;
        }
        // Wall collision (always run, in case of resize)
        const wc = resolveWallCollision(b.x, b.y, b.vx, b.vy, b.radius, w, h);
        b.x = wc.x; b.y = wc.y; b.vx = wc.vx; b.vy = wc.vy;
      }

      // Pairwise bubble-bubble collision (only between live bubbles)
      if (!reducedMotion) {
        for (let i = 0; i < live.length; i++) {
          for (let j = i + 1; j < live.length; j++) {
            resolveBubbleCollision(live[i], live[j]);
          }
        }
      }

      // Apply positions to DOM (bypass React)
      for (const b of live) {
        const el = elementsRef.current.get(b.id);
        if (el) {
          el.style.transform = `translate3d(${b.x - b.radius}px, ${b.y - b.radius}px, 0)`;
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Window resize: clamp bubbles back into new bounds
  useEffect(() => {
    const onResize = () => {
      const container = containerRef.current;
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      for (const b of bubblesRef.current) {
        if (b.lifecycle !== 'live') continue;
        const wc = resolveWallCollision(b.x, b.y, b.vx, b.vy, b.radius, w, h);
        b.x = wc.x; b.y = wc.y; b.vx = wc.vx; b.vy = wc.vy;
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return {
    bubbles: bubblesRef.current,
    containerRef,
    registerBubbleEl,
    spawn,
    remove,
    markExiting,
    resizeAll,
    getBubble,
  };
};
