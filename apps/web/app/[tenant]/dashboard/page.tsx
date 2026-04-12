import { redirect } from 'next/navigation';

export default async function DashboardPage({
    params,
}: {
    params: Promise<{ tenant: string }>;
}) {
    const { tenant } = await params;
    redirect(`/${tenant}/dashboard/chat`);
}
