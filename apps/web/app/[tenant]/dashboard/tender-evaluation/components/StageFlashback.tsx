"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, MessageSquare, GitBranch } from "lucide-react";

const CORRIGENDUM = {
    no: "Corrigendum No. 1",
    date: "2024-11-18",
    summary: "Extended bid submission deadline by 15 days. Clarified Clause 3.9 response time measurement methodology.",
    changes: [
        { clause: "1.6", from: "Bid submission: 03 December 2024", to: "Bid submission: 18 December 2024" },
        { clause: "3.9", from: "Response time < 2s for all transactions", to: "Response time < 2s for 95% of transactions under normal load (≤ 100 concurrent users)" },
    ],
};

const PREBID_QUERIES = [
    {
        no: "Q-001",
        query: "Can biometric integration be proposed via API rather than direct SDK?",
        response: "Yes, API-based integration is acceptable provided it uses a non-proprietary standard protocol. Please specify the protocol in your technical bid.",
    },
    {
        no: "Q-002",
        query: "Is cloud hosting acceptable or must servers be on-premises?",
        response: "Cloud hosting on MeitY-empanelled CSPs is acceptable. Data must remain within India.",
    },
    {
        no: "Q-003",
        query: "Can training be delivered via e-learning for admin users?",
        response: "Classroom training is mandatory for all 200 end-users as per Clause 3.12. E-learning may supplement but cannot replace classroom training for the base requirement.",
    },
];

export function Stage1Flashback() {
    return (
        <Card className="border-border/50 bg-card/50">
            <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <GitBranch className="w-4 h-4" />
                    Stage 1 — Tender Authoring (Assisted)
                    <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 border text-xs ml-auto">v1 → v2</Badge>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                    This tender was drafted using the platform's clause library. AI assisted in formulating PQ criteria thresholds,
                    SLA definitions, and the evaluation methodology. Version control tracked every change from initial draft (v1) to
                    published RFP (v2).
                </p>
                <div className="grid grid-cols-3 gap-3">
                    {[
                        { label: "PQ Clauses", value: "4 criteria" },
                        { label: "Tech Clauses", value: "8 clauses" },
                        { label: "BOQ Items", value: "4 line items" },
                    ].map(item => (
                        <div key={item.label} className="p-2 rounded bg-muted/20 border border-border/30 text-center">
                            <p className="text-xs text-muted-foreground">{item.label}</p>
                            <p className="text-sm font-semibold text-foreground">{item.value}</p>
                        </div>
                    ))}
                </div>
                <div className="flex items-center gap-2">
                    <FileText className="w-3 h-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">8 technical clauses structured from clause library · Eligibility criteria AI-drafted · BOQ template generated</span>
                </div>
            </CardContent>
        </Card>
    );
}

export function Stage2Flashback() {
    return (
        <Card className="border-border/50 bg-card/50">
            <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <MessageSquare className="w-4 h-4" />
                    Stage 2 — Pre-Bid Query Management & Corrigendum
                    <Badge className="bg-purple-500/10 text-purple-400 border-purple-500/20 border text-xs ml-auto">
                        {PREBID_QUERIES.length} queries · 1 corrigendum
                    </Badge>
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Corrigendum */}
                <div className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-amber-400">{CORRIGENDUM.no}</span>
                        <span className="text-xs text-muted-foreground">{CORRIGENDUM.date}</span>
                    </div>
                    <p className="text-xs text-foreground mb-2">{CORRIGENDUM.summary}</p>
                    <div className="space-y-1">
                        {CORRIGENDUM.changes.map(ch => (
                            <div key={ch.clause} className="text-xs text-muted-foreground">
                                <span className="font-mono text-amber-400">Cl {ch.clause}:</span>{" "}
                                <span className="line-through opacity-60">{ch.from.substring(0, 40)}…</span>{" "}→{" "}
                                <span className="text-foreground">{ch.to.substring(0, 40)}…</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Pre-bid queries */}
                <div className="space-y-2">
                    {PREBID_QUERIES.map(q => (
                        <div key={q.no} className="p-3 rounded-lg border border-border/30 bg-muted/10">
                            <div className="flex items-start gap-2">
                                <span className="text-xs font-mono text-muted-foreground mt-0.5">{q.no}</span>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs text-foreground">{q.query}</p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        <span className="text-green-400 font-medium">Response: </span>
                                        {q.response}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
