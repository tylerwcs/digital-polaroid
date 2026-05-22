import { useCallback, useEffect, useRef, useState, RefObject } from 'react';
import { BubbleState, PHYSICS } from '../lib/bubblePhysics';

export interface UseBubblePhysicsResult {
  bubbles: BubbleState[];
  containerRef: RefObject<HTMLDivElement>;
  registerBubbleEl: (id: string, el: HTMLDivElement | null) => void;
  spawn: (params: { photoId: string; x: number; y: number; radius: number; vx?: number; vy?: number }) => string;
  remove: (id: string) => void;
  markExiting: (id: string) => void;
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
    const bubble: BubbleState = {
      id,
      photoId: params.photoId,
      x: params.x,
      y: params.y,
      vx: params.vx ?? 0,
      vy: params.vy ?? 0,
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

  return {
    bubbles: bubblesRef.current,
    containerRef,
    registerBubbleEl,
    spawn,
    remove,
    markExiting,
    getBubble,
  };
};
