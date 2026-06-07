"use client";

import { useState, useRef, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, X, CheckCircle2, AlertCircle, Eye } from "lucide-react";

interface FileStatus { name: string; status: "pending" | "extracting" | "done" | "failed"; error?: string; charCount?: number }

interface Props {
  tenderId: string;
  currentQueryCount: number;
  onQueriesParsed: () => void;
}

export function QuerySheetUpload({ tenderId, currentQueryCount, onQueriesParsed }: Props) {
  const [fileStatuses, setFileStatuses] = useState<FileStatus[]>([]);
  const [extractedTexts, setExtractedTexts] = useState<Record<string, string>>({});
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const preUploadCount = useRef(0);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setFileStatuses(prev => [...prev, ...files.map(f => ({ name: f.name, status: "extracting" as const }))]);
    const encoded = await Promise.all(files.map(async f => {
      const buf = await f.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      return { name: f.name, mimeType: f.type || "application/octet-stream", dataBase64: b64 };
    }));
    try {
      const res = await fetch("/api/proxy/api/v1/tender/authoring/extract-text", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: encoded }),
      });
      const json = await res.json();
      const results: Array<{ filename: string; text: string; status: string; error?: string }> = json.results ?? [];
      const incoming = new Map(results.map(r => [r.filename, r]));
      setFileStatuses(prev => prev.map(fs => {
        const r = incoming.get(fs.name);
        if (!r) return { ...fs, status: "failed" as const, error: "No response for file" };
        return r.status === "done"
          ? { ...fs, status: "done" as const, charCount: r.text?.length }
          : { ...fs, status: "failed" as const, error: r.error ?? "Extraction failed" };
      }));
      setExtractedTexts(prev => {
        const next = { ...prev };
        results.forEach(r => { if (r.status === "done" && r.text) next[r.filename] = r.text; });
        return next;
      });
    } catch (e) {
      setFileStatuses(prev => prev.map(fs => files.some(f => f.name === fs.name) ? { ...fs, status: "failed" as const, error: (e as Error).message } : fs));
    }
    e.target.value = "";
  }

  function startPollForQueries(prevCount: number) {
    let elapsed = 0;
    pollRef.current = setInterval(async () => {
      elapsed += 2500;
      if (elapsed > 90_000) {
        clearInterval(pollRef.current!); pollRef.current = null;
        setIsParsing(false);
        setUploadErr("Parsing is taking longer than expected — refresh to check.");
        return;
      }
      try {
        const d = await fetch(`/api/proxy/api/v1/tender/prebid/${tenderId}`).then(r => r.json());
        if ((d?.queries ?? []).length > prevCount) {
          clearInterval(pollRef.current!); pollRef.current = null;
          setIsParsing(false); onQueriesParsed();
        }
      } catch { /* ignore */ }
    }, 2500);
  }

  async function handleUpload() {
    const doneFiles = fileStatuses.filter(f => f.status === "done");
    if (!doneFiles.length) return;
    setUploading(true); setUploadErr("");
    try {
      const texts = doneFiles.map(f => ({ filename: f.name, text: extractedTexts[f.name] }));
      const res = await fetch(`/api/proxy/api/v1/tender/prebid/${tenderId}/upload-queries`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texts }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      preUploadCount.current = currentQueryCount;
      setFileStatuses([]); setExtractedTexts({});
      setIsParsing(true); startPollForQueries(preUploadCount.current);
    } catch (e) { setUploadErr((e as Error).message); }
    setUploading(false);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Upload className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">Upload Query Sheet(s)</h3>
        {fileStatuses.length > 0 && <Badge className="text-xs">{fileStatuses.length} file{fileStatuses.length > 1 ? "s" : ""}</Badge>}
      </div>
      {uploadErr && <p className="text-xs text-red-400 bg-red-500/10 rounded p-2">{uploadErr}</p>}
      <input ref={fileInputRef} type="file" accept=".pdf,.docx" multiple className="hidden" onChange={handleFileChange} />
      <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => fileInputRef.current?.click()}>
        <Upload className="w-3 h-3" />Attach sheets (PDF · DOCX)
      </Button>
      {fileStatuses.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {fileStatuses.map(f => (
            <div key={f.name} className="flex items-center gap-1 px-2 py-1 rounded border border-border bg-muted/20 text-xs">
              {f.status === "extracting" && <Loader2 className="w-3 h-3 animate-spin text-blue-400" />}
              {f.status === "done" && <CheckCircle2 className="w-3 h-3 text-green-400" />}
              {f.status === "failed" && <AlertCircle className="w-3 h-3 text-red-400" />}
              <span className="max-w-[120px] truncate">{f.name}</span>
              {f.charCount && <span className="text-muted-foreground">({f.charCount.toLocaleString()} chars)</span>}
              {f.status === "done" && (
                <button onClick={() => setPreviewFile(previewFile === f.name ? null : f.name)} className="text-muted-foreground hover:text-foreground">
                  <Eye className="w-3 h-3" />
                </button>
              )}
              <button onClick={() => { setFileStatuses(p => p.filter(x => x.name !== f.name)); setExtractedTexts(p => { const n = { ...p }; delete n[f.name]; return n; }); }} className="text-muted-foreground hover:text-red-400"><X className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
      )}
      {isParsing && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin text-blue-400" />Parsing queries with AI…
        </div>
      )}
      {!isParsing && fileStatuses.some(f => f.status === "done") && (
        <Button size="sm" className="text-xs gap-1" disabled={uploading} onClick={handleUpload}>
          {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}Upload & Parse Queries
        </Button>
      )}
      {previewFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setPreviewFile(null)}>
          <div className="bg-card border border-border rounded-lg p-4 max-w-2xl w-full max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium">{previewFile}</span>
              <button onClick={() => setPreviewFile(null)}><X className="w-4 h-4" /></button>
            </div>
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap">{extractedTexts[previewFile]?.slice(0, 3000)}{(extractedTexts[previewFile]?.length ?? 0) > 3000 ? "\n…(truncated)" : ""}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
