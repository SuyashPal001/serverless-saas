'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { CanvasViewer } from './CanvasViewer';
import { FileCreatedCard } from './FileCreatedCard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { File, FileText, Trash2, Plus, Download, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import * as mammoth from 'mammoth';
import type { CanvasState, CanvasEvent, CanvasOverlay, CanvasEventData, CanvasAction } from './types';

interface CanvasProps {
  /** Whether canvas panel is visible */
  isOpen: boolean;
  /** Whether canvas is natively expanded */
  isExpanded?: boolean;
  /** Callback when canvas receives updates */
  onActivity?: () => void;
  /** Callback to toggle expanded mode */
  onExpand?: () => void;
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

// Knowledge Base doc state
type DocStatus = 'pending' | 'ready' | 'failed';
interface KBDocument {
  id: string;
  documentId?: string;
  name: string;
  type: string;
  status: DocStatus;
  chunks?: number;
  isPolling?: boolean;
  file?: File;
  previewUrl?: string;
  textContent?: string;
  htmlContent?: string;
}

export function Canvas({ isOpen, isExpanded, onActivity, onExpand }: CanvasProps) {
  const [state, setState] = useState<CanvasState>(initialState);
  const [recentFiles, setRecentFiles] = useState<Array<{ path: string; type?: string }>>([]);
  const [documents, setDocuments] = useState<KBDocument[]>([]);
  const [previewDoc, setPreviewDoc] = useState<KBDocument | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Clean up all polling timers on unmount
  useEffect(() => {
    return () => {
      pollingRefs.current.forEach(id => clearTimeout(id));
    };
  }, []);

  // Poll document status until ready/failed or max attempts reached
  const pollDocumentStatus = useCallback((localId: string, documentId: string, attempt = 0) => {
    if (attempt >= 12) {
      setDocuments(prev => prev.map(d =>
        d.id === localId ? { ...d, status: 'failed', isPolling: false } : d
      ));
      pollingRefs.current.delete(localId);
      return;
    }

    const timeoutId = setTimeout(async () => {
      try {
        const res = await fetch(`/api/proxy/api/v1/documents/${documentId}`);
        if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
        const data = await res.json();

        if (data.status === 'ready') {
          setDocuments(prev => prev.map(d =>
            d.id === localId ? { ...d, status: 'ready', chunks: data.chunkCount, isPolling: false } : d
          ));
          pollingRefs.current.delete(localId);
        } else if (data.status === 'failed') {
          setDocuments(prev => prev.map(d =>
            d.id === localId ? { ...d, status: 'failed', isPolling: false } : d
          ));
          pollingRefs.current.delete(localId);
        } else {
          pollDocumentStatus(localId, documentId, attempt + 1);
        }
      } catch (err) {
        console.error('[Canvas] polling error:', err);
        pollDocumentStatus(localId, documentId, attempt + 1);
      }
    }, 5000);

    pollingRefs.current.set(localId, timeoutId);
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const type = file.name.split('.').pop()?.toLowerCase() || 'unknown';
    const localId = crypto.randomUUID();

    const newDoc: KBDocument = {
      id: localId,
      name: file.name,
      type,
      status: 'pending',
      isPolling: false,
      file,
    };

    // Local preview setup (unchanged)
    if (type === 'pdf') {
      newDoc.previewUrl = URL.createObjectURL(file);
    } else if (type === 'txt') {
      try {
        newDoc.textContent = await file.text();
      } catch (err) {
        console.error('Failed to read text file', err);
      }
    } else if (type === 'docx') {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        newDoc.htmlContent = result.value;
      } catch (err) {
        console.error('Failed to convert docx file', err);
      }
    }

    setDocuments(prev => [newDoc, ...prev]);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    // ── API upload flow ───────────────────────────────────────────────────────

    try {
      // Step 1: Compute SHA-256 hash
      const buffer = await file.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      // Step 2: Get presigned upload URL
      const urlRes = await fetch('/api/proxy/api/v1/documents/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, mimeType: file.type }),
      });
      if (!urlRes.ok) throw new Error(`Failed to get upload URL: ${urlRes.status}`);
      const { uploadUrl, fileKey } = await urlRes.json();

      // Step 3: PUT directly to S3 presigned URL (no proxy)
      const s3Res = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type },
      });
      if (!s3Res.ok) throw new Error(`S3 upload failed: ${s3Res.status}`);

      // Step 4: Register document
      const regRes = await fetch('/api/proxy/api/v1/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, mimeType: file.type, fileKey, hash }),
      });
      if (!regRes.ok) {
        if (regRes.status === 409) {
          // Duplicate — extract documentId and start polling for its actual status
          const errData = await regRes.json().catch(() => ({}));
          const dupDocumentId: string | undefined = errData.documentId;
          if (dupDocumentId) {
            setDocuments(prev => prev.map(d =>
              d.id === localId ? { ...d, documentId: dupDocumentId, isPolling: true } : d
            ));
            pollDocumentStatus(localId, dupDocumentId);
          } else {
            setDocuments(prev => prev.map(d =>
              d.id === localId ? { ...d, status: 'ready' } : d
            ));
          }
          return;
        }
        throw new Error(`Document registration failed: ${regRes.status}`);
      }
      const { documentId } = await regRes.json();

      // Step 5: Store documentId and start polling
      setDocuments(prev => prev.map(d =>
        d.id === localId ? { ...d, documentId, isPolling: true } : d
      ));
      pollDocumentStatus(localId, documentId);

    } catch (err) {
      console.error('[Canvas] upload failed:', err);
      setDocuments(prev => prev.map(d =>
        d.id === localId ? { ...d, status: 'failed', isPolling: false } : d
      ));
    }
  };

  const removeDocument = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();

    const doc = documents.find(d => d.id === id);

    // Cancel any in-flight polling for this doc
    const pendingTimeout = pollingRefs.current.get(id);
    if (pendingTimeout !== undefined) {
      clearTimeout(pendingTimeout);
      pollingRefs.current.delete(id);
    }

    // Optimistically remove from UI
    setDocuments(prev => {
      const d = prev.find(x => x.id === id);
      if (d?.previewUrl) URL.revokeObjectURL(d.previewUrl);
      return prev.filter(x => x.id !== id);
    });
    if (previewDoc?.id === id) setPreviewDoc(null);

    // Call delete API if document was registered
    if (doc?.documentId) {
      try {
        await fetch(`/api/proxy/api/v1/documents/${doc.documentId}`, { method: 'DELETE' });
      } catch (err) {
        console.error('[Canvas] delete failed:', err);
      }
    }
  };

  const downloadFile = (doc: KBDocument) => {
    if (!doc.file) return;
    const url = URL.createObjectURL(doc.file);
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

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
    <div className="flex flex-col h-full bg-background border-l border-border">
      {/* Header */}
      <div className="flex-none flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="font-semibold text-sm">Agent Canvas</h3>
        {state.isActive && (
          <span className="flex items-center gap-1.5 text-xs text-green-500">
            <span className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
            Live
          </span>
        )}
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        {/* Browser Viewer */}
        <div className="flex-none p-4 pb-3">
          <CanvasViewer
            screenshot={state.currentScreenshot}
            url={state.currentUrl}
            overlays={state.overlays}
            isActive={state.isActive}
            isFullscreen={isExpanded}
            onFullscreen={onExpand}
          />
        </div>

        {/* Recent Files */}
        {recentFiles.length > 0 && (
          <div className="flex-none px-4 pb-3 space-y-2">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-px flex-1 bg-border/50" />
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">Created Files</span>
              <div className="h-px flex-1 bg-border/50" />
            </div>
            {recentFiles.map((file, i) => (
              <FileCreatedCard
                key={`${file.path}-${i}`}
                filePath={file.path}
                fileType={file.type}
              />
            ))}
          </div>
        )}

        {/* Knowledge Base */}
        <div className="flex flex-col flex-1 min-h-0">
          <div className="mx-4 mb-3 border-t border-border/60 pt-3 flex items-center justify-between">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Knowledge Base</h4>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 rounded-full -mr-1"
              onClick={() => fileInputRef.current?.click()}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept=".pdf,.docx,.txt"
              onChange={handleFileUpload}
            />
          </div>

          <div className="px-4 pb-4 flex-1 flex flex-col">
            {documents.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/60 bg-muted/10 min-h-[140px] cursor-pointer hover:bg-muted/20 transition-colors" onClick={() => fileInputRef.current?.click()}>
                <div className="h-10 w-10 rounded-full bg-muted/40 flex items-center justify-center">
                  <Plus className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="text-center px-4">
                  <p className="text-xs font-medium text-muted-foreground">Drop files here or click to upload</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5">PDF, DOCX, or TXT supported</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="group relative flex flex-col p-3.5 rounded-xl border border-border/60 bg-card hover:bg-muted/40 transition-colors cursor-pointer text-sm shadow-sm min-h-[110px]"
                    onClick={() => setPreviewDoc(doc)}
                  >
                    <div className="flex-1 mb-3 pr-4">
                      <h5 className="font-medium text-zinc-200 line-clamp-3 leading-snug break-words">
                        {doc.name}
                      </h5>
                      <p className="text-[11px] text-muted-foreground mt-1.5 font-medium flex items-center gap-1">
                        {doc.isPolling && (
                          <Loader2 className="h-2.5 w-2.5 animate-spin shrink-0" />
                        )}
                        {doc.status === 'ready'
                          ? `${doc.chunks} chunks`
                          : doc.status === 'pending'
                          ? 'Processing...'
                          : 'Failed'}
                      </p>
                    </div>

                    <div className="flex items-center justify-between mt-auto">
                      <Badge variant="outline" className="text-[10px] font-semibold bg-transparent px-1.5 py-0 border-border/80 text-muted-foreground uppercase tracking-widest rounded-md">
                        {doc.type}
                      </Badge>
                    </div>

                    <div className="absolute top-2 right-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity bg-background/50 hover:bg-background/80"
                        onClick={(e) => removeDocument(doc.id, e)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Document Preview Modal */}
      <Dialog open={!!previewDoc} onOpenChange={(open) => !open && setPreviewDoc(null)}>
        <DialogContent className="max-w-4xl h-[85vh] flex flex-col p-0 gap-0 bg-[#1C1C1C] border-[#2C2C2C] text-zinc-50 overflow-hidden sm:rounded-xl">
          <DialogHeader className="flex-none p-4 border-b border-[#2C2C2C] bg-[#181818]">
            <DialogTitle className="text-xl font-medium truncate pr-6 text-zinc-100">{previewDoc?.name}</DialogTitle>
            <DialogDescription className="sr-only">Document preview</DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-auto relative flex flex-col items-center justify-center p-4 bg-[#1C1C1C]">
            {previewDoc?.type === 'pdf' && previewDoc.previewUrl ? (
              <iframe
                src={`${previewDoc.previewUrl}#toolbar=0`}
                className="w-full h-full max-w-3xl border-0 rounded-md bg-white shadow-xl"
                title={previewDoc.name}
              />
            ) : previewDoc?.type === 'txt' ? (
              <div className="w-full h-full max-w-3xl bg-[#252525] p-6 rounded-md overflow-auto border border-[#333] shadow-xl">
                 <pre className="whitespace-pre-wrap font-mono text-sm text-zinc-300">
                   {previewDoc.textContent}
                 </pre>
              </div>
            ) : previewDoc?.type === 'docx' && previewDoc.htmlContent ? (
              <div className="w-full h-full max-w-3xl bg-white p-8 rounded-md overflow-auto shadow-xl text-black">
                 <div
                   className="prose prose-sm max-w-none prose-zinc"
                   dangerouslySetInnerHTML={{ __html: previewDoc.htmlContent }}
                 />
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 text-zinc-500">
                <FileText className="h-16 w-16 opacity-50" />
                <p>Preview not available for .{previewDoc?.type} files</p>
              </div>
            )}
          </div>

          <div className="flex-none p-4 border-t border-[#2C2C2C] flex justify-center bg-[#181818]">
             <Button
               variant="ghost"
               className="text-zinc-300 hover:text-white hover:bg-zinc-800 gap-2 font-medium"
               onClick={() => previewDoc && downloadFile(previewDoc)}
             >
               <Download className="h-4 w-4" />
               Download
             </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Export handler type for parent components
export type CanvasUpdateHandler = (action: CanvasAction, data: CanvasEventData) => void;
