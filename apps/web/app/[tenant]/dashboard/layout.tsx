import { Sidebar } from "@/components/platform/Sidebar"
import { Topbar } from "@/components/platform/Topbar"
import { Toaster } from "@/components/ui/sonner"
import { NotificationsProvider } from "@/components/platform/NotificationsProvider"

export default async function DashboardLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ tenant: string }>;
}) {
    await params;

    return (
        <NotificationsProvider>
            <div className="flex min-h-screen bg-background text-foreground">
                {/* Sidebar is fixed, so it doesn't need to be in the flex flow for positioning, 
              but we keep it here for clarity. The width is 240px. */}
                <Sidebar />

                <div className="flex-1 flex flex-col min-w-0 ml-[240px]">
                    {/* Topbar is also fixed in the component, but we've offset the main 
                container by 240px to center it. The Topbar height is 16 (64px). */}
                    <Topbar />

                    <main className="flex-1 mt-16 p-8 overflow-y-auto">
                        <div className="max-w-7xl mx-auto h-full">
                            {children}
                        </div>
                    </main>
                </div>

                <Toaster position="bottom-right" richColors theme="dark" />
            </div>
        </NotificationsProvider>
    );
}
