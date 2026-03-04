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
    onSuccess: () => void;
}

export function CreateAgentForm({ onSuccess }: CreateAgentFormProps) {
    const { tenantId } = useTenant();
    const queryClient = useQueryClient();

    const form = useForm<AgentFormValues>({
        resolver: zodResolver(agentSchema),
        defaultValues: {
            name: "",
            type: "ops",
            model: "gpt-4o",
        },
    });

    const createMutation = useMutation({
        mutationFn: (values: AgentFormValues) => {
            return api.post("/api/v1/agents", values);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["agents", tenantId] });
            toast.success("Agent created successfully");
            form.reset();
            onSuccess();
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
                            <FormLabel>Agent Name</FormLabel>
                            <FormControl>
                                <Input placeholder="e.g. Support Bot" {...field} />
                            </FormControl>
                            <FormDescription>
                                A unique name for your agent.
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Agent Type</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl>
                                    <SelectTrigger>
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

                <FormField
                    control={form.control}
                    name="model"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Model</FormLabel>
                            <FormControl>
                                <Input placeholder="e.g. gpt-4o" {...field} />
                            </FormControl>
                            <FormDescription>
                                The underlying LLM model.
                            </FormDescription>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <div className="flex justify-end pt-4">
                    <Button
                        type="submit"
                        disabled={createMutation.isPending}
                        className="w-full"
                    >
                        {createMutation.isPending ? "Creating..." : "Create Agent"}
                    </Button>
                </div>
            </form>
        </Form>
    );
}
