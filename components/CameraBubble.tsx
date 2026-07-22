import React, { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { BubbleFrame } from './BubbleFrame';

export interface CameraBubbleHandle {
  capture: () => string | null;     // returns base64 JPEG data URL, or null if not ready
  flip: () => void;
}

interface CameraBubbleProps {
  diameter: number;
  onError: (message: string) => void;
}

const CAPTURE_SIZE = 600;           // output square size in px (matches wall image sizing)
const JPEG_QUALITY = 0.65;
const MIN_ZOOM = 1;                 // 1x = the lens's full field of view
const MAX_ZOOM = 3;                 // 3x digital zoom — frame a person from a comfortable distance

export const CameraBubble = forwardRef<CameraBubbleHandle, CameraBubbleProps>(
  ({ diameter, onError }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
    const [restartKey, setRestartKey] = useState(0);   // bump to force a stream restart
    const [zoom, setZoom] = useState(MIN_ZOOM);         // digital zoom factor
    const zoomRef = useRef(zoom);
    useEffect(() => { zoomRef.current = zoom; }, [zoom]);
    const onErrorRef = useRef(onError);
    useEffect(() => { onErrorRef.current = onError; });

    const stopStream = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };

    // (Re)start the stream whenever facingMode changes or a restart is requested.
    useEffect(() => {
      let cancelled = false;

      const start = async () => {
        stopStream();
        if (!navigator.mediaDevices?.getUserMedia) {
          onErrorRef.current('Camera not available on this device/browser.');
          return;
        }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            // `ideal` (not exact) so it never rejects — a higher-res feed keeps
            // digital-zoomed captures crisp; devices clamp to what they support.
            video: { facingMode, width: { ideal: 1280 }, height: { ideal: 1280 } },
            audio: false,
          });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play().catch(() => { /* autoplay quirks; user gesture will resume */ });
          }
        } catch (e) {
          const err = e as DOMException;
          if (err?.name === 'NotAllowedError') onErrorRef.current('Camera permission denied.');
          else if (err?.name === 'NotFoundError') onErrorRef.current('No camera found on this device.');
          else onErrorRef.current('Could not start the camera. A secure (HTTPS/localhost) context is required.');
        }
      };

      start();
      return () => { cancelled = true; stopStream(); };
    }, [facingMode, restartKey]);

    // Stop the camera when the tab is hidden; restart when visible again.
    useEffect(() => {
      const onVis = () => {
        if (document.hidden) stopStream();
        else setRestartKey((k) => k + 1); // bump key → camera effect re-runs and restarts the stream
      };
      document.addEventListener('visibilitychange', onVis);
      return () => document.removeEventListener('visibilitychange', onVis);
    }, []);

    useImperativeHandle(ref, () => ({
      capture: () => {
        const video = videoRef.current;
        if (!video || !video.videoWidth) return null;

        const canvas = document.createElement('canvas');
        canvas.width = CAPTURE_SIZE;
        canvas.height = CAPTURE_SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        // Center-crop the video to a square, tightened by the zoom factor so the
        // saved photo matches the zoomed preview exactly.
        const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomRef.current));
        const side = Math.min(video.videoWidth, video.videoHeight) / z;
        const sx = (video.videoWidth - side) / 2;
        const sy = (video.videoHeight - side) / 2;

        // Mirror horizontally for the front camera so the saved photo matches the preview.
        if (facingMode === 'user') {
          ctx.translate(CAPTURE_SIZE, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(video, sx, sy, side, side, 0, 0, CAPTURE_SIZE, CAPTURE_SIZE);

        return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
      },
      flip: () => setFacingMode((m) => (m === 'environment' ? 'user' : 'environment')),
    }), [facingMode]);

    // Preview zoom + front-camera mirror, both via the same transform.
    const scaleX = (facingMode === 'user' ? -1 : 1) * zoom;
    const videoTransform = `scale(${scaleX}, ${zoom})`;

    return (
      <div className="flex flex-col items-center gap-4">
        <BubbleFrame diameter={diameter}>
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            muted
            autoPlay
            playsInline
            style={{ transform: videoTransform }}
          />
        </BubbleFrame>

        {/* Zoom slider */}
        <div className="flex items-center gap-3" style={{ width: Math.min(diameter, 320) }}>
          <span className="text-white/70 text-lg leading-none" aria-hidden>−</span>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.1}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label="Camera zoom"
            className="flex-1 accent-white cursor-pointer"
          />
          <span className="text-white/70 text-lg leading-none" aria-hidden>+</span>
          <span className="text-white/70 text-sm tabular-nums w-10 text-right">{zoom.toFixed(1)}×</span>
        </div>
      </div>
    );
  }
);

CameraBubble.displayName = 'CameraBubble';
