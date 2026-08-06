"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileSignature, Download } from "lucide-react";

interface Contract {
  id: string; version: number; status: string;
  contractorName: string; contractorDisplayLabel: string; contractorContactEmail: string | null;
  contractValue: string;
  sections: Array<{ sectionNo: string; title: string; text: string }>;
  generatedAt: string;
}

function crFmt(rupees: number) { return `₹${(rupees / 1e7).toFixed(2)} Cr`; }

export function ContractPanel({ tenderId }: { tenderId: string }) {
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState("");
  const [notReady, setNotReady] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["contract", tenderId],
    queryFn: () => fetch(`/api/proxy/api/v1/tender/${tenderId}/contract`).then(r => r.json()),
  });

  const contracts: Contract[] = data?.contracts ?? [];
  const latest = contracts[0];

  async function handleGenerate() {
    setGenerating(true); setErr(""); setNotReady(false);
    try {
      const res = await fetch(`/api/proxy/api/v1/tender/${tenderId}/contract/generate`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) { setNotReady(true); return; }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      qc.invalidateQueries({ queryKey: ["contract", tenderId] });
    } catch (e) { setErr((e as Error).message); }
    setGenerating(false);
  }

  function handleDownload(contractId: string) {
    window.open(`/api/proxy/api/v1/tender/${tenderId}/contract/${contractId}/export`, "_blank");
  }

  if (isLoading) return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin" />Loading contracts…</div>;

  return (
    <div className="space-y-6">
      {err && <p className="text-xs text-red-400 bg-red-500/10 rounded p-2">{err}</p>}
      {notReady && <p className="text-xs text-amber-400 bg-amber-500/10 rounded p-2">This tender doesn't have an awarded bidder yet — complete financial evaluation first.</p>}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <FileSignature className="w-4 h-4 text-emerald-400" />Contract / Purchase Order
        </h3>
        <Button size="sm" disabled={generating} onClick={handleGenerate} className="text-xs gap-1">
          {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : "Generate Contract"}
        </Button>
      </div>

      {contracts.length === 0 && !notReady && <p className="text-xs text-muted-foreground">No contract generated yet.</p>}

      {latest && (
        <div className="p-4 rounded-lg border border-border bg-card space-y-3">
          <div className="flex items-center justify-between">
            <Badge className="text-xs">v{latest.version}</Badge>
            <Button size="sm" variant="outline" className="text-xs gap-1" onClick={() => handleDownload(latest.id)}>
              <Download className="w-3 h-3" />Download Word
            </Button>
          </div>
          <p className="text-xs text-foreground">
            Contractor: {latest.contractorName} ({latest.contractorDisplayLabel}) — {crFmt(Number(latest.contractValue))}
          </p>
          <p className="text-xs text-muted-foreground">{latest.contractorContactEmail ?? "No contact on file"}</p>
          <div className="space-y-1">
            {latest.sections.map(s => (
              <div key={s.sectionNo} className="text-xs">
                <span className="font-medium text-gray-300">{s.sectionNo}. {s.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {contracts.length > 1 && (
        <div className="space-y-1">
          <h4 className="text-xs font-medium text-gray-300">Previous Versions</h4>
          {contracts.slice(1).map(c => (
            <div key={c.id} className="flex items-center justify-between text-xs text-muted-foreground">
              <span>v{c.version} — {new Date(c.generatedAt).toLocaleString()}</span>
              <Button size="sm" variant="ghost" className="text-xs h-6" onClick={() => handleDownload(c.id)}>
                <Download className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
