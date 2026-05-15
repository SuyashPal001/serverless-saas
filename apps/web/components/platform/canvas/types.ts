/**
 * Canvas Types
 */

export type CanvasAction = 
  | 'screenshot' 
  | 'click' 
  | 'type' 
  | 'navigate' 
  | 'scroll' 
  | 'file_created';

export interface CanvasEvent {
  id: string;
  action: CanvasAction;
  timestamp: string;
  data: CanvasEventData;
}

export interface CanvasEventData {
  screenshot?: string;
  url?: string;
  elementSelector?: string;
  text?: string;
  filePath?: string;
  fileType?: string;
  x?: number;
  y?: number;
  scrollTop?: number;
  [key: string]: unknown;
}

export interface CanvasState {
  /** Current screenshot being displayed */
  currentScreenshot: string | null;
  /** Current URL the agent is on */
  currentUrl: string | null;
  /** History of actions for timeline */
  actionHistory: CanvasEvent[];
  /** Whether canvas is actively receiving updates */
  isActive: boolean;
  /** Overlay indicators (click ripples, type highlights) */
  overlays: CanvasOverlay[];
}

export interface CanvasOverlay {
  id: string;
  type: 'click' | 'type' | 'scroll';
  x?: number;
  y?: number;
  text?: string;
  expiresAt: number; // Timestamp when overlay should disappear
}
