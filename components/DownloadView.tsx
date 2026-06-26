import React, { useEffect, useState } from 'react';
import { getPhotos } from '../services/storageService';
import { PhotoEntry } from '../types';
import { useToast } from '../context/ToastContext';
import { BubbleCarousel } from './BubbleCarousel';
import { composeBubbleImage } from '../lib/composeBubbleImage';
import { requestBubbleVideo, downloadBlob } from '../services/exportService';

const DownloadView: React.FC = () => {
  const { showToast } = useToast();
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Responsive bubble size (portrait-first).
  const [diameter, setDiameter] = useState(300);
  useEffect(() => {
    const compute = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setDiameter(Math.round(Math.max(200, Math.min(w * 0.8, h * 0.5))));
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getPhotos().then((loaded) => {
      if (!cancelled) {
        setPhotos(loaded);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const handleDownload = async (photo: PhotoEntry) => {
    setBusyId(photo.id);
    try {
      const bubblePng = await composeBubbleImage(photo, 1000);
      const blob = await requestBubbleVideo(bubblePng, photo.id);
      downloadBlob(blob, `bubble-${photo.id}.mp4`);
      showToast('Saved! Check your downloads.', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not create the video.';
      showToast(msg, 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-[100dvh] w-screen bg-black text-white relative overflow-hidden flex flex-col items-center justify-center py-[max(1rem,env(safe-area-inset-top))]">
      {/* Export background, shared behind the carousel */}
      <video
        className="absolute inset-0 w-full h-full object-cover opacity-50 pointer-events-none"
        src="/exportBG.mp4"
        autoPlay
        muted
        loop
        playsInline
        aria-hidden
      />

      <div className="relative z-10 w-full flex flex-col items-center gap-6">
        <h1 className="text-xl font-semibold drop-shadow">Find your bubble</h1>

        {loading ? (
          <p className="text-white/70">Loading bubbles…</p>
        ) : photos.length === 0 ? (
          <p className="text-white/70 text-center px-8">No bubbles yet — check back soon!</p>
        ) : (
          <>
            {/* Only the bubbles swipe; the Download button is a single shared instance below. */}
            <BubbleCarousel
              photos={photos}
              diameter={diameter}
              onActiveIndexChange={setActiveIndex}
            />
            <button
              onClick={() => handleDownload(photos[activeIndex])}
              disabled={busyId !== null}
              className="px-8 py-3 rounded-full bg-white text-black font-semibold active:scale-95 transition-transform disabled:opacity-60"
            >
              {busyId !== null ? 'Creating your video…' : 'Download'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default DownloadView;
