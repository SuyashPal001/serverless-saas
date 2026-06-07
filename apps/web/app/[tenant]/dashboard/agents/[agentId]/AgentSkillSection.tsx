"use client";

import { Brain, Globe, FileSearch, CalendarClock, Network, Scale, ClipboardCheck, UserCheck, BarChart3, BookOpen, Building2, TrendingUp, ScrollText, ShieldCheck, MessageSquareQuote, GitCompare } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { AgentDetail } from "@/components/platform/agents/types";

interface AgentSkillSectionProps {
    agentId: string;
    isOwner: boolean;
    brandingEnabled: boolean;
    tenantSlug: string;
    agent: AgentDetail | undefined;
    isLoading: boolean;
}

function isSupervisor(name: string): boolean {
    const n = name.toLowerCase();
    return n.includes("pm") || (n.includes("product") && !n.includes("prd"));
}

function isParasAgent(name: string): boolean {
    const n = name.toLowerCase();
    return n.includes("paras") || n.includes("pension");
}

function isITRAgent(name: string): boolean {
    return name.toLowerCase().includes("itr");
}

function isSupplementaryAgent(name: string): boolean {
    const n = name.toLowerCase();
    return n.includes("supplementary");
}

function isCommercialAgent(name: string): boolean {
    const n = name.toLowerCase();
    return n.includes("commercial");
}

function isTenderAgent(name: string): boolean {
    const n = name.toLowerCase();
    return n.includes("authoring") || n.includes("document intelligence") ||
        n.includes("bid evaluation") || n.includes("procurement") ||
        n.includes("tender") || (n.includes("advisor") && !n.includes("paras"));
}

function tenderCapabilities(name: string): CapabilityItem[] {
    const n = name.toLowerCase();
    if (n.includes("authoring")) return [
        { icon: ScrollText, label: "Clause-library drafting", description: "Reuses your organisation's approved clauses (GFR-2017 compliant) and flags gaps" },
        { icon: BookOpen, label: "GFR-2017 structuring", description: "Generates all 8 sections: NIT, eligibility, scope, technical, SLA/KPI, BOQ, eval method, contract terms" },
        { icon: ShieldCheck, label: "CVC-safety flags", description: "Highlights provisions that deviate from CVC circulars before the document is exported" },
        { icon: UserCheck, label: "Versioned officer review", description: "Every section is versioned; officers accept or edit each before the RFP is finalised" },
    ];
    if (n.includes("document") || n.includes("intelligence")) return [
        { icon: FileSearch, label: "Multi-format OCR extraction", description: "Parses PDFs, Word, and scanned images — structured output from any bid document" },
        { icon: BookOpen, label: "Page-level provenance", description: "Every extracted value cites the exact source page — no hallucination, no inference beyond the doc" },
        { icon: ClipboardCheck, label: "Eligibility & BOQ parsing", description: "Extracts turnover, experience, certifications, and BOQ line items into structured tables" },
        { icon: ShieldCheck, label: "Fabrication-free guarantee", description: "Only reports what is in the document; missing data is flagged, not assumed" },
    ];
    if (n.includes("bid evaluation") || n.includes("evaluation")) return [
        { icon: ClipboardCheck, label: "Clause-wise compliance", description: "Marks each RFP clause as complied, deviation, or not-found with a cited narration" },
        { icon: FileSearch, label: "Cited findings", description: "Every finding linked to the exact source page in the bid document" },
        { icon: GitCompare, label: "Comparative evaluation", description: "Side-by-side compliance matrix across all bidders for officer comparison" },
        { icon: UserCheck, label: "Human owns the verdict", description: "Routes findings to the officer review queue; no autonomous award recommendation" },
    ];
    if (n.includes("advisor") || n.includes("procurement")) return [
        { icon: MessageSquareQuote, label: "RAG Q&A with citations", description: "Answers procurement queries grounded in your own tender documents with source references" },
        { icon: BarChart3, label: "Trade-off analysis", description: "Compares evaluation dimensions and flags risks in bid or RFP design" },
        { icon: ShieldCheck, label: "Never recommends a bidder", description: "Advisory output is advisory-only; award decisions remain with the officer" },
        { icon: ScrollText, label: "Audit-clean output", description: "Every answer is source-attributed and suitable for file noting" },
    ];
    return BASE_CAPABILITIES;
}

function tenderFallbackDescription(name: string): string {
    const n = name.toLowerCase();
    if (n.includes("authoring")) return "Drafts complete government RFPs from your requirement document and template fields. Structures all 8 GFR-2017 sections with your clause library, flags CVC-safety issues, and versions every section for officer review before export.";
    if (n.includes("document") || n.includes("intelligence")) return "Extracts structured data from uploaded bid documents — PDFs, Word, and scanned images — with page-level provenance. Never fabricates beyond what is in the document.";
    if (n.includes("bid evaluation") || n.includes("evaluation")) return "Evaluates bids clause-by-clause against the RFP with cited findings. Compares compliance across bidders and routes shortfalls for officer clarification. The officer owns the final verdict.";
    if (n.includes("advisor") || n.includes("procurement")) return "Answers procurement questions grounded in your tender documents with citations. Provides trade-off analysis and risk flags — never recommends a specific bidder.";
    return "A government procurement AI agent.";
}

function fallbackDescription(name: string): string {
    if (isTenderAgent(name)) return tenderFallbackDescription(name);
    const n = name.toLowerCase();
    if (isSupervisor(n)) {
        return "Orchestrates the full PM lifecycle — writes PRDs, generates roadmaps, and breaks milestones into engineering tasks by delegating to specialist agents. Use this when you want to plan and ship a feature end-to-end.";
    }
    if (n.includes("prd")) {
        return "Specialist agent for writing and refining Product Requirements Documents. Saves PRDs to your workspace so the roadmap agent can pick them up.";
    }
    if (n.includes("roadmap")) {
        return "Generates structured roadmaps with milestones from an approved PRD. Use after your PRD is ready.";
    }
    if (n.includes("task")) {
        return "Breaks approved milestones into concrete engineering tasks with acceptance criteria, priorities, and effort estimates.";
    }
    return "A general-purpose AI agent. Chat with it to search the web, analyse documents, and get work done.";
}

const BASE_CAPABILITIES = [
    { icon: Brain, label: "Conversation memory", description: "Remembers context across turns in the same session" },
    { icon: FileSearch, label: "Knowledge base", description: "Searches your uploaded documents via RAG" },
    { icon: Globe, label: "Web search", description: "Looks up live information from the internet" },
    { icon: CalendarClock, label: "Scheduled runs", description: "Can be triggered automatically on a cron schedule" },
];

const SUPERVISOR_CAPABILITY = {
    icon: Network,
    label: "Delegates to specialist agents",
    description: "Spins up PRD, Roadmap, and Task agents to handle each phase — you only talk to one agent",
};

const PARAS_CAPABILITIES = [
    { icon: FileSearch, label: "Pension document analysis", description: "Extracts fields from service books, PPO forms, and salary certificates" },
    { icon: Scale, label: "CCS Rules 1972 validation", description: "Validates qualifying service, pension formula, commutation ceiling, and DCRG" },
    { icon: ClipboardCheck, label: "Document completeness check", description: "Verifies all mandatory documents are present before scrutiny begins" },
    { icon: UserCheck, label: "Officer review routing", description: "Routes findings to Dealing Hand queue with full audit trail" },
];

const ITR_CAPABILITIES = [
    { icon: FileSearch, label: "Dual-document cross-reference", description: "Matches ITR declared figures against Assessment Order determinations line by line" },
    { icon: Scale, label: "IT Act rule engine", description: "Validates deductions, additions, and disallowances under applicable IT Act provisions" },
    { icon: BarChart3, label: "Risk scoring", description: "Ranks cases by materiality, appellate history, and year-on-year income variance" },
    { icon: ClipboardCheck, label: "Structured observations", description: "Every finding linked to the exact ITR schedule and AO paragraph" },
];

const SUPPLEMENTARY_CAPABILITIES = [
    { icon: BookOpen, label: "Multi-document reconciliation", description: "Cross-checks appropriation accounts, budget estimates, and supplementary demands" },
    { icon: BarChart3, label: "Anomaly detection", description: "Flags material misstatements, classification errors, and GFR 2017 deviations" },
    { icon: TrendingUp, label: "Multi-year trend analysis", description: "Tracks 5-year financial trajectories and flags sudden breaks from trend" },
    { icon: UserCheck, label: "Officer review routing", description: "All reconciliation findings route to the designated audit officer queue" },
];

const COMMERCIAL_CAPABILITIES = [
    { icon: Building2, label: "Audit universe management", description: "Tracks all PSUs, ABs, and ULBs with automated risk scoring per entity" },
    { icon: BarChart3, label: "Financial ratio analysis", description: "Liquidity, solvency, and profitability ratios benchmarked against sector norms" },
    { icon: ClipboardCheck, label: "GPFR preparation", description: "AI-drafted GPFR chapters with maker-checker review workflow and full audit trail" },
    { icon: Network, label: "Cross-domain linkages", description: "Flags findings relevant to ITR, compliance, and performance audit teams automatically" },
];

interface CapabilityItem {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    description: string;
}

export function AgentSkillSection({ agent, isLoading }: AgentSkillSectionProps) {
    const name = agent?.name ?? "";
    const description = agent?.description?.trim()
        ? agent.description
        : fallbackDescription(name);

    const capabilities: CapabilityItem[] = isTenderAgent(name)
        ? tenderCapabilities(name)
        : isParasAgent(name)
        ? PARAS_CAPABILITIES
        : isITRAgent(name)
        ? ITR_CAPABILITIES
        : isSupplementaryAgent(name)
        ? SUPPLEMENTARY_CAPABILITIES
        : isCommercialAgent(name)
        ? COMMERCIAL_CAPABILITIES
        : isSupervisor(name)
        ? [SUPERVISOR_CAPABILITY, ...BASE_CAPABILITIES]
        : BASE_CAPABILITIES;

    return (
        <>
            <Card>
                <CardContent className="pt-6 space-y-3">
                    <div>
                        <h3 className="text-sm font-semibold">About this agent</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            What this agent does and when to use it.
                        </p>
                    </div>
                    {isLoading ? (
                        <div className="space-y-2">
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-4 w-4/5" />
                            <Skeleton className="h-4 w-3/5" />
                        </div>
                    ) : (
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            {description}
                        </p>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardContent className="pt-6 space-y-3">
                    <div>
                        <h3 className="text-sm font-semibold">Capabilities</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            What this agent can do during a conversation.
                        </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {capabilities.map(({ icon: Icon, label, description: cap }) => (
                            <div
                                key={label}
                                className="flex items-start gap-3 rounded-lg border border-border bg-muted/10 px-4 py-3"
                            >
                                <Icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                                <div className="space-y-0.5">
                                    <p className="text-sm font-medium">{label}</p>
                                    <p className="text-xs text-muted-foreground">{cap}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </>
    );
}
