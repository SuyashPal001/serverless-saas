"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useTenant } from "@/app/[tenant]/tenant-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

interface Invoice {
    id: string;
    amount: number;
    currency: string;
    status: "draft" | "open" | "paid" | "void" | "uncollectible";
    dueAt: string;
    paidAt?: string;
    createdAt: string;
}

interface InvoicesResponse {
    invoices: Invoice[];
    total: number;
    page: number;
    totalPages: number;
}

export function InvoicesTable() {
    const { tenantId } = useTenant();
    const [page, setPage] = useState(1);
    const pageSize = 10;

    const { data, isLoading, isError, error } = useQuery<InvoicesResponse>({
        queryKey: ["invoices", tenantId, page, pageSize],
        queryFn: () => api.get<InvoicesResponse>(`/api/v1/billing/invoices?page=${page}&pageSize=${pageSize}`),
    });

    if (isLoading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                ))}
            </div>
        );
    }

    if (isError) {
        return (
            <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error Loading Invoices</AlertTitle>
                <AlertDescription>
                    {error instanceof Error ? error.message : "Failed to load invoices."}
                </AlertDescription>
            </Alert>
        );
    }

    const invoices = data?.invoices || [];
    const totalPages = data?.totalPages || 1;

    if (invoices.length === 0) {
        return (
            <div className="text-center py-10 bg-muted/20 rounded-md border border-dashed border-border">
                <p className="text-muted-foreground">No invoices found for this billing period.</p>
            </div>
        );
    }

    const statusColors = {
        paid: "bg-green-500/10 text-green-500 border-green-500/20",
        open: "bg-amber-500/10 text-amber-500 border-amber-500/20",
        void: "bg-destructive/10 text-destructive border-destructive/20",
        uncollectible: "bg-destructive/10 text-destructive border-destructive/20",
        draft: "bg-muted text-muted-foreground border-border",
    };

    const formatCurrency = (amount: number, currency: string) => {
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: currency.toUpperCase(),
        }).format(amount / 100); // Assuming amount is in cents
    };

    return (
        <div className="space-y-4">
            <div className="rounded-md border border-border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Invoice ID</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Amount</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Due Date</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {invoices.map((invoice) => (
                            <TableRow key={invoice.id}>
                                <TableCell className="font-mono text-xs text-muted-foreground">
                                    {invoice.id}
                                </TableCell>
                                <TableCell className="text-sm">
                                    {new Date(invoice.createdAt).toLocaleDateString()}
                                </TableCell>
                                <TableCell className="font-medium">
                                    {formatCurrency(invoice.amount, invoice.currency)}
                                </TableCell>
                                <TableCell>
                                    <Badge
                                        variant="outline"
                                        className={`text-[10px] uppercase font-bold tracking-wider ${statusColors[invoice.status] || ""}`}
                                    >
                                        {invoice.status}
                                    </Badge>
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                    {new Date(invoice.dueAt).toLocaleDateString()}
                                    {invoice.paidAt && (
                                        <span className="block text-xs text-green-500 mt-1">
                                            Paid on {new Date(invoice.paidAt).toLocaleDateString()}
                                        </span>
                                    )}
                                </TableCell>
                                <TableCell className="text-right">
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" title="Download PDF">
                                        <Download className="h-4 w-4" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                    Showing page {page} of {totalPages}
                </p>
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page === 1}
                    >
                        <ChevronLeft className="h-4 w-4 mr-1" />
                        Previous
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={page >= totalPages}
                    >
                        Next
                        <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
