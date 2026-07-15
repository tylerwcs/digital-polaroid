import React, { useEffect, useRef } from 'react';

interface SparkleBurstProps {
  size: number; // spotlight diameter in px; particle speed/canvas scale from this
}

// A one-shot radial sparkle burst on a transparent canvas. Particles fire evenly
// outward from the bubble's rim (a full circle), plus a smaller echo ring, then
// linger and fade in place — no gravity, no directional drift. The component
// stops the rAF loop once every particle has died; the parent unmounts it.
export const SparkleBurst: React.FC<SparkleBurstProps> = ({ size }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Square canvas padded around the bubble so outward particles have room.
    const pad = size * 0.6;
    const dim = size + pad * 2;
    canvas.width = dim;
    canvas.height = dim;
    const cx = dim / 2;
    const cy = dim / 2;
    const r = size / 2; // bubble radius
    const speedScale = size / 600; // prototype tuned at ~600px

    interface P {
      x: number; y: number; vx: number; vy: number;
      life: number; decay: number; sz: number; tw: number; gold: boolean;
    }
    const particles: P[] = [];

    const spawnRing = (n: number, speedBase: number) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.12;
        const sp = speedBase * (0.85 + Math.random() * 0.3) * speedScale;
        particles.push({
          x: cx + Math.cos(a) * r * 0.85,
          y: cy + Math.sin(a) * r * 0.85,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: 1,
          decay: 0.006 + Math.random() * 0.004,
          sz: (1.6 + Math.random() * 2.6) * Math.max(1, speedScale),
          tw: Math.random() * Math.PI * 2,
          gold: Math.random() < 0.5,
        });
      }
    };

    const SPARKS = 28;
    spawnRing(SPARKS, 5.2);
    const echo = window.setTimeout(() => spawnRing(Math.round(SPARKS * 0.6), 3.0), 130);

    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, dim, dim);
      ctx.globalCompositeOperation = 'lighter';
      for (const p of particles) {
        p.vx *= 0.95;
        p.vy *= 0.95; // symmetric drag, no vertical bias
        p.x += p.vx;
        p.y += p.vy;
        p.life -= p.decay;
        p.tw += 0.2;
        if (p.life > 0) {
          const tw = 0.65 + 0.35 * Math.sin(p.tw);
          ctx.globalAlpha = Math.max(0, p.life) * tw;
          ctx.fillStyle = p.gold ? 'rgba(255,225,150,1)' : 'rgba(180,205,255,1)';
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.sz * (0.5 + 0.5 * p.life), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      for (let i = particles.length - 1; i >= 0; i--) {
        if (particles[i].life <= 0) particles.splice(i, 1);
      }
      if (particles.length > 0) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(echo);
    };
  }, [size]);

  const dim = size + size * 0.6 * 2;
  return (
    <canvas
      ref={canvasRef}
      style={{ width: dim, height: dim, pointerEvents: 'none' }}
      aria-hidden
    />
  );
};

export default SparkleBurst;
