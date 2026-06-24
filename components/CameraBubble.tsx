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

export const CameraBubble = forwardRef<CameraBubbleHandle, CameraBubbleProps>(
  ({ diameter, onError }, ref) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
    const [restartKey, setRestartKey] = useState(0);   // bump to force a stream restart
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
            video: { facingMode },
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

        // Center-crop the video to a square.
        const side = Math.min(video.videoWidth, video.videoHeight);
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

    return (
      <BubbleFrame diameter={diameter}>
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          muted
          autoPlay
          playsInline
          style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : undefined }}
        />
      </BubbleFrame>
    );
  }
);

CameraBubble.displayName = 'CameraBubble';
