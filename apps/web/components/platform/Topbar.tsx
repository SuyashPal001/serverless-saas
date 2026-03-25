"use client"

import * as React from "react"
import { useRouter, usePathname } from "next/navigation"
import { LogOut, User, ChevronDown, Check, Plus } from "lucide-react"
import { useTenant } from "@/app/[tenant]/tenant-provider"
import { signOut } from "@/lib/auth"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { api, ApiError } from "@/lib/api"
import { toast } from "sonner"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

function WorkspaceSwitcher({ currentPlanColor, plan, tenantSlug }: { currentPlanColor: string, plan: string, tenantSlug: string | undefined }) {
    const router = useRouter()
    const pathname = usePathname()
    const currentSlugFromUrl = pathname?.split('/')[1] || ''
    const [workspaces, setWorkspaces] = React.useState<any[]>([])
    const [isLoading, setIsLoading] = React.useState(true)
    const [isOpen, setIsOpen] = React.useState(false)
    const [isCreateModalOpen, setIsCreateModalOpen] = React.useState(false)
    const [newWorkspaceName, setNewWorkspaceName] = React.useState("")
    const [isCreating, setIsCreating] = React.useState(false)

    React.useEffect(() => {
        api.get<{ tenants: any[] }>('/api/v1/auth/tenants')
            .then((data) => {
                setWorkspaces(data.tenants || [])
            })
            .catch(console.error)
            .finally(() => setIsLoading(false))
    }, [])

    const currentWorkspace = workspaces.find(w => w.slug === currentSlugFromUrl) || workspaces.find(w => w.slug === tenantSlug) || workspaces.find(w => w.isCurrent)

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

    const handleCreateWorkspace = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!newWorkspaceName.trim()) return

        setIsCreating(true)
        try {
            const res = await api.post<{ tenantId: string, slug: string }>('/api/v1/tenants', { name: newWorkspaceName })
            toast.success("Workspace created")
            
            // Switch to it
            await fetch('/api/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenantId: res.tenantId }),
            })

            router.push(`/${res.slug}/dashboard`)
            router.refresh()
            setIsCreateModalOpen(false)
            setNewWorkspaceName("")
            setIsOpen(false)
        } catch (error: any) {
            console.error('Failed to create workspace', error)
            
            let errorData = null;
            if (error instanceof ApiError) {
                errorData = error.data;
            } else if (error.response) {
                errorData = await error.response.json().catch(() => null);
            }
            
            if (error?.status === 403 || errorData?.code === 'FEATURE_NOT_ENTITLED') {
                toast.error("Workspace limit reached. Upgrade to create more workspaces.", {
                    action: {
                        label: "Upgrade",
                        onClick: () => router.push(`/${tenantSlug || currentSlugFromUrl}/dashboard/billing`)
                    }
                })
            } else if (errorData?.code === 'CONFLICT') {
                toast.error("You already have a workspace with this name.");
            } else {
                toast.error(errorData?.error || "Failed to create workspace. Please try again.");
            }
        } finally {
            setIsCreating(false)
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
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        className="flex items-center gap-2 cursor-pointer py-2 px-3 text-muted-foreground"
                        onSelect={(e) => {
                            e.preventDefault();
                            setIsOpen(false);
                            setIsCreateModalOpen(true);
                        }}
                    >
                        <Plus className="w-4 h-4" />
                        <span className="font-medium text-sm">Create Workspace</span>
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Create Workspace</DialogTitle>
                        <DialogDescription>
                            Create a new workspace to collaborate with your team.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleCreateWorkspace}>
                        <div className="py-4">
                            <Input
                                placeholder="Workspace Name"
                                value={newWorkspaceName}
                                onChange={(e) => setNewWorkspaceName(e.target.value)}
                                disabled={isCreating}
                                autoFocus
                            />
                        </div>
                        <DialogFooter>
                            <Button 
                                type="button" 
                                variant="outline" 
                                onClick={() => setIsCreateModalOpen(false)}
                                disabled={isCreating}
                            >
                                Cancel
                            </Button>
                            <Button type="submit" disabled={isCreating || !newWorkspaceName.trim()}>
                                {isCreating ? "Creating..." : "Create"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

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

import { useSidebar } from "./SidebarContext"

export function Topbar() {
    const { tenantId, tenantSlug, plan, email, name } = useTenant()
    const { isSidebarCollapsed } = useSidebar()

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
        <header className={cn(
            "fixed top-0 right-0 h-16 flex items-center justify-between px-8 bg-card border-b border-border z-40 transition-all duration-300",
            isSidebarCollapsed ? "left-16" : "left-60"
        )}>
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
