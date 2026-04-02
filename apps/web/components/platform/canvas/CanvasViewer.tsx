'use client';

import { useRef } from 'react';
import { cn } from '@/lib/utils';
import { Monitor, MousePointer2, Type, Maximize2, Minimize2, ArrowLeft, ArrowRight, RotateCw, ShieldCheck } from 'lucide-react';
import type { CanvasOverlay } from './types';

interface CanvasViewerProps {
  screenshot: string | null;
  url: string | null;
  overlays: CanvasOverlay[];
  isActive: boolean;
  isFullscreen?: boolean;
  onFullscreen?: () => void;
}

export function CanvasViewer({
  screenshot,
  url,
  overlays,
  isActive,
  isFullscreen = false,
  onFullscreen,
}: CanvasViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Clean up expired overlays
  const activeOverlays = overlays.filter(o => o.expiresAt > Date.now());

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex flex-col bg-[#1e1e1e] rounded-lg overflow-hidden border border-white/10 shadow-2xl w-full',
        isFullscreen ? 'h-[75vh]' : 'aspect-video'
      )}
    >
      {/* Browser Chrome */}
      <div className="h-10 bg-[#2d2d2d] flex items-center px-3 gap-3 border-b border-black/20">
        {/* Traffic Lights */}
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
          <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
          <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
        </div>

        {/* Nav Controls */}
        <div className="flex gap-2 text-white/40">
          <ArrowLeft className="h-4 w-4" />
          <ArrowRight className="h-4 w-4" />
          <RotateCw className="h-4 w-4" />
        </div>

        {/* URL Bar */}
        <div className="flex-1 bg-[#1e1e1e] rounded-md px-3 py-1 flex items-center gap-2 text-white/60 text-xs border border-white/5">
          <ShieldCheck className="h-3 w-3 text-emerald-500" />
          <span className="truncate flex-1">{url || 'about:blank'}</span>
          {isActive && (
            <span className="h-1.5 w-1.5 bg-green-500 rounded-full animate-pulse" />
          )}
        </div>

        {/* Fullscreen Toggle */}
        <button onClick={onFullscreen} className="text-white/60 hover:text-white">
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>

      {/* Viewport */}
      <div className="relative flex-1 overflow-hidden bg-black">
        {screenshot ? (
          <img
            src={`data:image/png;base64,${screenshot}`}
            alt="Agent view"
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/20">
            <div className="text-center">
              <Monitor className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Waiting for agent activity...</p>
            </div>
          </div>
        )}

        {/* Click Overlays */}
        {activeOverlays
          .filter(o => o.type === 'click')
          .map(overlay => (
            <ClickRipple
              key={overlay.id}
              x={overlay.x ?? 0}
              y={overlay.y ?? 0}
            />
          ))}

        {/* Type Overlays */}
        {activeOverlays
          .filter(o => o.type === 'type')
          .map(overlay => (
            <TypeIndicator
              key={overlay.id}
              x={overlay.x ?? 0}
              y={overlay.y ?? 0}
              text={overlay.text ?? ''}
            />
          ))}
      </div>
    </div>
  );
}

// Click ripple animation
function ClickRipple({ x, y }: { x: number; y: number }) {
  return (
    <div
      className="absolute pointer-events-none"
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <div className="relative -translate-x-1/2 -translate-y-1/2">
        <MousePointer2 className="h-5 w-5 text-primary" />
        <div className="absolute inset-0 -m-2 rounded-full border-2 border-primary animate-ping" />
      </div>
    </div>
  );
}

// Typing indicator
function TypeIndicator({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <div
      className="absolute pointer-events-none"
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <div className="bg-primary/90 text-primary-foreground px-2 py-1 rounded text-xs flex items-center gap-1">
        <Type className="h-3 w-3" />
        <span className="max-w-32 truncate">{text}</span>
      </div>
    </div>
  );
}
