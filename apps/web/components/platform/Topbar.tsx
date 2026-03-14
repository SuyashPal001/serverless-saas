"use client"

import { useRouter } from "next/navigation"
import { LogOut, User } from "lucide-react"
import { useTenant } from "@/app/[tenant]/tenant-provider"
import { signOut } from "@/lib/auth"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export function Topbar() {
    const router = useRouter()
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
            <div className="flex items-center gap-4">
                <h2 className="text-sm font-semibold text-foreground uppercase tracking-tight">
                    {tenantSlug}
                </h2>
                <button
                    onClick={() => router.push(`/${tenantSlug}/dashboard/billing`)}
                    className={cn(
                        "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border tracking-widest transition-opacity hover:opacity-80 cursor-pointer",
                        currentPlanColor
                    )}
                >
                    {plan || "Free"}
                </button>
            </div>

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
