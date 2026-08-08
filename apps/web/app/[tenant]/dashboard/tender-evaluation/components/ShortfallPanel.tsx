"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, FileText, Clock } from "lucide-react";

interface Shortfall {
    id: string; discrepancy: string;
    sourceDoc: string | null; sourcePage: number | null;
    status: string; bidderId: string;
}

interface ClarificationRequest {
    id: string; shortfallId: string | null; bidderId: string;
    draftedText: string; deadlineDays: number;
    sentAt: string | null; responseText: string | null;
}

interface Bidder {
    id: string; name: string; displayLabel: string;
}

interface ShortfallPanelProps {
    bidders: Bidder[];
    shortfalls: Shortfall[];
    clarificationRequests: ClarificationRequest[];
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
    open: { label: "Open", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
    clarification_sent: { label: "Clarification Sent", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
    response_received: { label: "Response Received", color: "bg-green-500/20 text-green-400 border-green-500/30" },
    closed: { label: "Closed", color: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30" },
};

export function ShortfallPanel({ bidders, shortfalls, clarificationRequests }: ShortfallPanelProps) {
    const [selectedBidderId, setSelectedBidderId] = useState(bidders[0]?.id ?? "");
    const bidderMap = new Map(bidders.map(b => [b.id, b]));
    const crByShortfall = new Map(clarificationRequests.map(cr => [cr.shortfallId, cr]));

    const filtered = selectedBidderId
        ? shortfalls.filter(sf => sf.bidderId === selectedBidderId)
        : shortfalls;

    if (!shortfalls.length) {
        return (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
                No shortfalls detected. All qualified bidders addressed RFP requirements.
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
                System-identified discrepancies in bidder submissions. Auto-drafted clarification requests follow CVC guidelines:
                time-bound, no substance change, no price modification.
            </p>

            {/* Bidder selector — only when multiple bidders */}
            {bidders.length > 1 && (
                <div className="flex gap-1 flex-wrap">
                    {bidders.map(b => (
                        <button key={b.id} onClick={() => setSelectedBidderId(b.id)}
                            className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${b.id === selectedBidderId ? "bg-primary/20 text-primary border-primary/30" : "text-muted-foreground border-border hover:text-foreground hover:border-border/80"}`}>
                            {b.displayLabel}: {b.name}
                        </button>
                    ))}
                </div>
            )}

            {filtered.length === 0 && shortfalls.length > 0 && (
                <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                    No shortfalls for this bidder.
                </div>
            )}

            {filtered.map(sf => {
                const bidder = bidderMap.get(sf.bidderId);
                const cr = crByShortfall.get(sf.id);
                const sfStatus = STATUS_CONFIG[sf.status] ?? STATUS_CONFIG.open;

                return (
                    <Card key={sf.id} className="border-border bg-card">
                        <CardHeader className="pb-2">
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                                    <AlertCircle className="w-4 h-4 text-amber-400" />
                                    {bidder?.displayLabel} — {bidder?.name}
                                </CardTitle>
                                <Badge className={`${sfStatus.color} border text-xs`}>{sfStatus.label}</Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div>
                                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">Shortfall</p>
                                <p className="text-sm text-foreground">{sf.discrepancy}</p>
                            </div>

                            {sf.sourceDoc && (
                                <div className="flex items-center gap-1 text-xs text-blue-400">
                                    <FileText className="w-3 h-3" />
                                    <span>Source: {sf.sourceDoc}{sf.sourcePage ? `, p.${sf.sourcePage}` : ""}</span>
                                </div>
                            )}

                            {cr && (
                                <div className="p-3 rounded-lg border border-border/40 bg-muted/10 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs font-medium text-foreground uppercase tracking-wide">
                                            Auto-Drafted Clarification Request (CVC-clean)
                                        </p>
                                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                            <Clock className="w-3 h-3" />
                                            <span>{cr.deadlineDays} working days deadline</span>
                                        </div>
                                    </div>
                                    <blockquote className="border-l-2 border-amber-500/40 pl-3 text-sm text-foreground italic">
                                        {cr.draftedText}
                                    </blockquote>
                                    {cr.responseText ? (
                                        <div className="pt-2 border-t border-border/40">
                                            <p className="text-xs font-medium text-green-400 mb-1">Bidder Response</p>
                                            <p className="text-sm text-foreground">{cr.responseText}</p>
                                        </div>
                                    ) : (
                                        <p className="text-xs text-muted-foreground">Awaiting bidder response within {cr.deadlineDays} working days.</p>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                );
            })}
        </div>
    );
}
