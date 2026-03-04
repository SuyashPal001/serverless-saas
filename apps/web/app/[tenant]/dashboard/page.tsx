export default async function DashboardPage({
    params,
}: {
    params: Promise<{ tenant: string }>;
}) {
    const { tenant } = await params;
    return (
        <div className="dashboard-content">
            <h2 className="text-2xl font-semibold text-foreground">Dashboard Overview for {tenant}</h2>
        </div>
    );
}
