"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle, XCircle, AlertTriangle, Play } from "lucide-react";

interface DocumentCheckResult {
  id: string;
  checkType: "structural" | "clause_conflict";
  ruleId: string;
  status: "pass" | "fail" | "flagged";
  sectionNo: string | null;
  message: string;
  createdAt: string;
}

async function apiPost(path: string, body?: object) {
  const res = await fetch(`/api/proxy/api/v1${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json();
}

export function DocumentCheckPanel({ tenderId }: { tenderId: string }) {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["document-check", tenderId],
    queryFn: () => fetch(`/api/proxy/api/v1/tender/${tenderId}/document-check`).then(r => r.json()),
  });

  const results: DocumentCheckResult[] = data?.results ?? [];
  const structural = results.filter(r => r.checkType === "structural");
  const conflicts = results.filter(r => r.checkType === "clause_conflict");

  async function handleRun() {
    setRunning(true); setErr("");
    try {
      await apiPost(`/tender/${tenderId}/document-check/run`);
      qc.invalidateQueries({ queryKey: ["document-check", tenderId] });
    } catch (e) { setErr((e as Error).message); }
    setRunning(false);
  }

  if (isLoading) return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin" />Loading document checks…</div>;

  return (
    <div className="space-y-4">
      {err && <p className="text-xs text-red-400 bg-red-500/10 rounded p-2">{err}</p>}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Structural completeness and clause-conflict checks against the authored RFP.
        </p>
        <Button size="sm" className="text-xs gap-1" disabled={running} onClick={handleRun}>
          {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          {running ? "Running…" : "Run Check"}
        </Button>
      </div>

      {results.length === 0 && (
        <p className="text-xs text-muted-foreground">No checks run yet. Click &quot;Run Check&quot; to validate this tender&apos;s RFP sections.</p>
      )}

      {structural.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">Section Completeness</h3>
          <ul className="space-y-1">
            {structural.map(r => (
              <li key={r.id} className="flex items-center gap-2 text-xs">
                {r.status === "pass"
                  ? <CheckCircle className="w-3.5 h-3.5 text-green-400 shrink-0" />
                  : <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                <span className={r.status === "pass" ? "text-muted-foreground" : "text-red-400"}>
                  {r.sectionNo ? `${r.sectionNo}: ` : ""}{r.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Clause Conflicts Flagged</h3>
          {conflicts.map(r => (
            <div key={r.id} className="flex items-start gap-2 p-2 rounded-lg border border-amber-500/20 bg-amber-500/5 text-xs">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <span className="text-foreground">{r.sectionNo ? `${r.sectionNo}: ` : ""}{r.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
