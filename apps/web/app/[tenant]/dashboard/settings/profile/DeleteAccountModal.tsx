"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Dialog, DialogContent, DialogDescription,
    DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface DeleteAccountModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    userEmail: string;
}

export function DeleteAccountModal({ open, onOpenChange, userEmail }: DeleteAccountModalProps) {
    const [confirmEmail, setConfirmEmail] = useState("");

    const deleteMutation = useMutation({
        mutationFn: () => api.del("/api/v1/auth/account"),
        onSuccess: async () => {
            toast.success("Account deleted");
            await fetch("/api/auth/session", { method: "DELETE" });
            window.location.href = "/auth/login";
        },
        onError: () => {
            toast.error("Failed to delete account. Please try again.");
        },
    });

    const canConfirm = confirmEmail === userEmail;

    const handleOpenChange = (v: boolean) => {
        if (!v) setConfirmEmail("");
        onOpenChange(v);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle className="text-destructive">Delete Account</DialogTitle>
                    <DialogDescription>
                        This action is permanent and cannot be undone. All your data will be
                        deleted. Type your email address to confirm.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                        Your account and all associated data will be permanently deleted.
                    </div>
                    <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">
                            Type <span className="font-mono font-semibold text-foreground">{userEmail}</span> to confirm:
                        </p>
                        <Input
                            value={confirmEmail}
                            onChange={(e) => setConfirmEmail(e.target.value)}
                            placeholder={userEmail}
                            disabled={deleteMutation.isPending}
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={deleteMutation.isPending}>
                        Cancel
                    </Button>
                    <Button variant="destructive" onClick={() => deleteMutation.mutate()} disabled={!canConfirm || deleteMutation.isPending}>
                        {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Delete my account
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
