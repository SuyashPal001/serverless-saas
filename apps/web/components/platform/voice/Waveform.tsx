'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface WaveformProps {
  audioLevel: number;
  isActive: boolean;
  color?: string;
  className?: string;
}

export function Waveform({ audioLevel, isActive, color = 'white', className }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barsRef = useRef<number[]>(Array(32).fill(0));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;

    const draw = () => {
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      const bars = barsRef.current;
      const barCount = bars.length;
      const barWidth = width / barCount - 2;
      const maxHeight = height * 0.8;

      // Update bar heights
      for (let i = 0; i < barCount; i++) {
        const target = isActive 
          ? (Math.random() * 0.5 + 0.5) * audioLevel 
          : 0.05;
        bars[i] += (target - bars[i]) * 0.3;
      }

      // Draw bars
      ctx.fillStyle = color;
      
      for (let i = 0; i < barCount; i++) {
        const barHeight = Math.max(4, bars[i] * maxHeight);
        const x = i * (barWidth + 2);
        const y = (height - barHeight) / 2;

        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, barWidth / 2);
        ctx.fill();
      }

      animationId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [audioLevel, isActive, color]);

  return (
    <canvas
      ref={canvasRef}
      width={320}
      height={60}
      className={cn('opacity-80', className)}
    />
  );
}
