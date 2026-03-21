"use client";

import { useKeyUsage } from "@/lib/hooks/useKeyUsage";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, AlertCircle } from "lucide-react";
import { UsageChart } from "@/components/platform/billing/UsageChart";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface KeyUsageModalProps {
    keyId: string;
    keyName: string;
    isOpen: boolean;
    onClose: () => void;
}

export function KeyUsageModal({ keyId, keyName, isOpen, onClose }: KeyUsageModalProps) {
    const { data, isLoading, isError, error } = useKeyUsage(isOpen ? keyId : null);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>Usage: {keyName}</DialogTitle>
                    <DialogDescription>
                        API request usage over the latest billing period.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-2 flex flex-col items-center justify-center w-full min-h-[300px]">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center text-center space-y-4">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                            <p className="text-sm text-muted-foreground">Loading usage data...</p>
                        </div>
                    ) : isError ? (
                        <Alert variant="destructive" className="w-full">
                            <AlertCircle className="h-4 w-4" />
                            <AlertTitle>Error Loading Usage</AlertTitle>
                            <AlertDescription>
                                {error instanceof Error ? error.message : "Failed to load usage data."}
                            </AlertDescription>
                        </Alert>
                    ) : !data || data.total === 0 || data.data.length === 0 ? (
                        <div className="flex flex-col items-center justify-center text-center p-8 border border-dashed rounded-lg bg-muted/20 w-full h-full">
                            <p className="text-muted-foreground">No usage data yet</p>
                        </div>
                    ) : (
                        <div className="w-full">
                            <div className="mb-4">
                                <span className="text-2xl font-bold">{data.total.toLocaleString()}</span>
                                <span className="text-sm text-muted-foreground ml-2">Total Requests</span>
                            </div>
                            <UsageChart data={data.data} />
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
