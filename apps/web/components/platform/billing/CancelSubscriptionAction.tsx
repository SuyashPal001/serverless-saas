"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { can } from "@/lib/permissions";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AlertOctagon } from "lucide-react";

interface CancelSubscriptionActionProps {
    status: "active" | "trialing" | "cancelled" | "expired";
}

export function CancelSubscriptionAction({ status }: CancelSubscriptionActionProps) {
    const { tenantId, permissions = [] } = useTenant();
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(false);

    const canUpdateBilling = can(permissions, "billing", "update");

    const cancelMutation = useMutation({
        mutationFn: () => api.post("/api/v1/billing/cancel"),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["subscription", tenantId] });
            toast.success("Subscription cancelled successfully");
            setOpen(false);
        },
        onError: (error: Error) => {
            toast.error(error.message || "Failed to cancel subscription");
        },
    });

    if (!canUpdateBilling || (status !== "active" && status !== "trialing")) {
        return null;
    }

    return (
        <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogTrigger asChild>
                <Button variant="ghost" className="w-full sm:w-auto text-destructive hover:bg-destructive/10 hover:text-destructive">
                    <AlertOctagon className="w-4 h-4 mr-2" />
                    Cancel Subscription
                </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle className="text-destructive flex items-center gap-2">
                        <AlertOctagon className="w-5 h-5" />
                        Cancel Subscription
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        Are you sure you want to cancel your subscription? You will lose access to premium features at the end of your current billing cycle. This action cannot be undone.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={cancelMutation.isPending}>
                        Keep Subscription
                    </AlertDialogCancel>
                    <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        disabled={cancelMutation.isPending}
                        onClick={(e) => {
                            e.preventDefault();
                            cancelMutation.mutate();
                        }}
                    >
                        {cancelMutation.isPending ? "Cancelling..." : "Yes, Cancel"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
