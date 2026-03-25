"use client"

import { Sidebar } from "@/components/platform/Sidebar"
import { Topbar } from "@/components/platform/Topbar"
import { Toaster } from "@/components/ui/sonner"
import { NotificationsProvider } from "@/components/platform/NotificationsProvider"
import { SidebarProvider, useSidebar } from "@/components/platform/SidebarContext"
import { cn } from "@/lib/utils"

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
                <SidebarContent children={children} />
                <Toaster position="bottom-right" richColors theme="dark" />
            </SidebarProvider>
        </NotificationsProvider>
    );
}

import { usePathname } from "next/navigation";

// Inner component to access sidebar context
function SidebarContent({ children }: { children: React.ReactNode }) {
    const { isSidebarCollapsed } = useSidebar();
    const pathname = usePathname();
    const isChatPage = pathname?.includes('/dashboard/chat');
    
    return (
        <div className="flex min-h-screen bg-background text-foreground overflow-hidden">
            <Sidebar />

            <div className={cn(
                "flex-1 flex flex-col min-w-0 transition-all duration-300",
                isSidebarCollapsed ? "ml-16" : "ml-60"
            )}>
                <Topbar />

                <main className={cn(
                    "flex-1 mt-16 overflow-y-auto custom-scrollbar",
                    !isChatPage && "p-8"
                )}>
                    <div className={cn(
                        "h-full",
                        !isChatPage && "max-w-7xl mx-auto"
                    )}>
                        {children}
                    </div>
                </main>
            </div>
        </div>
    );
}
