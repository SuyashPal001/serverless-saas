"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
    FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { agentSchema, type AgentFormValues } from "./types";

interface CreateAgentFormProps {
    onSuccess: (data: { agent: any; apiKey: string }) => void;
}

export function CreateAgentForm({ onSuccess }: CreateAgentFormProps) {
    const { tenantId } = useTenant();
    const queryClient = useQueryClient();

    const form = useForm<AgentFormValues>({
        resolver: zodResolver(agentSchema),
        defaultValues: {
            name: "",
            type: "ops",
        },
    });

    const createMutation = useMutation({
        mutationFn: (values: AgentFormValues) => {
            return api.post<{ data: { agent: any; apiKey: string } }>("/api/v1/agents", values);
        },
        onSuccess: (res) => {
            queryClient.invalidateQueries({ queryKey: ["agents", tenantId] });
            toast.success("Agent created successfully");
            onSuccess(res.data);
        },
        onError: (error: any) => {
            toast.error(error.data?.message || error.message || "Failed to create agent");
        },
    });

    function onSubmit(data: AgentFormValues) {
        createMutation.mutate(data);
    }

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
                <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Agent Name</FormLabel>
                            <FormControl>
                                <Input placeholder="e.g. Support Bot" {...field} className="bg-muted/50" />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Agent Type</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                    <SelectTrigger className="bg-muted/50">
                                        <SelectValue placeholder="Select a type" />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    <SelectItem value="ops">Operations</SelectItem>
                                    <SelectItem value="support">Support</SelectItem>
                                    <SelectItem value="billing">Billing</SelectItem>
                                    <SelectItem value="custom">Custom</SelectItem>
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <div className="flex justify-end pt-4">
                    <Button
                        type="submit"
                        disabled={createMutation.isPending}
                        className="w-full font-semibold"
                    >
                        {createMutation.isPending ? "Creating..." : "Create Agent"}
                    </Button>
                </div>
            </form>
        </Form>
    );
}
