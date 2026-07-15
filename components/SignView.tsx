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

const SignView: React.FC = () => {
  const { showToast } = useToast();
  const signRef = useRef<SignableBubbleHandle>(null);

  const [queue, setQueue] = useState<PendingPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [launching, setLaunching] = useState(false);

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Sized for a tablet in either orientation.
  const [diameter, setDiameter] = useState(420);
  useEffect(() => {
    const compute = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setDiameter(Math.round(Math.max(280, Math.min(w * 0.7, h * 0.6))));
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
      onRemoved: (id) => setQueue((prev) => prev.filter((p) => p.id !== id)),
      onReordered: (items) => setQueue(items),
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

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

    const result = await commitPending(id, signature);
    const settleMs = reducedMotion ? 0 : FLICK_MS;

    if (result.success) {
      window.setTimeout(() => {
        removeFromQueue(id);
        showToast('Sent to the wall ✨', 'success');
        setLaunching(false);
        setBusy(false);
      }, settleMs);
    } else if (result.gone) {
      window.setTimeout(() => {
        handleGone(id);
        setLaunching(false);
        setBusy(false);
      }, settleMs);
    } else {
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

  const sling = useSlingshot({
    thresholdPx: diameter * 0.22,
    graceTopFraction: 0.58, // top ~58% of the bubble is the photo; below is the signing band
    disabled: busy || launching,
    onLaunch: handleLaunch,
  });

  const bubbleTransform =
    launching && !reducedMotion
      ? 'translateY(-120vh)'
      : `translateY(${sling.offsetY}px)`;
  const bubbleTransition = launching
    ? `transform ${FLICK_MS}ms ease-out, opacity ${FLICK_MS}ms ease-out`
    : sling.isDragging
    ? 'none'
    : 'transform 300ms cubic-bezier(0.34, 1.4, 0.5, 1)'; // snap-back spring

  return (
    <div className="min-h-[100dvh] w-screen bg-black text-white flex flex-col items-center justify-center gap-8 px-4 py-[max(1rem,env(safe-area-inset-top))] overflow-hidden relative">
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

      <div className="relative z-10 flex flex-col items-center gap-8 w-full">
        {waiting > 0 && (
          <div className="px-4 py-1.5 rounded-full bg-white/10 border border-white/20 text-sm text-white/80">
            {waiting} waiting
          </div>
        )}

        {current ? (
          <>
            {/* Sling-draggable bubble with a stretchy tether behind it. */}
            <div className="relative" style={{ width: diameter, height: diameter }}>
              {sling.isDragging && sling.offsetY > 4 && !reducedMotion && (
                <svg
                  className="absolute inset-0 pointer-events-none overflow-visible"
                  width={diameter}
                  height={diameter}
                  aria-hidden
                >
                  <line
                    x1={diameter * 0.2}
                    y1={0}
                    x2={diameter * 0.5}
                    y2={sling.offsetY}
                    stroke="rgba(255,255,255,0.45)"
                    strokeWidth={3}
                    strokeLinecap="round"
                  />
                  <line
                    x1={diameter * 0.8}
                    y1={0}
                    x2={diameter * 0.5}
                    y2={sling.offsetY}
                    stroke="rgba(255,255,255,0.45)"
                    strokeWidth={3}
                    strokeLinecap="round"
                  />
                </svg>
              )}
              <div
                {...sling.handlers}
                style={{
                  touchAction: 'none',
                  transform: bubbleTransform,
                  opacity: launching && !reducedMotion ? 0 : 1,
                  transition: bubbleTransition,
                  cursor: 'grab',
                }}
              >
                <SignableBubble
                  key={current.id}
                  ref={signRef}
                  diameter={diameter}
                  imageDataUrl={current.imageUrl}
                />
              </div>
            </div>

            {/* Discoverability hint for the gesture (hidden while dragging/launching). */}
            {!sling.isDragging && !launching && (
              <div className="flex flex-col items-center gap-1 text-white/80">
                <span className="text-2xl animate-bounce" aria-hidden>
                  ⤓
                </span>
                <span className="text-sm">Pull down to send ✨</span>
              </div>
            )}

            <div className="flex items-center gap-3 flex-wrap justify-center">
              <button
                onClick={() => signRef.current?.clear()}
                disabled={busy}
                className="px-6 py-3 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
              >
                Clear
              </button>
              <button
                onClick={handleSkip}
                disabled={busy || waiting === 0}
                className="px-6 py-3 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40"
              >
                Skip
              </button>
              <button
                onClick={handleDiscard}
                disabled={busy}
                className="px-6 py-3 rounded-full text-rose-300/90 hover:text-rose-200 hover:bg-rose-500/10 transition-colors disabled:opacity-40"
              >
                Discard
              </button>
            </div>
          </>
        ) : (
          <BubbleFrame diameter={diameter}>
            <div className="w-full h-full flex flex-col items-center justify-center text-center gap-2 px-6 text-white">
              <span className="text-2xl font-semibold">All caught up</span>
              <span className="text-white/70 text-sm">Waiting for the next photo…</span>
            </div>
          </BubbleFrame>
        )}
      </div>
    </div>
  );
};

export default SignView;
