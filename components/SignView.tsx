import React, { useEffect, useRef, useState } from 'react';
import { PendingPhoto } from '../types';
import { useToast } from '../context/ToastContext';
import { BubbleFrame } from './BubbleFrame';
import { SignableBubble, SignableBubbleHandle } from './SignableBubble';
import {
  commitPending,
  discardPending,
  getPending,
  skipPending,
  subscribeToPending,
} from '../services/storageService';

const SignView: React.FC = () => {
  const { showToast } = useToast();
  const signRef = useRef<SignableBubbleHandle>(null);

  const [queue, setQueue] = useState<PendingPhoto[]>([]);
  const [busy, setBusy] = useState(false);

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

  const handleUpload = async () => {
    if (!current || busy) return;
    setBusy(true);

    const signature = signRef.current?.getSignature(); // undefined is allowed
    const result = await commitPending(current.id, signature);

    if (result.success) {
      removeFromQueue(current.id);
      showToast('Sent to the wall ✨', 'success');
    } else {
      showToast(result.error || 'Could not upload. Check the connection.', 'error');
    }
    setBusy(false);
  };

  const handleDiscard = async () => {
    if (!current || busy) return;
    setBusy(true);

    const result = await discardPending(current.id);
    if (result.success) {
      removeFromQueue(current.id);
      showToast('Photo discarded.', 'info');
    } else {
      showToast(result.error || 'Could not discard. Check the connection.', 'error');
    }
    setBusy(false);
  };

  const handleSkip = async () => {
    if (!current || busy || waiting === 0) return;
    setBusy(true);

    const result = await skipPending(current.id);
    if (!result.success) {
      showToast(result.error || 'Could not skip. Check the connection.', 'error');
    }
    // On success the server broadcasts pending_reordered, which updates the queue.
    setBusy(false);
  };

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
            <SignableBubble
              key={current.id}
              ref={signRef}
              diameter={diameter}
              imageDataUrl={current.imageUrl}
            />

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
              <button
                onClick={handleUpload}
                disabled={busy}
                className="px-8 py-3 rounded-full bg-white text-black font-semibold active:scale-95 transition-transform disabled:opacity-60"
              >
                {busy ? 'Working…' : 'Upload to Wall'}
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
