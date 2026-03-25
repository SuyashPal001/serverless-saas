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
    MessageSquare,
    Bell,
    FileText,
    Building2,
    Sliders,
    Webhook,
    FolderOpen,
    Plug
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useTenant } from "@/app/[tenant]/tenant-provider"
import { useNotifications } from "@/lib/notifications-context"
import { canRead } from "@/lib/permissions"
import { useSidebar } from "./SidebarContext"
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { ChevronRight, PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { Button } from "@/components/ui/button"

interface SidebarItemProps {
    href: string
    label: string
    icon: React.ElementType
    isCollapsed?: boolean
}

function SidebarItem({ href, label, icon: Icon, isCollapsed }: SidebarItemProps) {
    const pathname = usePathname()
    const isActive = pathname === href

    const content = (
        <Link
            href={href}
            className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground",
                isCollapsed && "justify-center px-2"
            )}
        >
            <Icon className="w-4 h-4 shrink-0" />
            {!isCollapsed && <span>{label}</span>}
        </Link>
    )

    if (isCollapsed) {
        return (
            <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                    {content}
                </TooltipTrigger>
                <TooltipContent side="right" className="ml-2">
                    {label}
                </TooltipContent>
            </Tooltip>
        )
    }

    return content
}

function NotificationsItem({ href, unreadCount, isCollapsed }: { href: string; unreadCount: number; isCollapsed?: boolean }) {
    const pathname = usePathname()
    const isActive = pathname === href

    const content = (
        <Link
            href={href}
            className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors relative",
                isActive
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground",
                isCollapsed && "justify-center px-2"
            )}
        >
            <Bell className="w-4 h-4 shrink-0" />
            {!isCollapsed && <span>Notifications</span>}
            {unreadCount > 0 && (
                <span className={cn(
                    "bg-primary text-primary-foreground rounded-full text-[10px] flex items-center justify-center font-bold",
                    isCollapsed 
                        ? "absolute -top-1 -right-1 h-4 w-4" 
                        : "ml-auto px-1.5 py-0.5 min-w-[1.25rem] leading-tight"
                )}>
                    {unreadCount > 9 ? "9+" : unreadCount}
                </span>
            )}
        </Link>
    )

    if (isCollapsed) {
        return (
            <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                    {content}
                </TooltipTrigger>
                <TooltipContent side="right" className="ml-2">
                    Notifications
                </TooltipContent>
            </Tooltip>
        )
    }

    return content
}

export function Sidebar() {
    const { tenantSlug, role, permissions = [] } = useTenant()
    const { unreadCount } = useNotifications()
    const { isSidebarCollapsed, toggleSidebar } = useSidebar()

    const base = `/${tenantSlug}/dashboard`

    const navItems = [
        { href: `${base}`, label: "Dashboard", icon: LayoutDashboard, show: true },
        { href: `${base}/settings/members`, label: "Members", icon: Users, show: canRead(permissions, "members") },
        { href: `${base}/settings/roles`, label: "Roles", icon: Shield, show: canRead(permissions, "roles") },
        { href: `${base}/billing`, label: "Billing", icon: CreditCard, show: canRead(permissions, "billing") },
        { href: `${base}/api-keys`, label: "API Keys", icon: Key, show: canRead(permissions, "api_keys") },
        { href: `${base}/agents`, label: "Agents", icon: Bot, show: canRead(permissions, "agents") },
        { href: `${base}/chat`, label: "Chat", icon: MessageSquare, show: canRead(permissions, "conversations") },
        { href: `${base}/webhooks`, label: "Webhooks", icon: Webhook, show: canRead(permissions, "webhooks") },
        { href: `${base}/files`, label: "Files", icon: FolderOpen, show: canRead(permissions, "files") },
        { href: `${base}/integrations`, label: "Integrations", icon: Plug, show: canRead(permissions, "integrations") },
        { href: `${base}/audit`, label: "Audit Log", icon: FileText, show: canRead(permissions, "audit_log") },
    ]

    const opsItems = [
        { href: `${base}/ops/tenants`, label: "All Tenants", icon: Building2 },
        { href: `${base}/ops/overrides`, label: "Feature Overrides", icon: Sliders },
    ]

    return (
        <TooltipProvider>
            <aside className={cn(
                "fixed left-0 top-0 bottom-0 flex flex-col bg-card border-r border-border py-6 z-50 transition-all duration-300 ease-in-out",
                isSidebarCollapsed ? "w-16 px-2" : "w-60 px-4"
            )}>
                <div className={cn(
                    "flex items-center gap-2 mb-8 transition-all px-2",
                    isSidebarCollapsed ? "justify-center" : "px-2"
                )}>
                    <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
                        <span className="text-primary-foreground font-bold text-xl uppercase">
                            {tenantSlug?.[0] || 'P'}
                        </span>
                    </div>
                    {!isSidebarCollapsed && (
                        <span className="text-lg font-bold tracking-tight text-foreground truncate">
                            Platform
                        </span>
                    )}
                </div>

                <nav className="flex-1 space-y-1">
                    {navItems.filter(item => item.show).map((item) => (
                        <SidebarItem 
                            key={item.href} 
                            href={item.href} 
                            label={item.label} 
                            icon={item.icon} 
                            isCollapsed={isSidebarCollapsed} 
                        />
                    ))}

                    {canRead(permissions, "notifications") && (
                        <NotificationsItem
                            href={`${base}/notifications`}
                            unreadCount={unreadCount}
                            isCollapsed={isSidebarCollapsed}
                        />
                    )}
                </nav>

                <div className="mt-auto pt-4 border-t border-border/50">
                    {role === "platform_admin" && !isSidebarCollapsed && (
                        <div className="mb-4">
                            <p className="px-2 mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                                Ops
                            </p>
                            <nav className="space-y-1">
                                {opsItems.map((item) => (
                                    <SidebarItem key={item.href} {...item} isCollapsed={isSidebarCollapsed} />
                                ))}
                            </nav>
                        </div>
                    )}
                    
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={toggleSidebar}
                        className="w-full h-10 rounded-md hover:bg-accent hover:text-accent-foreground transition-all group"
                    >
                        {isSidebarCollapsed ? (
                            <PanelLeftOpen className="h-5 w-5 text-muted-foreground group-hover:text-foreground" />
                        ) : (
                            <div className="flex items-center gap-3 w-full px-3">
                                <PanelLeftClose className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                                <span className="text-sm font-medium">Collapse</span>
                            </div>
                        )}
                    </Button>
                </div>
            </aside>
        </TooltipProvider>
    )
}