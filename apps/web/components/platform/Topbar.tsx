"use client"

import * as React from "react"
import { useRouter, usePathname } from "next/navigation"
import { LogOut, User, ChevronDown, Check } from "lucide-react"
import { useTenant } from "@/app/[tenant]/tenant-provider"
import { signOut } from "@/lib/auth"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { toast } from "sonner"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

function WorkspaceSwitcher({ currentPlanColor, plan, tenantSlug }: { currentPlanColor: string, plan: string, tenantSlug: string | undefined }) {
    const router = useRouter()
    const pathname = usePathname()
    const currentSlugFromUrl = pathname?.split('/')[1] || ''
    const [workspaces, setWorkspaces] = React.useState<any[]>([])
    const [isLoading, setIsLoading] = React.useState(true)
    const [isOpen, setIsOpen] = React.useState(false)

    React.useEffect(() => {
        api.get<{ tenants: any[] }>('/api/v1/auth/tenants')
            .then((data) => {
                setWorkspaces(data.tenants || [])
            })
            .catch(console.error)
            .finally(() => setIsLoading(false))
    }, [])

    const currentWorkspace = workspaces.find(w => w.isCurrent) || workspaces.find(w => w.slug === tenantSlug)

    const handleSwitch = async (workspace: any) => {
        if (workspace.slug === currentSlugFromUrl) {
            setIsOpen(false)
            return
        }
        
        try {
            const res = await fetch('/api/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenantId: workspace.tenantId }),
            });
            
            if (!res.ok) throw new Error('Failed to switch workspace');
            
            router.push(`/${workspace.slug}/dashboard`);
            router.refresh();
            setIsOpen(false);
            toast.success(`Switched to ${workspace.name}`);
        } catch (error) {
            console.error('Failed to switch workspace', error)
            toast.error("Failed to switch workspace");
        }
    }

    const displaySlug = tenantSlug?.toUpperCase() || 'PLATFORM'

    return (
        <div className="flex items-center gap-2">
            <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
                <DropdownMenuTrigger className="flex items-center gap-2 px-2 py-1.5 -ml-2 rounded-md hover:bg-accent/50 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="text-sm font-semibold text-foreground tracking-tight">
                        {isLoading ? displaySlug : (currentWorkspace?.name || displaySlug)}
                    </span>
                    <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[260px]" align="start">
                    <DropdownMenuLabel className="text-xs text-muted-foreground uppercase tracking-wider">Switch Workspace</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {workspaces.map((workspace) => (
                        <DropdownMenuItem 
                            key={workspace.tenantId} 
                            className="flex flex-col items-start gap-1 cursor-pointer py-2 px-3 focus:bg-accent focus:text-accent-foreground"
                            onClick={(e) => {
                                e.preventDefault();
                                handleSwitch(workspace);
                            }}
                        >
                            <div className="flex items-center justify-between w-full">
                                <span className="font-medium text-sm truncate">{workspace.name}</span>
                                {workspace.slug === currentSlugFromUrl && (
                                    <Check className="w-4 h-4 text-primary shrink-0 ml-2" />
                                )}
                            </div>
                            <span className="text-xs text-muted-foreground opacity-70">
                                {workspace.role.replace('_', ' ')}
                            </span>
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>

            <button
                onClick={() => tenantSlug && router.push(`/${tenantSlug}/dashboard/billing`)}
                className={cn(
                    "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border tracking-widest transition-opacity hover:opacity-80 cursor-pointer ml-1",
                    currentPlanColor
                )}
            >
                {plan || "Free"}
            </button>
        </div>
    )
}

export function Topbar() {
    const { tenantId, tenantSlug, plan, email, name } = useTenant()

    const getInitials = () => {
        if (name) return name.split(' ').map((n: string) => n[0]).join('').toUpperCase()
        if (email) return email[0].toUpperCase()
        return "US"
    }

    const planColors: Record<string, string> = {
        free: "bg-muted text-muted-foreground border-border",
        starter: "bg-blue-500/10 text-blue-500 border-blue-500/20",
        business: "bg-purple-500/10 text-purple-500 border-purple-500/20",
        enterprise: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    }

    const currentPlanColor = planColors[plan?.toLowerCase()] || planColors.free

    return (
        <header className="fixed top-0 right-0 left-[240px] h-16 flex items-center justify-between px-8 bg-card border-b border-border z-40">
            <WorkspaceSwitcher currentPlanColor={currentPlanColor} plan={plan} tenantSlug={tenantSlug} />

            <div className="flex items-center gap-6">
                <div className="flex items-center gap-3">
                    <div className="text-right hidden sm:block">
                        <p className="text-sm font-medium leading-none text-foreground">{name || "User"}</p>
                        <p className="text-xs text-muted-foreground">{email || "user@platform.com"}</p>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center border border-border">
                        <span className="text-xs font-bold text-accent-foreground">
                            {getInitials()}
                        </span>
                    </div>
                </div>

                <div className="w-px h-4 bg-border" />

                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => signOut()}
                    className="text-muted-foreground hover:text-foreground"
                    title="Sign out"
                >
                    <LogOut className="w-4 h-4" />
                </Button>
            </div>
        </header>
    )
}
