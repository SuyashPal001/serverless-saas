import { InvoicesTable } from "@/components/platform/billing/InvoicesTable";

export default async function InvoicesPage({
    params,
}: {
    params: Promise<{ tenant: string }>;
}) {
    await params;

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">
                    Invoices
                </h1>
                <p className="text-muted-foreground mt-2">
                    View your complete billing history and download past invoices.
                </p>
            </div>

            <InvoicesTable />
        </div>
    );
}
