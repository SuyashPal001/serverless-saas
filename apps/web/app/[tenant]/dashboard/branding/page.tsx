"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
    CardFooter,
} from "@/components/ui/card";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Palette, Image as ImageIcon, Type } from "lucide-react";

const hexColorSchema = z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, "Invalid hex color");

const brandingFormSchema = z.object({
    brandName: z.string().max(100).optional().nullable(),
    brandColor: hexColorSchema.or(z.string().length(0)).optional().nullable(),
    logoUrl: z.string().url().or(z.string().length(0)).optional().nullable(),
});

type BrandingFormValues = z.infer<typeof brandingFormSchema>;

export default function BrandingPage() {
    const queryClient = useQueryClient();

    const { data: brandingData, isLoading } = useQuery({
        queryKey: ["branding"],
        queryFn: async () => {
            const res = await api.get<{ data: BrandingFormValues }>("/api/v1/branding");
            return res.data;
        },
    });

    const form = useForm<BrandingFormValues>({
        resolver: zodResolver(brandingFormSchema),
        defaultValues: {
            brandName: "",
            brandColor: "#000000",
            logoUrl: "",
        },
    });

    useEffect(() => {
        if (brandingData) {
            form.reset({
                brandName: brandingData.brandName || "",
                brandColor: brandingData.brandColor || "#000000",
                logoUrl: brandingData.logoUrl || "",
            });
        }
    }, [brandingData, form]);

    const updateBranding = useMutation({
        mutationFn: async (values: BrandingFormValues) => {
            // Convert empty strings to null for the API
            const payload = {
                brandName: values.brandName || null,
                brandColor: values.brandColor || null,
                logoUrl: values.logoUrl || null,
            };
            return api.patch("/api/v1/branding", payload);
        },
        onSuccess: () => {
            toast.success("Branding updated successfully");
            queryClient.invalidateQueries({ queryKey: ["branding"] });
        },
        onError: (error: any) => {
            toast.error(error.message || "Failed to update branding");
        },
    });

    function onSubmit(values: BrandingFormValues) {
        updateBranding.mutate(values);
    }

    if (isLoading) {
        return (
            <div className="space-y-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Branding</h1>
                    <p className="text-muted-foreground">Manage your workspace identity and appearance.</p>
                </div>
                <Card>
                    <CardHeader>
                        <Skeleton className="h-6 w-1/4" />
                        <Skeleton className="h-4 w-1/2" />
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Branding</h1>
                <p className="text-muted-foreground">Manage your workspace identity and appearance.</p>
            </div>

            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Type className="h-5 w-5" />
                                    Identity
                                </CardTitle>
                                <CardDescription>
                                    Set the name and persona for your workspace.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <FormField
                                    control={form.control}
                                    name="brandName"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Brand Name</FormLabel>
                                            <FormControl>
                                                <Input placeholder="e.g. Acme Corp" {...field} value={field.value || ""} />
                                            </FormControl>
                                            <FormDescription>
                                                The name of your organization or project.
                                            </FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Palette className="h-5 w-5" />
                                    Appearance
                                </CardTitle>
                                <CardDescription>
                                    Customize colors and logos for your platform.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <FormField
                                    control={form.control}
                                    name="brandColor"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Brand Color</FormLabel>
                                            <div className="flex gap-2">
                                                <FormControl>
                                                    <Input 
                                                        type="color" 
                                                        className="w-12 h-10 p-1 cursor-pointer" 
                                                        {...field} 
                                                        value={field.value || "#000000"} 
                                                    />
                                                </FormControl>
                                                <FormControl>
                                                    <Input 
                                                        placeholder="#000000" 
                                                        {...field} 
                                                        value={field.value || ""} 
                                                        onChange={(e) => field.onChange(e.target.value)}
                                                    />
                                                </FormControl>
                                            </div>
                                            <FormDescription>
                                                Primary color used for buttons and accents.
                                            </FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="logoUrl"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Logo URL</FormLabel>
                                            <FormControl>
                                                <div className="flex gap-2">
                                                    <Input placeholder="https://..." {...field} value={field.value || ""} />
                                                    {field.value && (
                                                        <div className="h-10 w-10 shrink-0 border rounded-md flex items-center justify-center bg-muted">
                                                            <img 
                                                                src={field.value} 
                                                                alt="Preview" 
                                                                className="max-h-8 max-w-8 object-contain"
                                                                onError={(e) => {
                                                                    (e.target as HTMLImageElement).src = "";
                                                                }}
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                            </FormControl>
                                            <FormDescription>
                                                URL to your square logo image (PNG, SVG, or JPG).
                                            </FormDescription>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </CardContent>
                        </Card>
                    </div>

                    <div className="flex justify-end">
                        <Button type="submit" disabled={updateBranding.isPending}>
                            {updateBranding.isPending ? "Saving..." : "Save changes"}
                        </Button>
                    </div>
                </form>
            </Form>
        </div>
    );
}
