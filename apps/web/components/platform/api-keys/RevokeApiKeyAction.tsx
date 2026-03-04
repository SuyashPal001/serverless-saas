"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { toast } from "sonner";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { MoreVertical, Ban } from "lucide-react";

interface RevokeApiKeyActionProps {
    apiKeyId: string;
    apiKeyName: string;
}

export function RevokeApiKeyAction({ apiKeyId, apiKeyName }: RevokeApiKeyActionProps) {
    const { tenantId } = useTenant();
    const queryClient = useQueryClient();
    const [showConfirm, setShowConfirm] = useState(false);

    const revokeMutation = useMutation({
        mutationFn: () => api.post(`/api/v1/api-keys/${apiKeyId}/revoke`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["api-keys", tenantId] });
            toast.success(`API key "${apiKeyName}" revoked successfully`);
            setShowConfirm(false);
        },
        onError: (error: Error) => {
            toast.error(error.message || "Failed to revoke API key");
        },
    });

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem
                        className="text-destructive focus:text-destructive flex items-center gap-2"
                        onClick={() => setShowConfirm(true)}
                    >
                        <Ban className="h-4 w-4" />
                        Revoke Key
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Revoke API Key</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to revoke the API key <strong>{apiKeyName}</strong>?
                            This action cannot be undone and any applications using this key will immediately lose access.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={revokeMutation.isPending}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={(e) => {
                                e.preventDefault();
                                revokeMutation.mutate();
                            }}
                            disabled={revokeMutation.isPending}
                        >
                            {revokeMutation.isPending ? "Revoking..." : "Revoke Key"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
