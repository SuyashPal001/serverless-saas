"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel,
    AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
    AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Clock, CheckCircle2, Loader2, Trash2 } from "lucide-react";

interface TenderRow {
    id: string; rfpNumber: string; title: string; department: string;
    budget: string | null; status: string; authoringStatus: string | null;
    evalMethod: string; createdAt: string;
}

const STAGE_BADGE: Record<string, { label: string; color: string }> = {
    authoring:   { label: "Authoring",   color: "bg-violet-500/20 text-violet-300 border-violet-500/30" },
    draft:       { label: "Draft",       color: "bg-zinc-500/20 text-zinc-300 border-zinc-500/30" },
    published:   { label: "Published",   color: "bg-blue-500/20 text-blue-300 border-blue-500/30" },
    pre_bid:     { label: "Pre-Bid",     color: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
    evaluation:  { label: "Evaluation",  color: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" },
    awarded:     { label: "Awarded",     color: "bg-green-500/20 text-green-300 border-green-500/30" },
    cancelled:   { label: "Cancelled",   color: "bg-red-500/20 text-red-300 border-red-500/30" },
};

async function fetchTenderList(): Promise<TenderRow[]> {
    const res = await fetch("/api/proxy/api/v1/tender/list");
    if (!res.ok) return [];
    return res.json();
}

export default function TenderListPage() {
    const params = useParams();
    const router = useRouter();
    const queryClient = useQueryClient();
    const tenant = params.tenant as string;

    const { data: allRows = [], isLoading } = useQuery({ queryKey: ["tender-list"], queryFn: fetchTenderList });
    const [confirmRow, setConfirmRow] = useState<TenderRow | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const pendingWithYou = allRows.filter(r => r.status === "authoring" || r.status === "draft" || r.status === "evaluation");

    function openTender(id: string) {
        router.push(`/${tenant}/dashboard/tender-evaluation/${id}`);
    }

    async function confirmDelete() {
        if (!confirmRow) return;
        setIsDeleting(true);
        try {
            await fetch(`/api/proxy/api/v1/tender/evaluations/${confirmRow.id}`, { method: "DELETE" });
            await queryClient.invalidateQueries({ queryKey: ["tender-list"] });
        } finally {
            setIsDeleting(false);
            setConfirmRow(null);
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">Tenders</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        {allRows.length} tenders &nbsp;·&nbsp;
                        <span className="text-amber-400">{pendingWithYou.length} pending with you</span>
                    </p>
                </div>
                <Button onClick={() => router.push(`/${tenant}/dashboard/tender-evaluation/create`)}
                    className="bg-primary text-primary-foreground gap-2">
                    <Plus className="w-4 h-4" /> Create Tender
                </Button>
            </div>

            {isLoading && (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                </div>
            )}

            <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-border bg-muted/30">
                            <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">RFP No.</th>
                            <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Title</th>
                            <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Department</th>
                            <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Value</th>
                            <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Stage</th>
                            <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Pending</th>
                            <th className="w-10" />
                        </tr>
                    </thead>
                    <tbody>
                        {allRows.map((t) => {
                            const badge = STAGE_BADGE[t.status] ?? { label: t.status, color: "bg-muted/20 text-muted-foreground border-border" };
                            const isPending = t.status === "authoring" || t.status === "draft" || t.status === "evaluation";
                            return (
                                <tr key={t.id}
                                    onClick={() => openTender(t.id)}
                                    className="group border-b border-border/50 transition-colors cursor-pointer hover:bg-muted/20">
                                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{t.rfpNumber}</td>
                                    <td className="px-4 py-3 font-medium text-foreground max-w-xs truncate">{t.title}</td>
                                    <td className="px-4 py-3 text-muted-foreground text-xs">{t.department}</td>
                                    <td className="px-4 py-3 text-foreground">
                                        {t.budget ? `₹${(Number(t.budget) / 1e7).toFixed(1)} Cr` : "—"}
                                    </td>
                                    <td className="px-4 py-3">
                                        <Badge className={`${badge.color} border text-xs`}>{badge.label}</Badge>
                                    </td>
                                    <td className="px-4 py-3">
                                        {isPending ? (
                                            <span className="flex items-center gap-1 text-xs text-amber-400">
                                                <Clock className="w-3 h-3" /> You
                                            </span>
                                        ) : t.status === "awarded" ? (
                                            <span className="flex items-center gap-1 text-xs text-green-400">
                                                <CheckCircle2 className="w-3 h-3" /> Done
                                            </span>
                                        ) : null}
                                    </td>
                                    <td className="px-2 py-3">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setConfirmRow(t); }}
                                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400"
                                            title="Delete tender">
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                        {allRows.length === 0 && !isLoading && (
                            <tr>
                                <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                                    No tenders yet. Click <b>Create Tender</b> to draft your first RFP.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            <AlertDialog open={!!confirmRow} onOpenChange={(open) => { if (!open) setConfirmRow(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete tender {confirmRow?.rfpNumber}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This removes its RFP, findings, and bids permanently. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmDelete}
                            disabled={isDeleting}
                            className="bg-red-600 hover:bg-red-700 text-white">
                            {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
