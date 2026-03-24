'use client';

import { useState, useCallback, useEffect } from 'react';
import { CanvasViewer } from './CanvasViewer';
import { ActionTimeline } from './ActionTimeline';
import { FileCreatedCard } from './FileCreatedCard';
import type { CanvasState, CanvasEvent, CanvasOverlay, CanvasEventData, CanvasAction } from './types';

interface CanvasProps {
  /** Whether canvas panel is visible */
  isOpen: boolean;
  /** Callback when canvas receives updates */
  onActivity?: () => void;
}

// Initial state
const initialState: CanvasState = {
  currentScreenshot: null,
  currentUrl: null,
  actionHistory: [],
  isActive: false,
  overlays: [],
};

// Overlay duration in ms
const OVERLAY_DURATION = 2000;

export function Canvas({ isOpen, onActivity }: CanvasProps) {
  const [state, setState] = useState<CanvasState>(initialState);
  const [recentFiles, setRecentFiles] = useState<Array<{ path: string; type?: string }>>([]);

  // Clean up expired overlays periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setState(prev => ({
        ...prev,
        overlays: prev.overlays.filter(o => o.expiresAt > Date.now()),
      }));
    }, 500);

    return () => clearInterval(interval);
  }, []);

  /**
   * Handle canvas update event from WebSocket
   * This is called by the parent component via window or context
   */
  const handleCanvasUpdate = useCallback((action: CanvasAction, data: CanvasEventData) => {
    const eventId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    // Create event record
    const event: CanvasEvent = {
      id: eventId,
      action,
      timestamp,
      data,
    };

    setState(prev => {
      const newState: CanvasState = {
        ...prev,
        isActive: true,
        actionHistory: [...prev.actionHistory, event].slice(-50), // Keep last 50
      };

      // Update based on action type
      switch (action) {
        case 'screenshot':
          if (data.screenshot) {
            newState.currentScreenshot = data.screenshot;
          }
          if (data.url) {
            newState.currentUrl = data.url;
          }
          break;

        case 'navigate':
          if (data.url) {
            newState.currentUrl = data.url;
          }
          break;

        case 'click':
          if (data.x !== undefined && data.y !== undefined) {
            const overlay: CanvasOverlay = {
              id: eventId,
              type: 'click',
              x: data.x,
              y: data.y,
              expiresAt: Date.now() + OVERLAY_DURATION,
            };
            newState.overlays = [...prev.overlays, overlay];
          }
          break;

        case 'type':
          if (data.x !== undefined && data.y !== undefined) {
            const overlay: CanvasOverlay = {
              id: eventId,
              type: 'type',
              x: data.x,
              y: data.y,
              text: data.text,
              expiresAt: Date.now() + OVERLAY_DURATION,
            };
            newState.overlays = [...prev.overlays, overlay];
          }
          break;

        case 'file_created':
          if (data.filePath) {
            setRecentFiles(prev => [
              { path: data.filePath!, type: data.fileType },
              ...prev.slice(0, 4), // Keep last 5
            ]);
          }
          break;
      }

      return newState;
    });

    onActivity?.();
  }, [onActivity]);

  // Reset canvas
  const handleReset = useCallback(() => {
    setState(initialState);
    setRecentFiles([]);
  }, []);

  // Expose handler to parent (via window for simplicity, or use ref/context)
  useEffect(() => {
    (window as any).__canvasUpdate = handleCanvasUpdate;
    (window as any).__canvasReset = handleReset;
    
    return () => {
      delete (window as any).__canvasUpdate;
      delete (window as any).__canvasReset;
    };
  }, [handleCanvasUpdate, handleReset]);

  if (!isOpen) return null;

  return (
    <div className="flex flex-col h-full bg-background border-l border-border relative">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="font-semibold">Agent Canvas</h3>
        {state.isActive && (
          <span className="flex items-center gap-1.5 text-xs text-green-500">
            <span className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
            Live
          </span>
        )}
      </div>

      {/* Viewer */}
      <div className="p-4">
        <CanvasViewer
          screenshot={state.currentScreenshot}
          url={state.currentUrl}
          overlays={state.overlays}
          isActive={state.isActive}
        />
      </div>

      {/* Recent Files */}
      {recentFiles.length > 0 && (
        <div className="px-4 pb-4 space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">Created Files</h4>
          {recentFiles.map((file, i) => (
            <FileCreatedCard
              key={`${file.path}-${i}`}
              filePath={file.path}
              fileType={file.type}
            />
          ))}
        </div>
      )}

      {/* Timeline */}
      <div className="flex-1 overflow-auto px-4 pb-4 custom-scrollbar">
        <h4 className="text-sm font-medium text-muted-foreground mb-4">Activity</h4>
        <ActionTimeline events={state.actionHistory} />
      </div>
    </div>
  );
}

// Export handler type for parent components
export type CanvasUpdateHandler = (action: CanvasAction, data: CanvasEventData) => void;
