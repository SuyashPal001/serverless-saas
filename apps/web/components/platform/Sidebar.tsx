"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useParams } from "next/navigation"
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
import { useUnreadCount } from "@/hooks/useUnreadCount"

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
                    {unreadCount > 99 ? "99+" : unreadCount}
                </span>
            )}
        </Link>
    )
}

export function Sidebar() {
    const { tenantId, role } = useTenant()
    const params = useParams()
    const tenantSlug = params.tenant as string
    const { unreadCount } = useUnreadCount()

    const notificationsHref = `/${tenantSlug}/dashboard/notifications`

    const navItems = [
        { href: `/${tenantId}/dashboard`, label: "Dashboard", icon: LayoutDashboard },
        { href: `/${tenantId}/settings/members`, label: "Members", icon: Users },
        { href: `/${tenantId}/settings/roles`, label: "Roles", icon: Shield },
        { href: `/${tenantId}/billing`, label: "Billing", icon: CreditCard },
        { href: `/${tenantId}/api-keys`, label: "API Keys", icon: Key },
        { href: `/${tenantId}/agents`, label: "Agents", icon: Bot },
        { href: `/${tenantId}/audit`, label: "Audit Log", icon: FileText },
    ]

    const opsItems = [
        { href: `/${tenantId}/ops/tenants`, label: "All Tenants", icon: Building2 },
        { href: `/${tenantId}/ops/overrides`, label: "Feature Overrides", icon: Sliders },
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
                {/* Notifications — rendered separately to support the unread badge */}
                <NotificationsItem
                    href={notificationsHref}
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
