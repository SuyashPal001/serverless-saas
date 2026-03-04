import { MembersList } from "@/components/platform/members/MembersList";
import { InviteMemberForm } from "@/components/platform/members/InviteMemberForm";

export default async function MembersPage({
    params,
}: {
    params: Promise<{ tenant: string }>;
}) {
    // Await params here if needed by Server Component, 
    // though we rely on client components for actual data fetching.
    await params;

    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-foreground">
                    Members
                </h1>
                <p className="text-muted-foreground mt-2">
                    Manage the members of your tenant, assign roles, and send invitations.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                <div className="lg:col-span-2 order-2 lg:order-1">
                    <MembersList />
                </div>

                <div className="lg:col-span-1 order-1 lg:order-2">
                    <InviteMemberForm />
                </div>
            </div>
        </div>
    );
}
