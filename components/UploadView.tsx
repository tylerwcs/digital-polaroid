import React, { useEffect, useRef, useState } from 'react';
import { compressImage, savePending } from '../services/storageService';
import { useToast } from '../context/ToastContext';
import { BubbleFrame } from './BubbleFrame';
import { CameraBubble, CameraBubbleHandle } from './CameraBubble';

type Stage = 'camera' | 'review' | 'sending' | 'sent';

const SENT_RESET_MS = 1800;

const UploadView: React.FC = () => {
  const { showToast } = useToast();
  const cameraRef = useRef<CameraBubbleHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>('camera');
  const [captured, setCaptured] = useState<string | null>(null);
  const [cameraFailed, setCameraFailed] = useState(false);

  // Responsive bubble size: fits a portrait phone without overflowing,
  // leaving room for the controls below.
  const [diameter, setDiameter] = useState(320);
  useEffect(() => {
    const compute = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setDiameter(Math.round(Math.max(220, Math.min(w * 0.85, h * 0.55))));
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  // After a successful send, drop back to the camera for the next guest.
  useEffect(() => {
    if (stage !== 'sent') return;
    const timer = setTimeout(() => {
      setCaptured(null);
      setCameraFailed(false);
      setStage('camera');
    }, SENT_RESET_MS);
    return () => clearTimeout(timer);
  }, [stage]);

  const handleCameraError = (message: string) => {
    setCameraFailed(true);
    showToast(message + ' Tap to use your camera instead.', 'error');
  };

  const handleShutter = () => {
    const dataUrl = cameraRef.current?.capture();
    if (!dataUrl) {
      showToast('Camera not ready yet — try again.', 'error');
      return;
    }
    setCaptured(dataUrl);
    setStage('review');
  };

  // Native-capture fallback (insecure context / permission denied / no getUserMedia).
  const handleFallbackFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const dataUrl = await compressImage(file);
        setCaptured(dataUrl);
        setStage('review');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not process the photo.';
        showToast(msg, 'error');
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRetake = () => {
    setCaptured(null);
    setStage('camera');
  };

  const handleSend = async () => {
    if (!captured) return;
    setStage('sending');

    const result = await savePending({
      id: Date.now().toString(),
      image: captured,
      rotation: Math.random() * 6 - 3,
      timestamp: Date.now(),
    });

    if (result.success) {
      setStage('sent');
    } else {
      showToast(result.error || 'Could not send. Check the connection.', 'error');
      setStage('review');
    }
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
        {/* Bubble area */}
        {stage === 'camera' && !cameraFailed && (
          <CameraBubble ref={cameraRef} diameter={diameter} onError={handleCameraError} />
        )}

        {stage === 'camera' && cameraFailed && (
          <BubbleFrame diameter={diameter}>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full h-full flex items-center justify-center text-center px-6 text-white"
            >
              Tap to open your camera
            </button>
          </BubbleFrame>
        )}

        {(stage === 'review' || stage === 'sending') && captured && (
          <BubbleFrame diameter={diameter}>
            <img src={captured} alt="" className="w-full h-full object-cover" draggable={false} />
          </BubbleFrame>
        )}

        {stage === 'sent' && (
          <BubbleFrame diameter={diameter}>
            <div className="w-full h-full flex flex-col items-center justify-center text-center gap-2 px-6 text-white">
              <span className="text-2xl font-semibold">Sent to iPad!</span>
              <span className="text-white/70 text-sm">Head over to sign it ✨</span>
            </div>
          </BubbleFrame>
        )}

        {/* Controls */}
        {stage === 'camera' && !cameraFailed && (
          <div className="flex items-center gap-6">
            <button
              onClick={() => cameraRef.current?.flip()}
              className="w-14 h-14 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-2xl active:scale-95 transition-transform"
              aria-label="Flip camera"
            >
              ⟲
            </button>
            <button
              onClick={handleShutter}
              className="w-20 h-20 rounded-full bg-white border-4 border-white/50 active:scale-95 transition-transform"
              aria-label="Take photo"
            />
            <div className="w-14 h-14" /> {/* spacer to keep shutter centered */}
          </div>
        )}

        {stage === 'review' && (
          <div className="flex items-center gap-4">
            <button
              onClick={handleRetake}
              className="px-6 py-3 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            >
              Retake
            </button>
            <button
              onClick={handleSend}
              className="px-8 py-3 rounded-full bg-white text-black font-semibold active:scale-95 transition-transform"
            >
              Send to iPad
            </button>
          </div>
        )}

        {stage === 'sending' && (
          <div className="px-8 py-3 text-white/80">Sending…</div>
        )}
      </div>

      {/* Hidden native-capture fallback input */}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        ref={fileInputRef}
        onChange={handleFallbackFile}
        className="hidden"
      />
    </div>
  );
};

export default UploadView;
