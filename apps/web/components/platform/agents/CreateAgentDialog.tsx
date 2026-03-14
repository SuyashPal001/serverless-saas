"use client";

import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Copy, Check, Eye, EyeOff, AlertTriangle } from "lucide-react";
import { CreateAgentForm } from "./CreateAgentForm";
import { toast } from "sonner";

export function CreateAgentDialog() {
    const [open, setOpen] = useState(false);
    const [step, setStep] = useState<1 | 2>(1);
    const [revealedKey, setRevealedKey] = useState<{ agent: any; apiKey: string } | null>(null);
    const [showKey, setShowKey] = useState(false);
    const [copied, setCopied] = useState(false);

    const handleSuccess = (data: { agent: any; apiKey: string }) => {
        setRevealedKey(data);
        setStep(2);
    };

    const handleClose = () => {
        setOpen(false);
        // Reset after animation
        setTimeout(() => {
            setStep(1);
            setRevealedKey(null);
            setShowKey(false);
            setCopied(false);
        }, 300);
    };

    const copyToClipboard = () => {
        if (!revealedKey) return;
        navigator.clipboard.writeText(revealedKey.apiKey);
        setCopied(true);
        toast.success("API Key copied to clipboard");
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Dialog open={open} onOpenChange={(val) => !val ? handleClose() : setOpen(val)}>
            <DialogTrigger asChild>
                <Button className="font-semibold shadow-sm">
                    <Plus className="mr-2 h-4 w-4" />
                    New Agent
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[450px] p-0 overflow-hidden border-border bg-card">
                <div className="p-6">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-bold">
                            {step === 1 ? "Create New Agent" : "Agent Created"}
                        </DialogTitle>
                        <DialogDescription className="text-muted-foreground">
                            {step === 1 
                                ? "Configure your autonomous agent's identity and type." 
                                : "Your agent's API key has been generated."}
                        </DialogDescription>
                    </DialogHeader>

                    {step === 1 ? (
                        <CreateAgentForm onSuccess={handleSuccess} />
                    ) : (
                        <div className="space-y-6 pt-6">
                            <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-4 flex items-start gap-3">
                                <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
                                <div className="space-y-1">
                                    <p className="text-sm font-semibold text-yellow-500">Security Warning</p>
                                    <p className="text-xs text-muted-foreground leading-relaxed">
                                        This key will <span className="font-bold underline">never</span> be shown again. 
                                        Please copy it and store it securely.
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                                    Agent API Key
                                </label>
                                <div className="flex gap-2">
                                    <div className="relative flex-1">
                                        <Input
                                            type={showKey ? "text" : "password"}
                                            value={revealedKey?.apiKey}
                                            readOnly
                                            className="font-mono text-xs h-10 pr-10 focus-visible:ring-0 bg-muted/50"
                                        />
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="absolute right-0 top-0 h-10 w-10 text-muted-foreground hover:text-foreground"
                                            onClick={() => setShowKey(!showKey)}
                                        >
                                            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                        </Button>
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="h-10 w-10 shrink-0"
                                        onClick={copyToClipboard}
                                    >
                                        {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                                    </Button>
                                </div>
                            </div>

                            <div className="pt-2">
                                <Button onClick={handleClose} className="w-full font-semibold">
                                    Done
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}

