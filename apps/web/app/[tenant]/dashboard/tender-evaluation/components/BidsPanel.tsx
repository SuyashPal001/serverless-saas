"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Upload, CheckCircle2, AlertCircle, Users, Trash2, X } from "lucide-react";

interface Bidder { id: string; name: string; displayLabel: string; status: string; embeddingReady: boolean }

interface FileStatus { name: string; status: "extracting" | "done" | "failed"; error?: string }

interface Props {
  tenderId: string;
  bidders: Bidder[];
  onBidderAdded: () => void;
}

export function BidsPanel({ tenderId, bidders, onBidderAdded }: Props) {
  const [bidderName, setBidderName] = useState("");
  const [fileStatuses, setFileStatuses] = useState<FileStatus[]>([]);
  const [encodedFiles, setEncodedFiles] = useState<Array<{ name: string; mimeType: string; dataBase64: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setFileStatuses(files.map(f => ({ name: f.name, status: "extracting" })));
    const encoded = await Promise.all(files.map(async f => {
      const buf = await f.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      return { name: f.name, mimeType: f.type || "application/octet-stream", dataBase64: b64 };
    }));
    setEncodedFiles(encoded);
    setFileStatuses(files.map(f => ({ name: f.name, status: "done" })));
    e.target.value = "";
  }

  async function handleUpload() {
    if (!bidderName.trim() || !encodedFiles.length) return;
    setUploading(true); setErr("");
    try {
      const res = await fetch(`/api/proxy/api/v1/tender/evaluations/${tenderId}/bidders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: bidderName.trim(), files: encodedFiles }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      setBidderName(""); setFileStatuses([]); setEncodedFiles([]);
      onBidderAdded();
    } catch (e) { setErr((e as Error).message); }
    setUploading(false);
  }

  async function handleDelete(bidderId: string) {
    setDeletingId(bidderId); setConfirmId(null);
    try {
      const res = await fetch(`/api/proxy/api/v1/tender/evaluations/${tenderId}/bidders/${bidderId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      onBidderAdded(); // refreshes the bidder list
    } catch (e) {
      setErr((e as Error).message);
    }
    setDeletingId(null);
  }

  return (
    <div className="space-y-6">
      {/* Received bids */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Users className="w-4 h-4 text-blue-400" />Bids Received ({bidders.length})
        </h3>
        {bidders.length === 0 && (
          <p className="text-xs text-muted-foreground">No bids uploaded yet. Upload below to enable evaluation.</p>
        )}
        <div className="flex flex-wrap gap-2">
          {bidders.map(b => (
            <div key={b.id} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-xs">
              {b.embeddingReady
                ? <CheckCircle2 className="w-3 h-3 text-blue-400 shrink-0" />
                : <Loader2 className="w-3 h-3 text-amber-400 animate-spin shrink-0" />}
              <span className="text-blue-300 font-medium">{b.displayLabel}</span>
              <span className="text-muted-foreground">— {b.name}</span>
              <span className={`text-xs font-medium ${b.embeddingReady ? 'text-green-400' : 'text-amber-400'}`}>
                {b.embeddingReady ? 'ready' : 'processing…'}
              </span>

              {confirmId === b.id ? (
                <span className="flex items-center gap-1 ml-1">
                  <span className="text-red-400">Remove?</span>
                  <button
                    onClick={() => handleDelete(b.id)}
                    disabled={deletingId === b.id}
                    className="text-red-400 hover:text-red-300 font-medium underline"
                  >
                    {deletingId === b.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Yes"}
                  </button>
                  <button onClick={() => setConfirmId(null)} className="text-muted-foreground hover:text-foreground">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmId(b.id)}
                  disabled={!!deletingId}
                  className="ml-1 text-muted-foreground hover:text-red-400 transition-colors"
                  title={`Remove ${b.displayLabel}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
        {err && <p className="text-xs text-red-400 bg-red-500/10 rounded p-2">{err}</p>}
      </div>

      {/* Upload form */}
      <div className="p-4 rounded-lg border border-border bg-card space-y-3">
        <h4 className="text-xs font-semibold text-foreground">Upload Bid Document(s)</h4>

        <Input
          className="text-xs"
          placeholder="Bidder / company name"
          value={bidderName}
          onChange={e => setBidderName(e.target.value)}
        />

        <div className="space-y-1">
          <input
            ref={fileInputRef} type="file" accept=".pdf,.docx" multiple
            className="hidden" onChange={handleFileChange}
          />
          <Button size="sm" variant="outline" className="text-xs gap-1"
            onClick={() => fileInputRef.current?.click()}>
            <Upload className="w-3 h-3" />
            {fileStatuses.length ? `${fileStatuses.length} file(s) selected` : "Attach bid docs (PDF · DOCX)"}
          </Button>

          {fileStatuses.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-1">
              {fileStatuses.map(f => (
                <span key={f.name} className="flex items-center gap-1 text-xs text-muted-foreground">
                  {f.status === "extracting" && <Loader2 className="w-3 h-3 animate-spin" />}
                  {f.status === "done" && <CheckCircle2 className="w-3 h-3 text-green-400" />}
                  {f.status === "failed" && <AlertCircle className="w-3 h-3 text-red-400" />}
                  {f.name}
                </span>
              ))}
            </div>
          )}
        </div>

        <Button
          size="sm" className="text-xs gap-1"
          disabled={uploading || !bidderName.trim() || encodedFiles.length === 0}
          onClick={handleUpload}
        >
          {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
          Upload Bid
        </Button>
      </div>
    </div>
  );
}
