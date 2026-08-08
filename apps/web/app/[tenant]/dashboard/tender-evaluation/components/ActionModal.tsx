"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface ActionModalProps {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    actionType: "accept" | "override" | "escalate";
    tenderId: string;
    findingId?: string;
    findingType: "pq" | "technical" | "financial";
    onSuccess: () => void;
}

const LABELS = {
    accept: "Accept Finding",
    override: "Override Finding",
    escalate: "Escalate to Senior Officer",
};

async function postAction(body: object) {
    const res = await fetch(`/api/proxy/api/v1/tender/findings/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? "Action failed");
    return res.json();
}

export function ActionModal({ open, onOpenChange, actionType, tenderId, findingId, findingType, onSuccess }: ActionModalProps) {
    const [rationale, setRationale] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const needsRationale = actionType === "override" || actionType === "escalate";

    async function submit() {
        if (needsRationale && !rationale.trim()) { setError("Rationale is required."); return; }
        setLoading(true); setError("");
        try {
            await postAction({
                tenderId, findingId, findingType,
                action: actionType,
                rationale: rationale.trim() || undefined,
                actorRole: "Evaluation Officer",
            });
            setRationale(""); onOpenChange(false); onSuccess();
        } catch (e) { setError(e instanceof Error ? e.message : "Action failed"); }
        finally { setLoading(false); }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{LABELS[actionType]}</DialogTitle>
                </DialogHeader>
                {needsRationale ? (
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-foreground">
                            Rationale <span className="text-red-400">*</span>
                        </label>
                        <Textarea
                            value={rationale}
                            onChange={e => setRationale(e.target.value)}
                            placeholder={
                                actionType === "escalate"
                                    ? "Reason for escalation to senior officer…"
                                    : "Reason for overriding this finding…"
                            }
                            rows={4}
                        />
                        {error && <p className="text-xs text-red-400">{error}</p>}
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">Accept this finding and log your decision in the audit trail.</p>
                )}
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={submit} disabled={loading}>
                        {loading ? "Submitting…" : LABELS[actionType]}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
