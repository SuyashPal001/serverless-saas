'use client';

import { useState, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Monitor, MousePointer2, Type, Navigation, Maximize2, Minimize2 } from 'lucide-react';
import type { CanvasOverlay } from './types';

interface CanvasViewerProps {
  screenshot: string | null;
  url: string | null;
  overlays: CanvasOverlay[];
  isActive: boolean;
  onFullscreen?: () => void;
}

export function CanvasViewer({
  screenshot,
  url,
  overlays,
  isActive,
  onFullscreen,
}: CanvasViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Clean up expired overlays
  const activeOverlays = overlays.filter(o => o.expiresAt > Date.now());

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative bg-black rounded-lg overflow-hidden',
        isFullscreen ? 'fixed inset-4 z-50' : 'aspect-video'
      )}
    >
      {/* URL Bar */}
      {url && (
        <div className="absolute top-0 left-0 right-0 bg-muted/90 backdrop-blur px-3 py-1.5 flex items-center gap-2 z-10">
          <Navigation className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground truncate flex-1">
            {url}
          </span>
          {isActive && (
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-xs text-green-500">Live</span>
            </span>
          )}
        </div>
      )}

      {/* Screenshot */}
      {screenshot ? (
        <img
          src={`data:image/png;base64,${screenshot}`}
          alt="Agent view"
          className="w-full h-full object-contain"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-muted-foreground">
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

      {/* Fullscreen Toggle */}
      <button
        onClick={() => {
          setIsFullscreen(!isFullscreen);
          onFullscreen?.();
        }}
        className="absolute bottom-2 right-2 p-1.5 bg-black/50 hover:bg-black/70 rounded transition-colors"
      >
        {isFullscreen ? (
          <Minimize2 className="h-4 w-4 text-white" />
        ) : (
          <Maximize2 className="h-4 w-4 text-white" />
        )}
      </button>
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
