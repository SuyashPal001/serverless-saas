"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
    LayoutDashboard,
    Users,
    Shield,
    CreditCard,
    Key,
    Bot,
    Bell,
    FileText,
    Building2,
    Sliders
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useTenant } from "@/app/[tenant]/tenant-provider"
import { useNotifications } from "@/lib/notifications-context"

interface SidebarItemProps {
    href: string
    label: string
    icon: React.ElementType
}

function SidebarItem({ href, label, icon: Icon }: SidebarItemProps) {
    const pathname = usePathname()
    const isActive = pathname === href

    return (
        <Link
            href={href}
            className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
            )}
        >
            <Icon className="w-4 h-4" />
            <span>{label}</span>
        </Link>
    )
}

function NotificationsItem({ href, unreadCount }: { href: string; unreadCount: number }) {
    const pathname = usePathname()
    const isActive = pathname === href

    return (
        <Link
            href={href}
            className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
            )}
        >
            <Bell className="w-4 h-4" />
            <span>Notifications</span>
            {unreadCount > 0 && (
                <span className="ml-auto text-xs bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center leading-tight">
                    {unreadCount > 9 ? "9+" : unreadCount}
                </span>
            )}
        </Link>
    )
}

export function Sidebar() {
    const { tenantSlug, role } = useTenant()
    const { unreadCount } = useNotifications()

    const base = `/${tenantSlug}/dashboard`

    const navItems = [
        { href: `${base}`, label: "Dashboard", icon: LayoutDashboard },
        { href: `${base}/settings/members`, label: "Members", icon: Users },
        { href: `${base}/settings/roles`, label: "Roles", icon: Shield },
        { href: `${base}/billing`, label: "Billing", icon: CreditCard },
        { href: `${base}/api-keys`, label: "API Keys", icon: Key },
        { href: `${base}/agents`, label: "Agents", icon: Bot },
        { href: `${base}/audit`, label: "Audit Log", icon: FileText },
    ]

    const opsItems = [
        { href: `${base}/ops/tenants`, label: "All Tenants", icon: Building2 },
        { href: `${base}/ops/overrides`, label: "Feature Overrides", icon: Sliders },
    ]

    return (
        <aside className="fixed left-0 top-0 bottom-0 w-[240px] flex flex-col bg-card border-r border-border py-6 px-4 z-50">
            <div className="flex items-center gap-2 px-2 mb-8">
                <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                    <span className="text-primary-foreground font-bold text-xl">P</span>
                </div>
                <span className="text-lg font-bold tracking-tight text-foreground">Platform</span>
            </div>

            <nav className="flex-1 space-y-1">
                {navItems.map((item) => (
                    <SidebarItem key={item.href} {...item} />
                ))}
                <NotificationsItem
                    href={`${base}/notifications`}
                    unreadCount={unreadCount}
                />
            </nav>

            {role === "platform_admin" && (
                <div className="mt-8 pt-8 border-t border-border">
                    <p className="px-2 mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Ops
                    </p>
                    <nav className="space-y-1">
                        {opsItems.map((item) => (
                            <SidebarItem key={item.href} {...item} />
                        ))}
                    </nav>
                </div>
            )}
        </aside>
    )
}