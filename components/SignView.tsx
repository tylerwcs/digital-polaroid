import React, { useEffect, useRef, useState } from 'react';
import { PendingPhoto } from '../types';
import { useToast } from '../context/ToastContext';
import { BubbleFrame } from './BubbleFrame';
import { SignableBubble, SignableBubbleHandle } from './SignableBubble';
import { useSlingshot } from '../hooks/useSlingshot';
import {
  commitPending,
  discardPending,
  getPending,
  skipPending,
  subscribeToPending,
} from '../services/storageService';

// How long the bubble takes to flick up and off the screen on launch.
const FLICK_MS = 450;
// The bubble never charges past this fraction of the viewport height (the swipe line).
const MAX_PULL_FRACTION = 0.7;
// The bubble's fixed CSS top (`top: 3.5rem`); tablet safe-area insets are smaller.
const BUBBLE_TOP_PX = 56;

const SignView: React.FC = () => {
  const { showToast } = useToast();
  const signRef = useRef<SignableBubbleHandle>(null);
  const launchingIdRef = useRef<string | null>(null);
  const launchTimerRef = useRef<number | null>(null);

  const [queue, setQueue] = useState<PendingPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [launching, setLaunching] = useState(false);

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Bubble sizing + the pull cap, computed together from the viewport. The bubble
  // is top-anchored at a fixed CSS top (below), so its resting bottom edge is a
  // known BUBBLE_TOP_PX + diameter — no DOM measurement needed. maxTravel is the
  // room left before the bubble's bottom reaches the 70% line (the swipe zone).
  const [diameter, setDiameter] = useState(380);
  const [maxTravel, setMaxTravel] = useState(120);
  useEffect(() => {
    const compute = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const d = Math.round(Math.max(240, Math.min(w * 0.68, h * 0.5)) * 1.2);
      setDiameter(d);
      // Reserve for the charge grow (scale 1.08 pushes the bottom down by ~d*0.04)
      // so the fully-charged bubble still stops at the 70% line.
      setMaxTravel(Math.max(12, h * MAX_PULL_FRACTION - (BUBBLE_TOP_PX + d) - d * 0.04));
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  useEffect(() => {
    let active = true;

    getPending().then((fetched) => {
      if (!active) return;
      // Merge rather than overwrite: a pending_added event can land while this
      // fetch is still in flight, and the response reflects server state from
      // before that photo existed. Keep the fetched (oldest-first) order, then
      // append anything the socket added that the fetch didn't know about.
      setQueue((prev) => {
        const fetchedIds = new Set(fetched.map((p) => p.id));
        return [...fetched, ...prev.filter((p) => !fetchedIds.has(p.id))];
      });
    });

    const unsubscribe = subscribeToPending({
      onAdded: (photo) =>
        setQueue((prev) => (prev.some((p) => p.id === photo.id) ? prev : [...prev, photo])),
      onRemoved: (id) =>
        setQueue((prev) =>
          id === launchingIdRef.current ? prev : prev.filter((p) => p.id !== id)
        ),
      onReordered: (items) => setQueue(items),
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(
    () => () => {
      if (launchTimerRef.current) clearTimeout(launchTimerRef.current);
    },
    []
  );

  const current = queue[0];
  const waiting = Math.max(queue.length - 1, 0);

  const removeFromQueue = (id: string) => setQueue((prev) => prev.filter((p) => p.id !== id));

  // The server says this photo is no longer in the queue (404). It may never send
  // a socket event for it — if the removal was broadcast before we loaded, there's
  // nothing left to broadcast. Drop it locally so a phantom head can't wedge the
  // station forever. Only for `gone`; a network failure stays retryable.
  const handleGone = (id: string) => {
    removeFromQueue(id);
    showToast('That photo was already handled.', 'info');
  };

  // Launch = the slingshot release past threshold. Fire the flick animation and
  // the commit concurrently; advance the queue only after the flick finishes so
  // the current bubble isn't swapped out mid-flight. A network failure snaps the
  // bubble back and stays retryable; `gone` advances past a phantom.
  const handleLaunch = async () => {
    if (!current || busy) return;
    const id = current.id;
    const signature = signRef.current?.getSignature(); // undefined is allowed
    setBusy(true);
    setLaunching(true);
    // Keep this photo on-screen through the flick: ignore the socket's
    // pending_removed for it (fired on commit) so the fly-up can play; the
    // local timer below is the authoritative removal.
    launchingIdRef.current = id;

    const result = await commitPending(id, signature);
    const settleMs = reducedMotion ? 0 : FLICK_MS;

    const finish = (extra: () => void) => {
      launchTimerRef.current = window.setTimeout(() => {
        extra();
        launchingIdRef.current = null;
        setLaunching(false);
        setBusy(false);
      }, settleMs);
    };

    if (result.success) {
      finish(() => {
        removeFromQueue(id);
        showToast('Sent to the wall ✨', 'success');
      });
    } else if (result.gone) {
      finish(() => handleGone(id));
    } else {
      launchingIdRef.current = null;
      setLaunching(false);
      setBusy(false);
      showToast(result.error || 'Could not upload. Check the connection.', 'error');
    }
  };

  const handleDiscard = async () => {
    if (!current || busy) return;
    setBusy(true);

    const result = await discardPending(current.id);
    if (result.success) {
      removeFromQueue(current.id);
      showToast('Photo discarded.', 'info');
    } else if (result.gone) {
      handleGone(current.id);
    } else {
      showToast(result.error || 'Could not discard. Check the connection.', 'error');
    }
    setBusy(false);
  };

  const handleSkip = async () => {
    if (!current || busy || waiting === 0) return;
    setBusy(true);

    const result = await skipPending(current.id);
    if (result.gone) {
      handleGone(current.id);
    } else if (!result.success) {
      showToast(result.error || 'Could not skip. Check the connection.', 'error');
    }
    // On success the server broadcasts pending_reordered, which updates the queue.
    setBusy(false);
  };

  // The swipe zone (not the bubble) is the drag trigger, so the whole zone is
  // grabbable (graceTopFraction: 1) and we read the raw finger pull unmodified
  // (rubberBand: 1) to drive the charge curve ourselves.
  const sling = useSlingshot({
    thresholdPx: diameter * 0.22,
    rubberBand: 1,
    graceTopFraction: 1,
    disabled: busy || launching,
    onLaunch: handleLaunch,
  });

  const pull = sling.offsetY; // raw downward pull in px (rubberBand: 1)
  const charge = Math.min(1, pull / (diameter * 0.22)); // 0..1 toward launch
  // Diminishing-returns resistance: heavy drag that asymptotes to maxTravel, so
  // the bubble lags the finger and never crosses the 70% line.
  const followY = reducedMotion ? 0 : maxTravel * (1 - Math.exp(-pull / (maxTravel * 1.25)));
  const followScale = reducedMotion ? 1 : 1 + charge * 0.08; // subtle uniform grow (faces never distort)
  const shakeAmp = charge * 2.4; // px

  const followInner =
    launching && !reducedMotion
      ? 'translateY(-120vh) scale(1.12)'
      : `translateY(${followY}px) scale(${followScale})`;
  // The bubble is absolutely positioned and centered via translateX(-50%), so it
  // holds a fixed spot whether or not the "N waiting" badge is showing.
  const followTransform = `translateX(-50%) ${followInner}`;
  const followTransition = launching
    ? `transform ${FLICK_MS}ms ease-out, opacity ${FLICK_MS}ms ease-out`
    : sling.isDragging
    ? 'none'
    : 'transform 340ms cubic-bezier(0.34, 1.5, 0.5, 1)'; // spring back to rest

  const shakeStyle: React.CSSProperties | undefined =
    sling.isDragging && !reducedMotion && pull > 2
      ? ({ animation: 'sw-shake 90ms linear infinite', '--amp': shakeAmp.toFixed(2) } as React.CSSProperties)
      : undefined;

  const swipeOpacity = launching ? 0 : Math.max(0, 1 - pull / 45); // fades away the moment you pull

  const iconBtn =
    'w-14 h-14 rounded-full border flex items-center justify-center transition-colors ' +
    'active:scale-95 disabled:opacity-30 disabled:pointer-events-none';

  return (
    <div className="min-h-[100dvh] w-screen bg-black text-white flex flex-col items-center px-4 overflow-hidden relative">
      <style>{`
        @keyframes sw-wave { 0%,100%{opacity:.25;transform:translateY(-3px);} 50%{opacity:1;transform:translateY(3px);} }
        @keyframes sw-shake {
          0%,100%{transform:translate(0,0);}
          25%{transform:translate(calc(var(--amp)*1px),calc(var(--amp)*-1px));}
          50%{transform:translate(calc(var(--amp)*-1px),calc(var(--amp)*1px));}
          75%{transform:translate(calc(var(--amp)*-1px),calc(var(--amp)*-1px));}
        }
      `}</style>

      {/* Themed background video (same asset as the wall) */}
      <video
        className="absolute inset-0 w-full h-full object-cover opacity-60 pointer-events-none"
        src="/bubbleBG.mp4"
        autoPlay
        muted
        loop
        playsInline
        aria-hidden
      />

      {current ? (
        <>
          {waiting > 0 && (
            <div className="absolute left-1/2 -translate-x-1/2 top-[max(1rem,env(safe-area-inset-top))] z-10 px-4 py-1.5 rounded-full bg-white/10 border border-white/20 text-sm text-white/80">
              {waiting} waiting
            </div>
          )}

          {/* Bubble — fixed upper position (stable whether or not the badge shows),
              follows the finger on pull, charges (grows + shakes), flicks up on launch. */}
          <div
            className="absolute left-1/2 z-10"
            style={{
              top: 'max(3.5rem, env(safe-area-inset-top))',
              transform: followTransform,
              opacity: launching && !reducedMotion ? 0 : 1,
              transition: followTransition,
              willChange: 'transform',
            }}
          >
            <div style={shakeStyle}>
              <SignableBubble
                key={current.id}
                ref={signRef}
                diameter={diameter}
                imageDataUrl={current.imageUrl}
              />
            </div>
          </div>

          {/* Swipe / pull trigger zone, anchored at 70% of the viewport (fades as you pull). */}
          <div
            {...sling.handlers}
            className="absolute left-0 right-0 z-10 flex flex-col items-center gap-2 select-none"
            style={{
              top: '70%',
              touchAction: 'none',
              cursor: 'grab',
              opacity: swipeOpacity,
              transition: sling.isDragging ? 'none' : 'opacity 0.2s ease',
            }}
          >
            <span className="font-extrabold tracking-[0.22em] text-sm text-white/90">SWIPE</span>
            <div className="flex flex-col items-center gap-1" aria-hidden>
              {[0, 1, 2].map((i) => (
                <svg
                  key={i}
                  width="34"
                  height="20"
                  viewBox="0 0 34 20"
                  style={{
                    opacity: 0.5,
                    animation: sling.isDragging ? undefined : `sw-wave 1.4s ease-in-out ${i * 0.18}s infinite`,
                  }}
                >
                  <path
                    d="M3 3 L17 15 L31 3"
                    fill="none"
                    stroke="white"
                    strokeWidth={5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <BubbleFrame diameter={diameter}>
            <div className="w-full h-full flex flex-col items-center justify-center text-center gap-2 px-6 text-white">
              <span className="text-2xl font-semibold">All caught up</span>
              <span className="text-white/70 text-sm">Waiting for the next photo…</span>
            </div>
          </BubbleFrame>
        </div>
      )}

      {/* Bottom-left icon controls */}
      {current && (
        <div className="absolute left-4 bottom-4 z-20 flex flex-col gap-3">
          <button
            type="button"
            onClick={() => signRef.current?.clear()}
            disabled={busy}
            aria-label="Clear signature"
            title="Clear signature"
            className={`${iconBtn} border-white/20 bg-white/10 text-white/85 hover:bg-white/20`}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
              <line x1="18" y1="9" x2="12" y2="15" />
              <line x1="12" y1="9" x2="18" y2="15" />
            </svg>
          </button>
          <button
            type="button"
            onClick={handleSkip}
            disabled={busy || waiting === 0}
            aria-label="Skip to next photo"
            title="Skip"
            className={`${iconBtn} border-white/20 bg-white/10 text-white/85 hover:bg-white/20`}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth={1} strokeLinejoin="round" aria-hidden>
              <path d="M5 4l10 8-10 8z" />
              <rect x="17.5" y="4" width="2.5" height="16" rx="1" stroke="none" />
            </svg>
          </button>
          <button
            type="button"
            onClick={handleDiscard}
            disabled={busy}
            aria-label="Discard photo"
            title="Discard"
            className={`${iconBtn} border-rose-400/30 bg-rose-500/10 text-rose-300/90 hover:bg-rose-500/20`}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
};

export default SignView;
