"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, AlertCircle, Lock, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { can } from "@/lib/permissions";
import { PermissionGate } from "@/components/platform/PermissionGate";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { AgentDetail } from "@/components/platform/agents/types";

interface LLMProvider {
    id: string;
    provider: string;
    model: string;
    displayName: string;
    isDefault: boolean;
    status: string;
}

interface LLMProvidersResponse {
    providers: LLMProvider[];
}

interface AgentSkill {
    id: string;
    name: string;
    systemPrompt: string;
    tools: string[];
    config: Record<string, unknown> | null;
    version: number;
    status: "active" | "archived";
}

interface SkillsResponse {
    data: AgentSkill[];
}

const typeColors: Record<string, string> = {
    ops: "bg-blue-500/10 text-blue-500",
    support: "bg-green-500/10 text-green-500",
    billing: "bg-purple-500/10 text-purple-500",
    custom: "bg-orange-500/10 text-orange-500",
};

const statusColors: Record<string, string> = {
    active: "bg-emerald-500/10 text-emerald-500",
    paused: "bg-yellow-500/10 text-yellow-500",
    retired: "bg-red-500/10 text-red-500",
};

export default function AgentDetailPage() {
    const params = useParams();
    const agentId = params.agentId as string;
    const tenantSlug = params.tenant as string;
    const queryClient = useQueryClient();
    const { permissions = [] } = useTenant();

    // Identity form state
    const [identityForm, setIdentityForm] = React.useState({
        name: "",
        description: "",
        avatarUrl: "",
    });
    const [isIdentityDirty, setIsIdentityDirty] = React.useState(false);

    // Prompt + tools state
    const [promptDraft, setPromptDraft] = React.useState("");
    const [isPromptDirty, setIsPromptDirty] = React.useState(false);
    const [webSearchEnabled, setWebSearchEnabled] = React.useState(false);

    const { data: agent, isLoading: isLoadingAgent, error: agentError } = useQuery({
        queryKey: ["agents", agentId],
        queryFn: () => api.get<AgentDetail>(`/api/v1/agents/${agentId}`),
    });

    const { data: providersData } = useQuery<LLMProvidersResponse>({
        queryKey: ["llm-providers"],
        queryFn: () => api.get<LLMProvidersResponse>("/api/v1/llm-providers"),
    });

    const { data: skillsData, isLoading: isLoadingSkills } = useQuery<SkillsResponse>({
        queryKey: ["agent-skills", agentId],
        queryFn: () => api.get<SkillsResponse>(`/api/v1/agents/${agentId}/skills`),
        enabled: !!agentId,
    });

    const providers = providersData?.providers || [];
    const existingSkill = skillsData?.data?.[0] ?? null;

    // Seed identity form from fetched agent
    React.useEffect(() => {
        if (agent) {
            setIdentityForm({
                name: agent.name ?? "",
                description: agent.description ?? "",
                avatarUrl: agent.avatarUrl ?? "",
            });
            setIsIdentityDirty(false);
        }
    }, [agent]);

    // Seed prompt + tools from fetched skill
    React.useEffect(() => {
        if (existingSkill) {
            setPromptDraft(existingSkill.systemPrompt ?? "");
            setWebSearchEnabled(existingSkill.tools?.includes("web_search") ?? false);
            setIsPromptDirty(false);
        }
    }, [existingSkill]);

    const updateIdentityMutation = useMutation({
        mutationFn: (values: { name: string; description: string; avatarUrl: string }) =>
            api.patch(`/api/v1/agents/${agentId}`, {
                name: values.name || undefined,
                description: values.description || null,
                avatarUrl: values.avatarUrl || null,
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["agents", agentId] });
            setIsIdentityDirty(false);
            toast.success("Agent updated");
        },
        onError: (error: any) => {
            toast.error(error.data?.message || error.message || "Failed to update agent");
        },
    });

    const saveSkillMutation = useMutation({
        mutationFn: ({ tools, systemPrompt }: { tools: string[]; systemPrompt: string }) => {
            const body = {
                name: existingSkill?.name ?? "default",
                systemPrompt,
                tools,
                config: existingSkill?.config ?? {},
            };
            if (existingSkill) {
                return api.put(`/api/v1/agents/${agentId}/skills/${existingSkill.id}`, body);
            }
            return api.post(`/api/v1/agents/${agentId}/skills`, body);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["agent-skills", agentId] });
            setIsPromptDirty(false);
            toast.success("Prompt saved");
        },
        onError: (error: any) => {
            toast.error(error.data?.message || error.message || "Failed to save prompt");
        },
    });

    const handleWebSearchToggle = (checked: boolean) => {
        setWebSearchEnabled(checked);
        const currentTools = existingSkill?.tools ?? ["retrieve_documents"];
        let newTools = [...currentTools];
        if (checked) {
            if (!newTools.includes("web_search")) newTools.push("web_search");
        } else {
            newTools = newTools.filter((t) => t !== "web_search");
        }
        saveSkillMutation.mutate({
            tools: newTools,
            systemPrompt: promptDraft || existingSkill?.systemPrompt || "",
        });
    };

    const handleSavePrompt = () => {
        const currentTools = existingSkill?.tools ?? ["retrieve_documents"];
        const newTools = [...currentTools];
        if (webSearchEnabled && !newTools.includes("web_search")) newTools.push("web_search");
        saveSkillMutation.mutate({ tools: newTools, systemPrompt: promptDraft });
    };

    const canUpdate = can(permissions, "agents", "update");

    const formattedDate = agent
        ? new Intl.DateTimeFormat("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
          }).format(new Date(agent.createdAt))
        : "";

    const resolvedModel =
        providers.find((p) => p.id === agent?.llmProviderId)?.displayName
        || providers.find((p) => p.isDefault)?.displayName
        || agent?.model
        || "Not set";

    // Avatar initials fallback
    const initials = (identityForm.name || agent?.name || "?")
        .split(" ")
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();

    if (agentError) {
        return (
            <PermissionGate resource="agents" action="read">
                <div className="space-y-6">
                    <Link
                        href={`/${tenantSlug}/dashboard/agents`}
                        className="flex items-center text-sm text-muted-foreground hover:text-foreground"
                    >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to Agents
                    </Link>
                    <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>Error</AlertTitle>
                        <AlertDescription>
                            Failed to load agent details. The agent might not exist or you don&apos;t have access.
                        </AlertDescription>
                    </Alert>
                </div>
            </PermissionGate>
        );
    }

    return (
        <PermissionGate resource="agents" action="read">
        <div className="space-y-8">

            {/* ── Header ───────────────────────────────────────────────────── */}
            <div className="space-y-3">
                <Link
                    href={`/${tenantSlug}/dashboard/agents`}
                    className="flex items-center text-sm text-muted-foreground hover:text-foreground w-fit"
                >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to Agents
                </Link>
                {isLoadingAgent ? (
                    <Skeleton className="h-8 w-48" />
                ) : (
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-bold tracking-tight">{agent?.name}</h1>
                        <Badge variant="secondary" className={typeColors[agent?.type || ""]}>
                            {agent?.type}
                        </Badge>
                        <Badge variant="outline" className={statusColors[agent?.status || ""]}>
                            {agent?.status}
                        </Badge>
                    </div>
                )}
            </div>

            {/* ── Section 1: Agent Identity ─────────────────────────────────── */}
            <Card>
                <CardContent className="pt-6">
                    <h3 className="text-sm font-semibold mb-4">Agent Identity</h3>
                    {isLoadingAgent ? (
                        <div className="space-y-4">
                            <Skeleton className="h-16 w-16 rounded-full" />
                            <Skeleton className="h-9 w-full" />
                            <Skeleton className="h-20 w-full" />
                        </div>
                    ) : (
                        <div className="space-y-5">
                            {/* Avatar */}
                            <div className="flex items-center gap-4">
                                <div className="h-14 w-14 shrink-0 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center">
                                    {identityForm.avatarUrl ? (
                                        <img
                                            src={identityForm.avatarUrl}
                                            alt={identityForm.name}
                                            className="h-full w-full object-cover"
                                            onError={(e) => {
                                                (e.target as HTMLImageElement).style.display = "none";
                                            }}
                                        />
                                    ) : (
                                        <span className="text-lg font-semibold text-primary">{initials}</span>
                                    )}
                                </div>
                                <div className="flex-1 space-y-1">
                                    <Label className="text-xs text-muted-foreground">Image URL</Label>
                                    <Input
                                        placeholder="https://example.com/avatar.png"
                                        value={identityForm.avatarUrl}
                                        onChange={(e) => {
                                            setIdentityForm((f) => ({ ...f, avatarUrl: e.target.value }));
                                            setIsIdentityDirty(true);
                                        }}
                                        disabled={!canUpdate}
                                        className="h-8 text-sm"
                                    />
                                </div>
                            </div>

                            {/* Name */}
                            <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">Name</Label>
                                <Input
                                    value={identityForm.name}
                                    onChange={(e) => {
                                        setIdentityForm((f) => ({ ...f, name: e.target.value }));
                                        setIsIdentityDirty(true);
                                    }}
                                    disabled={!canUpdate}
                                    placeholder="Agent name"
                                />
                            </div>

                            {/* Description */}
                            <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground">Description</Label>
                                <Textarea
                                    value={identityForm.description}
                                    onChange={(e) => {
                                        setIdentityForm((f) => ({ ...f, description: e.target.value }));
                                        setIsIdentityDirty(true);
                                    }}
                                    disabled={!canUpdate}
                                    placeholder="What does this agent do?"
                                    rows={3}
                                    className="resize-none text-sm"
                                />
                            </div>

                            {canUpdate && isIdentityDirty && (
                                <div className="flex justify-end">
                                    <Button
                                        size="sm"
                                        onClick={() => updateIdentityMutation.mutate(identityForm)}
                                        disabled={updateIdentityMutation.isPending || !identityForm.name.trim()}
                                    >
                                        {updateIdentityMutation.isPending && (
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        )}
                                        Save
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* ── Section 2: Info ───────────────────────────────────────────── */}
            <Card>
                <CardContent className="pt-6">
                    <h3 className="text-sm font-semibold mb-3">Info</h3>
                    {isLoadingAgent ? (
                        <div className="space-y-2">
                            <Skeleton className="h-4 w-48" />
                            <Skeleton className="h-4 w-40" />
                            <Skeleton className="h-4 w-44" />
                        </div>
                    ) : (
                        <dl className="space-y-2 text-sm">
                            <div className="flex gap-2">
                                <dt className="text-muted-foreground w-24 shrink-0">AI Model</dt>
                                <dd className="text-foreground">{resolvedModel}</dd>
                            </div>
                            <div className="flex gap-2">
                                <dt className="text-muted-foreground w-24 shrink-0">Created</dt>
                                <dd className="text-foreground">{formattedDate}</dd>
                            </div>
                            <div className="flex gap-2">
                                <dt className="text-muted-foreground w-24 shrink-0">Created by</dt>
                                <dd className="text-foreground">{agent?.createdByName ?? "Unknown"}</dd>
                            </div>
                        </dl>
                    )}
                </CardContent>
            </Card>

            {/* ── Section 3: General Prompt ─────────────────────────────────── */}
            <Card>
                <CardContent className="pt-6">
                    <div className="mb-4">
                        <h3 className="text-sm font-semibold">General Prompt</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            System instructions that shape this agent&apos;s behaviour on every conversation.
                        </p>
                    </div>
                    {isLoadingSkills ? (
                        <Skeleton className="h-32 w-full" />
                    ) : (
                        <div className="space-y-3">
                            <Textarea
                                value={promptDraft}
                                onChange={(e) => {
                                    setPromptDraft(e.target.value);
                                    setIsPromptDirty(true);
                                }}
                                placeholder="You are a helpful assistant..."
                                rows={6}
                                disabled={!canUpdate}
                                className="resize-none font-mono text-sm"
                            />
                            {canUpdate && isPromptDirty && (
                                <div className="flex justify-end">
                                    <Button
                                        size="sm"
                                        onClick={handleSavePrompt}
                                        disabled={saveSkillMutation.isPending}
                                    >
                                        {saveSkillMutation.isPending && (
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        )}
                                        Save Prompt
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* ── Section 4: Tools ──────────────────────────────────────────── */}
            <Card>
                <CardContent className="pt-6">
                    <div className="mb-4">
                        <h3 className="text-sm font-semibold">Tools</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Capabilities available to this agent during conversations.
                        </p>
                    </div>
                    <div className="space-y-3">
                        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/10 px-4 py-3">
                            <div className="space-y-0.5">
                                <p className="text-sm font-medium">Knowledge base</p>
                                <p className="text-xs text-muted-foreground">Search tenant documents via RAG</p>
                            </div>
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <Lock className="h-3.5 w-3.5" />
                                <span className="text-xs">Always on</span>
                            </div>
                        </div>
                        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/10 px-4 py-3">
                            <div className="space-y-0.5">
                                <p className="text-sm font-medium">Web search</p>
                                <p className="text-xs text-muted-foreground">Search the web for current information</p>
                            </div>
                            <Switch
                                checked={webSearchEnabled}
                                onCheckedChange={handleWebSearchToggle}
                                disabled={!canUpdate || saveSkillMutation.isPending || isLoadingSkills}
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

        </div>
        </PermissionGate>
    );
}
