import type React from 'react';
import { useCallback, useRef, useState } from 'react';

export interface SlingshotOptions {
  /** Raw downward pull (px) required to launch on release. */
  thresholdPx: number;
  /** Visual damping of the raw pull (0–1). Lower = more elastic. Default 0.65. */
  rubberBand?: number;
  /**
   * Only start a sling when the pointerdown lands in the top fraction of the
   * element. Presses below this (the signature band) are left alone so drawing
   * still works. Default 0.58 (matches the bubble's photo-vs-band geometry).
   */
  graceTopFraction?: number;
  /** Fired on release when the pull crossed the threshold. */
  onLaunch: () => void;
  /** Fired on release when the pull did NOT cross the threshold. */
  onCancel?: () => void;
  /** When true, the gesture is inert. */
  disabled?: boolean;
}

export interface SlingshotState {
  /** Current downward visual offset (px, >= 0) to translate the bubble by. */
  offsetY: number;
  isDragging: boolean;
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
  };
}

export const useSlingshot = (opts: SlingshotOptions): SlingshotState => {
  const {
    thresholdPx,
    rubberBand = 0.65,
    graceTopFraction = 0.58,
    onLaunch,
    onCancel,
    disabled,
  } = opts;

  const [offsetY, setOffsetY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef(0);
  const rawRef = useRef(0);       // largest raw downward pull this drag
  const activeRef = useRef(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const frac = (e.clientY - rect.top) / rect.height;
      if (frac > graceTopFraction) return; // started on the signature band → drawing
      activeRef.current = true;
      startYRef.current = e.clientY;
      rawRef.current = 0;
      setIsDragging(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // setPointerCapture can throw if the pointer is already gone; ignore.
      }
    },
    [disabled, graceTopFraction]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!activeRef.current) return;
      const raw = Math.max(0, e.clientY - startYRef.current); // downward only
      rawRef.current = raw;
      setOffsetY(raw * rubberBand);
    },
    [rubberBand]
  );

  const end = useCallback(
    (launch: boolean) => {
      if (!activeRef.current) return;
      activeRef.current = false;
      const pulled = rawRef.current;
      setIsDragging(false);
      setOffsetY(0);
      if (launch && pulled >= thresholdPx) onLaunch();
      else onCancel?.();
    },
    [thresholdPx, onLaunch, onCancel]
  );

  const onPointerUp = useCallback(() => end(true), [end]);
  const onPointerCancel = useCallback(() => end(false), [end]);

  return {
    offsetY,
    isDragging,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  };
};
