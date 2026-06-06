"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Bot, Loader2, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface AgentTemplate {
    id: string;
    name: string;
    description: string | null;
    model: string | null;
}

interface TemplatesResponse {
    data: AgentTemplate[];
}

export function AgentTemplatePicker() {
    const queryClient = useQueryClient();

    const { data, isLoading } = useQuery<TemplatesResponse>({
        queryKey: ["agent-templates"],
        queryFn: () => api.get<TemplatesResponse>("/api/v1/agents/templates"),
    });

    const activate = useMutation({
        mutationFn: (templateId: string) =>
            api.post("/api/v1/agents/from-template", { templateId }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["agents"] });
            toast.success("Agent activated successfully");
        },
        onError: (err: any) => {
            const msg = err.data?.error;
            toast.error(typeof msg === "string" ? msg : "Failed to activate agent");
        },
    });

    if (isLoading) {
        return (
            <div className="flex h-[350px] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const templates = data?.data ?? [];

    if (templates.length === 0) {
        return (
            <div className="flex h-[350px] items-center justify-center rounded-xl border border-dashed border-border bg-muted/20">
                <div className="text-center">
                    <Bot className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
                    <p className="text-sm text-muted-foreground">No agent templates available. Contact your platform admin.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <p className="text-sm text-muted-foreground">Choose an agent to activate for your workspace</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {templates.map((template) => (
                    <Card key={template.id} className="border-border hover:border-primary/40 transition-colors">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-lg">{template.name}</CardTitle>
                            {template.description && (
                                <CardDescription>{template.description}</CardDescription>
                            )}
                        </CardHeader>
                        <CardContent>
                            {template.model && (
                                <p className="text-xs text-muted-foreground mb-4">Model: {template.model}</p>
                            )}
                            <Button
                                className="w-full"
                                onClick={() => activate.mutate(template.id)}
                                disabled={activate.isPending}
                            >
                                {activate.isPending ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : null}
                                Activate
                            </Button>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
}
