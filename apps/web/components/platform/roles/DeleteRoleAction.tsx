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
import { MoreVertical, Trash2 } from "lucide-react";

interface DeleteRoleActionProps {
    roleId: string;
    roleName: string;
}

export function DeleteRoleAction({ roleId, roleName }: DeleteRoleActionProps) {
    const { tenantId } = useTenant();
    const queryClient = useQueryClient();
    const [showConfirm, setShowConfirm] = useState(false);

    const deleteMutation = useMutation({
        mutationFn: () => api.del(`/api/v1/roles/${roleId}`),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["roles", tenantId] });
            toast.success(`Role "${roleName}" deleted successfully`);
        },
        onError: (error: Error) => {
            toast.error(error.message || "Failed to delete role");
        },
    });

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                        <MoreVertical className="h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem
                        className="text-destructive focus:text-destructive flex items-center gap-2"
                        onClick={() => setShowConfirm(true)}
                    >
                        <Trash2 className="h-4 w-4" />
                        Delete Role
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete the <strong>{roleName}</strong> role. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={(e) => {
                                e.preventDefault();
                                deleteMutation.mutate();
                                setShowConfirm(false);
                            }}
                            disabled={deleteMutation.isPending}
                        >
                            {deleteMutation.isPending ? "Deleting..." : "Delete Role"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
