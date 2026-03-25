import { Toaster } from "@/components/ui/sonner"
import { NotificationsProvider } from "@/components/platform/NotificationsProvider"
import { SidebarProvider } from "@/components/platform/SidebarContext"
import { SidebarContent } from "@/components/platform/SidebarContent"

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
            <SidebarProvider>
                <SidebarContent>{children}</SidebarContent>
                <Toaster position="bottom-right" richColors theme="dark" />
            </SidebarProvider>
        </NotificationsProvider>
    );
}
