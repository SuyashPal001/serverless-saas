"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ClipboardCheck, CheckCircle2, XCircle } from "lucide-react";

const APPROVER_ROLES = ["Reviewing Officer", "Approving Authority"] as const;

interface ApprovalStep {
  id: string; stepOrder: number; approverRole: string;
  status: "pending" | "approved" | "rejected";
  comment: string | null; signatureRef: string | null;
  createdAt: string; actionedAt: string | null;
}

interface ApprovalPanelProps {
  tenderId: string;
  contractId: string | null; // null when no contract has been generated yet
}

export function ApprovalPanel({ tenderId, contractId }: ApprovalPanelProps) {
  const qc = useQueryClient();
  const [role, setRole] = useState<string>(APPROVER_ROLES[0]);
  const [comment, setComment] = useState("");
  const [signatureRef, setSignatureRef] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [acting, setActing] = useState(false);
  const [err, setErr] = useState("");
  const [notActionable, setNotActionable] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["approval-chain", tenderId, contractId],
    queryFn: () =>
      contractId
        ? fetch(`/api/proxy/api/v1/tender/${tenderId}/approval/chain/contract/${contractId}`).then(r => r.json())
        : Promise.resolve({ steps: [] }),
    enabled: !!contractId,
  });

  const steps: ApprovalStep[] = data?.steps ?? [];
  const currentStep = steps.find(s => s.status === "pending" && !steps.some(other => other.stepOrder < s.stepOrder && other.status !== "approved"));

  async function handleSubmit() {
    if (!contractId) return;
    setSubmitting(true); setErr("");
    try {
      const res = await fetch(`/api/proxy/api/v1/tender/${tenderId}/approval/submit`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceType: "contract", resourceId: contractId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      qc.invalidateQueries({ queryKey: ["approval-chain", tenderId, contractId] });
    } catch (e) { setErr((e as Error).message); }
    finally { setSubmitting(false); }
  }

  async function handleAct(action: "approve" | "reject") {
    if (!currentStep) return;
    setActing(true); setErr(""); setNotActionable(false);
    try {
      const res = await fetch(`/api/proxy/api/v1/tender/${tenderId}/approval/act`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId: currentStep.id, action, approverRole: role, comment: comment || undefined, signatureRef: signatureRef || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) { setNotActionable(true); return; }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setComment(""); setSignatureRef("");
      qc.invalidateQueries({ queryKey: ["approval-chain", tenderId, contractId] });
    } catch (e) { setErr((e as Error).message); }
    finally { setActing(false); }
  }

  if (!contractId) {
    return <p className="text-xs text-muted-foreground">Generate a contract first to start the approval routing.</p>;
  }
  if (isLoading) return <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin" />Loading approval chain…</div>;

  return (
    <div className="space-y-6">
      {err && <p className="text-xs text-red-400 bg-red-500/10 rounded p-2">{err}</p>}
      {notActionable && <p className="text-xs text-amber-400 bg-amber-500/10 rounded p-2">This step is no longer actionable — it may have already been decided. Refreshing…</p>}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-indigo-400" />Approval Routing
        </h3>
        {steps.length === 0 && (
          <Button size="sm" disabled={submitting} onClick={handleSubmit} className="text-xs gap-1">
            {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Submit for Approval"}
          </Button>
        )}
      </div>

      {steps.length > 0 && (
        <div className="space-y-2">
          {steps.map(s => (
            <div key={s.id} className="p-3 rounded-lg border border-border bg-card flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-medium text-gray-300">{s.stepOrder}. {s.approverRole}</span>
                  {s.status === "approved" && <Badge className="bg-green-500/20 text-green-400 border-green-500/30 border text-[10px]"><CheckCircle2 className="w-3 h-3 mr-1" />Approved</Badge>}
                  {s.status === "rejected" && <Badge className="bg-red-500/20 text-red-400 border-red-500/30 border text-[10px]"><XCircle className="w-3 h-3 mr-1" />Rejected</Badge>}
                  {s.status === "pending" && <Badge variant="outline" className="text-[10px]">Pending</Badge>}
                </div>
                {s.comment && <p className="text-xs text-muted-foreground mt-1">{s.comment}</p>}
                {s.signatureRef && <p className="text-[10px] text-muted-foreground mt-1">Signature ref (unverified): {s.signatureRef}</p>}
                <p className="text-[10px] text-muted-foreground mt-1">
                  Arrived {new Date(s.createdAt).toLocaleString()}{s.actionedAt ? ` · Decided ${new Date(s.actionedAt).toLocaleString()}` : ""}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {currentStep && (
        <div className="p-4 rounded-lg border border-indigo-500/30 bg-indigo-500/5 space-y-2">
          <p className="text-xs text-foreground">Act as:</p>
          <select className="text-xs bg-background border border-border rounded px-2 py-1" value={role} onChange={e => setRole(e.target.value)}>
            {APPROVER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <textarea
            className="w-full text-xs bg-background border border-border rounded px-2 py-1 min-h-[50px]"
            placeholder="Comment (optional)" value={comment} onChange={e => setComment(e.target.value)}
          />
          <input
            className="w-full text-xs bg-background border border-border rounded px-2 py-1"
            placeholder="Signature reference (not a verified digital signature)"
            value={signatureRef} onChange={e => setSignatureRef(e.target.value)}
          />
          <div className="flex gap-2">
            <Button size="sm" disabled={acting} onClick={() => handleAct("approve")} className="text-xs gap-1 bg-green-600 hover:bg-green-700">
              {acting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Approve"}
            </Button>
            <Button size="sm" variant="destructive" disabled={acting} onClick={() => handleAct("reject")} className="text-xs gap-1">
              Reject
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
