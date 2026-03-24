'use client';

import { useState, useCallback, useRef } from 'react';
import type { CanvasAction, CanvasEventData } from '@/components/platform/canvas/types';

export function useCanvas() {
  const [isCanvasOpen, setIsCanvasOpen] = useState(false);
  const [hasActivity, setHasActivity] = useState(false);
  const activityTimeoutRef = useRef<NodeJS.Timeout>(null);

  // Toggle canvas panel
  const toggleCanvas = useCallback(() => {
    setIsCanvasOpen(prev => !prev);
  }, []);

  // Open canvas
  const openCanvas = useCallback(() => {
    setIsCanvasOpen(true);
  }, []);

  // Close canvas
  const closeCanvas = useCallback(() => {
    setIsCanvasOpen(false);
  }, []);

  // Handle canvas update (called from useAgentEvents)
  const handleCanvasUpdate = useCallback((action: CanvasAction, data: CanvasEventData) => {
    // Auto-open canvas on first activity
    if (!isCanvasOpen && action === 'screenshot') {
      setIsCanvasOpen(true);
    }

    // Show activity indicator
    setHasActivity(true);
    
    // Clear previous timeout
    if (activityTimeoutRef.current) {
      clearTimeout(activityTimeoutRef.current);
    }
    
    // Reset activity indicator after 3 seconds of no activity
    activityTimeoutRef.current = setTimeout(() => {
      setHasActivity(false);
    }, 3000);

    // Forward to canvas component
    if (typeof window !== 'undefined' && (window as any).__canvasUpdate) {
      (window as any).__canvasUpdate(action, data);
    }
  }, [isCanvasOpen]);

  // Reset canvas state
  const resetCanvas = useCallback(() => {
    setHasActivity(false);
    if (typeof window !== 'undefined' && (window as any).__canvasReset) {
      (window as any).__canvasReset();
    }
  }, []);

  return {
    isCanvasOpen,
    hasActivity,
    toggleCanvas,
    openCanvas,
    closeCanvas,
    handleCanvasUpdate,
    resetCanvas,
  };
}
