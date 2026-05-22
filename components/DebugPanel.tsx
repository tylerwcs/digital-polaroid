import React, { useState } from 'react';
import { PHYSICS } from '../lib/bubblePhysics';

type Field = keyof typeof PHYSICS;

interface SliderSpec {
  key: Field;
  label: string;
  min: number;
  max: number;
  step: number;
}

const SLIDERS: SliderSpec[] = [
  { key: 'WANDER_STRENGTH',    label: 'Wander strength',     min: 0,    max: 2,    step: 0.05 },
  { key: 'WANDER_EASING',      label: 'Wander easing',       min: 0.001, max: 0.2, step: 0.001 },
  { key: 'WANDER_INTERVAL_MS', label: 'Wander interval (ms)',min: 200,  max: 8000, step: 100 },
  { key: 'DAMPING',            label: 'Damping',             min: 0.9,  max: 1.0,  step: 0.001 },
  { key: 'MAX_SPEED',          label: 'Max speed',           min: 0.1,  max: 3,    step: 0.1 },
  { key: 'WALL_BOUNCE_DAMP',   label: 'Wall bounce damp',    min: 0,    max: 1,    step: 0.05 },
  { key: 'COLLISION_DAMP',     label: 'Collision damp',      min: 0,    max: 1,    step: 0.05 },
  { key: 'RADIUS_RATIO_MIN',   label: 'Radius ratio min',    min: 0.05, max: 0.3,  step: 0.005 },
  { key: 'RADIUS_RATIO_MAX',   label: 'Radius ratio max',    min: 0.05, max: 0.3,  step: 0.005 },
  { key: 'RADIUS_MIN',         label: 'Radius min (px)',     min: 40,   max: 400,  step: 5 },
  { key: 'RADIUS_MAX',         label: 'Radius max (px)',     min: 80,   max: 600,  step: 5 },
];

interface DebugPanelProps {
  onRespawn: () => void;
}

export const DebugPanel: React.FC<DebugPanelProps> = ({ onRespawn }) => {
  const [, setTick] = useState(0);
  const [open, setOpen] = useState(true);
  const bump = () => setTick((n) => n + 1);

  const setValue = (key: Field, value: number) => {
    (PHYSICS as Record<string, number>)[key] = value;
    bump();
  };

  return (
    <div
      className="fixed top-4 left-4 z-[100] bg-black/80 text-white text-xs rounded-lg shadow-2xl border border-white/20 backdrop-blur-sm"
      style={{ width: open ? 320 : 'auto', maxHeight: '90vh', overflowY: 'auto' }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <span className="font-semibold tracking-wide">Bubble Tuner</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRespawn}
            className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-[10px]"
            title="Remove all bubbles and re-spawn them with current size settings"
          >
            Respawn
          </button>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-[10px]"
          >
            {open ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {open && (
        <div className="p-3 space-y-3">
          {SLIDERS.map((s) => {
            const current = (PHYSICS as Record<string, number>)[s.key];
            return (
              <div key={s.key}>
                <div className="flex justify-between mb-1">
                  <label htmlFor={`debug-${s.key}`}>{s.label}</label>
                  <span className="font-mono tabular-nums opacity-80">{current.toFixed(s.step < 1 ? 3 : 0)}</span>
                </div>
                <input
                  id={`debug-${s.key}`}
                  type="range"
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  value={current}
                  onChange={(e) => setValue(s.key, parseFloat(e.target.value))}
                  className="w-full accent-white"
                />
              </div>
            );
          })}
          <p className="text-[10px] opacity-60 leading-snug pt-2 border-t border-white/10">
            Live values mutate <code>PHYSICS</code>. Size changes only affect newly-spawned bubbles — click <strong>Respawn</strong> to re-create the wall with current size settings.
          </p>
        </div>
      )}
    </div>
  );
};
