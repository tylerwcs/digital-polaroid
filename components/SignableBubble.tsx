import React, { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { BubbleFrame } from './BubbleFrame';
import { photoCircleSize, signatureBandBox } from '../lib/bubbleGeometry';

export interface SignableBubbleHandle {
  getSignature: () => string | undefined;  // base64 PNG, or undefined if empty
  clear: () => void;
}

interface SignableBubbleProps {
  diameter: number;
  imageDataUrl: string;
}

export const SignableBubble = forwardRef<SignableBubbleHandle, SignableBubbleProps>(
  ({ diameter, imageDataUrl }, ref) => {
    const sigRef = useRef<SignatureCanvas>(null);
    const [hasDrawn, setHasDrawn] = useState(false);

    const circle = photoCircleSize(diameter);
    const band = signatureBandBox(circle);

    // Clear strokes if the underlying photo changes (e.g., retake then re-enter).
    useEffect(() => {
      sigRef.current?.clear();
      setHasDrawn(false);
    }, [imageDataUrl]);

    useImperativeHandle(ref, () => ({
      getSignature: () => {
        const c = sigRef.current;
        if (!c || c.isEmpty()) return undefined;
        try {
          return c.getCanvas().toDataURL('image/png');
        } catch {
          return undefined;
        }
      },
      clear: () => {
        sigRef.current?.clear();
        setHasDrawn(false);
      },
    }), []);

    return (
      <BubbleFrame diameter={diameter}>
        {/* Captured photo */}
        <img src={imageDataUrl} alt="" className="w-full h-full object-cover" draggable={false} />

        {/* Signature canvas pinned to the bottom band of the photo circle */}
        <div
          className="absolute left-0 right-0 bottom-0 cursor-crosshair"
          style={{ width: band.width, height: band.height }}
        >
          <SignatureCanvas
            ref={sigRef}
            penColor="#ffffff"
            onEnd={() => setHasDrawn(true)}
            canvasProps={{
              width: band.width,
              height: band.height,
              className: 'absolute inset-0',
            }}
            clearOnResize={false}
          />
          {/* "Sign here" hint, fades once drawing starts */}
          {!hasDrawn && (
            <div className="absolute inset-0 flex items-end justify-center pb-2 pointer-events-none">
              <span className="text-white/70 text-sm font-medium drop-shadow">Sign here</span>
            </div>
          )}
        </div>
      </BubbleFrame>
    );
  }
);

SignableBubble.displayName = 'SignableBubble';
