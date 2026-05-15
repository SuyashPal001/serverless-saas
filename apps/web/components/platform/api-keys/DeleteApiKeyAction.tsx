"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { toast } from "sonner";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

interface DeleteApiKeyActionProps {
    apiKeyId: string;
    apiKeyName: string;
}

export function DeleteApiKeyAction({ apiKeyId, apiKeyName }: DeleteApiKeyActionProps) {
    const { tenantId } = useTenant();
    const queryClient = useQueryClient();
    const [showConfirm, setShowConfirm] = useState(false);

    const deleteMutation = useMutation({
        mutationFn: () => api.del(`/api/v1/api-keys/${apiKeyId}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["api-keys", tenantId] });
            toast.success(`API key "${apiKeyName}" deleted successfully`);
            setShowConfirm(false);
        },
        onError: (error: Error) => {
            toast.error(error.message || "Failed to delete API key");
        },
    });

    return (
        <>
            <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-8 font-medium px-2"
                onClick={() => setShowConfirm(true)}
                title="Delete API Key"
            >
                <Trash2 className="h-3.5 w-3.5" />
            </Button>

            <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete API Key</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to permanently delete the API key <strong>{apiKeyName}</strong>?
                            This action cannot be undone and is more permanent than revoking.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={(e) => {
                                e.preventDefault();
                                deleteMutation.mutate();
                            }}
                            disabled={deleteMutation.isPending}
                        >
                            {deleteMutation.isPending ? "Deleting..." : "Delete Permanently"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
