"use client";

import { useState } from "react";
import { Plus, Copy, CheckCircle2, AlertTriangle } from "lucide-react";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { can } from "@/lib/permissions";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CreateApiKeyForm } from "./CreateApiKeyForm";
import { toast } from "sonner";

export function CreateApiKeyDialog() {
    const { permissions = [] } = useTenant();
    const [open, setOpen] = useState(false);
    const [revealedKey, setRevealedKey] = useState<{ key: string; name: string } | null>(null);

    if (!can(permissions, "api_keys", "create")) {
        return null;
    }

    const handleCopy = () => {
        if (revealedKey) {
            navigator.clipboard.writeText(revealedKey.key);
            toast.success("API key copied to clipboard");
        }
    };

    const handleClose = () => {
        setOpen(false);
        // Only reset revealed key after a short delay to avoid flickering
        setTimeout(() => setRevealedKey(null), 300);
    };

    return (
        <Dialog open={open} onOpenChange={(val) => {
            if (!val) handleClose();
            else setOpen(true);
        }}>
            <DialogTrigger asChild>
                <Button className="flex items-center gap-2">
                    <Plus className="w-4 h-4" />
                    Create API Key
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                {!revealedKey ? (
                    <>
                        <DialogHeader>
                            <DialogTitle>Create API Key</DialogTitle>
                            <DialogDescription>
                                Generate a new key to access the platform programmatically.
                            </DialogDescription>
                        </DialogHeader>
                        <CreateApiKeyForm onSuccess={setRevealedKey} />
                    </>
                ) : (
                    <>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2 text-green-500">
                                <CheckCircle2 className="w-5 h-5" />
                                API Key Created
                            </DialogTitle>
                            <DialogDescription className="text-foreground font-medium pt-2">
                                Save this key now. It will <strong>never</strong> be shown again.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-4 py-4">
                            <div className="flex flex-col gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-md">
                                <div className="flex items-center gap-2 text-amber-500 text-sm font-bold uppercase tracking-wider">
                                    <AlertTriangle className="w-4 h-4" />
                                    Warning
                                </div>
                                <p className="text-xs text-amber-200/80 leading-relaxed">
                                    For security reasons, we cannot show this key again. If you lose it, you will need to revoke it and create a new one.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                                    Key Name: {revealedKey.name}
                                </label>
                                <div className="flex gap-2">
                                    <Input
                                        readOnly
                                        value={revealedKey.key}
                                        className="font-mono text-sm bg-muted/50"
                                    />
                                    <Button size="icon" variant="outline" onClick={handleCopy}>
                                        <Copy className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                        </div>

                        <DialogFooter>
                            <Button onClick={handleClose} className="w-full">
                                I've securely saved this key
                            </Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
