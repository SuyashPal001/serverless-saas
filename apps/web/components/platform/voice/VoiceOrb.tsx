'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { VoiceState } from './types';

interface VoiceOrbProps {
  state: VoiceState;
  audioLevel: number; // 0-1
  onClick?: () => void;
}

export function VoiceOrb({ state, audioLevel, onClick }: VoiceOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Animate the orb based on state and audio level
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let phase = 0;

    const draw = () => {
      const { width, height } = canvas;
      const centerX = width / 2;
      const centerY = height / 2;
      const baseRadius = Math.min(width, height) * 0.25;

      // Clear
      ctx.clearRect(0, 0, width, height);

      // Colors based on state
      const colors = getStateColors(state);

      // Draw multiple layers for depth
      for (let layer = 3; layer >= 0; layer--) {
        const layerAudioLevel = state === 'idle' ? 0.1 : audioLevel;
        const radiusMultiplier = 1 + (layer * 0.15) + (layerAudioLevel * 0.3 * (layer + 1));
        const radius = baseRadius * radiusMultiplier;
        const alpha = 0.3 - (layer * 0.08);

        // Create gradient
        const gradient = ctx.createRadialGradient(
          centerX, centerY, 0,
          centerX, centerY, radius
        );
        gradient.addColorStop(0, colors.inner);
        gradient.addColorStop(0.5, colors.middle);
        gradient.addColorStop(1, 'transparent');

        // Draw blob with organic deformation
        ctx.beginPath();
        const points = 64;
        for (let i = 0; i <= points; i++) {
          const angle = (i / points) * Math.PI * 2;
          const noise = state === 'idle' 
            ? 0 
            : Math.sin(angle * 3 + phase + layer) * layerAudioLevel * 15;
          const r = radius + noise;
          const x = centerX + Math.cos(angle) * r;
          const y = centerY + Math.sin(angle) * r;
          
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.closePath();

        ctx.globalAlpha = alpha;
        ctx.fillStyle = gradient;
        ctx.fill();
      }

      // Inner glow
      ctx.globalAlpha = 0.8;
      const innerGradient = ctx.createRadialGradient(
        centerX, centerY, 0,
        centerX, centerY, baseRadius * 0.8
      );
      innerGradient.addColorStop(0, colors.core);
      innerGradient.addColorStop(1, colors.inner);
      
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = innerGradient;
      ctx.fill();

      ctx.globalAlpha = 1;

      // Animate
      phase += state === 'idle' ? 0.01 : 0.05;
      animationId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [state, audioLevel]);

  return (
    <button
      onClick={onClick}
      className={cn(
        'relative rounded-full transition-transform hover:scale-105 active:scale-95',
        'focus:outline-none focus:ring-2 focus:ring-white/20'
      )}
    >
      <canvas
        ref={canvasRef}
        width={300}
        height={300}
        className="w-[300px] h-[300px]"
      />
      
      {/* State icon overlay */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <StateIcon state={state} />
      </div>
    </button>
  );
}

function StateIcon({ state }: { state: VoiceState }) {
  switch (state) {
    case 'idle':
      return (
        <svg className="w-12 h-12 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
          <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
        </svg>
      );
    case 'listening':
      return (
        <div className="flex gap-1">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="w-1.5 h-8 bg-white rounded-full animate-pulse"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
      );
    case 'thinking':
      return (
        <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
      );
    case 'speaking':
      return (
        <svg className="w-10 h-10 text-white animate-pulse" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
        </svg>
      );
    case 'error':
      return (
        <svg className="w-10 h-10 text-red-400" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
        </svg>
      );
  }
}

function getStateColors(state: VoiceState) {
  switch (state) {
    case 'listening':
      return {
        core: 'rgba(59, 130, 246, 1)',    // Blue
        inner: 'rgba(59, 130, 246, 0.8)',
        middle: 'rgba(147, 51, 234, 0.5)', // Purple blend
      };
    case 'thinking':
      return {
        core: 'rgba(147, 51, 234, 1)',    // Purple
        inner: 'rgba(147, 51, 234, 0.8)',
        middle: 'rgba(236, 72, 153, 0.5)', // Pink blend
      };
    case 'speaking':
      return {
        core: 'rgba(34, 197, 94, 1)',     // Green
        inner: 'rgba(34, 197, 94, 0.8)',
        middle: 'rgba(59, 130, 246, 0.5)', // Blue blend
      };
    case 'error':
      return {
        core: 'rgba(239, 68, 68, 1)',     // Red
        inner: 'rgba(239, 68, 68, 0.8)',
        middle: 'rgba(249, 115, 22, 0.5)', // Orange blend
      };
    default: // idle
      return {
        core: 'rgba(255, 255, 255, 0.9)',
        inner: 'rgba(255, 255, 255, 0.6)',
        middle: 'rgba(255, 255, 255, 0.2)',
      };
  }
}
