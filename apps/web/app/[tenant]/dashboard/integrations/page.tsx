"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PermissionGate } from "@/components/platform/PermissionGate";
import { usePermissions } from "@/lib/hooks/usePermissions";
import { api } from "@/lib/api";
import { useIntegrations } from "@/hooks/useIntegrations";
import { CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Integration catalogue ─────────────────────────────────────────────────────

interface CatalogueEntry {
    provider: string;
    name: string;
    description: string;
    scopes: string[];
    icon: React.ReactNode;
    available: boolean;
}

function GoogleIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
    );
}

function M365Icon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z" fill="#0078D4" opacity="0.7" />
        </svg>
    );
}

function SlackIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#E01E5A" opacity="0.7" />
        </svg>
    );
}

function NotionIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.14c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z" fill="#ffffff" opacity="0.7" />
        </svg>
    );
}

function WhatsAppIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" fill="#25D366" opacity="0.7" />
        </svg>
    );
}

const CATALOGUE: CatalogueEntry[] = [
    {
        provider: 'google',
        name: 'Google Workspace',
        description: 'Connect Gmail, Drive and Calendar',
        scopes: ['Gmail', 'Drive', 'Calendar'],
        icon: <GoogleIcon className="w-8 h-8" />,
        available: true,
    },
    {
        provider: 'microsoft',
        name: 'Microsoft 365',
        description: 'Outlook, OneDrive and Teams',
        scopes: ['Outlook', 'OneDrive', 'Teams'],
        icon: <M365Icon className="w-8 h-8" />,
        available: false,
    },
    {
        provider: 'slack',
        name: 'Slack',
        description: 'Send messages and read channels',
        scopes: ['Messages', 'Channels', 'Files'],
        icon: <SlackIcon className="w-8 h-8" />,
        available: false,
    },
    {
        provider: 'notion',
        name: 'Notion',
        description: 'Read and write pages and databases',
        scopes: ['Pages', 'Databases', 'Blocks'],
        icon: <NotionIcon className="w-8 h-8" />,
        available: false,
    },
    {
        provider: 'whatsapp',
        name: 'WhatsApp Business',
        description: 'Send and receive WhatsApp messages',
        scopes: ['Messages', 'Templates', 'Contacts'],
        icon: <WhatsAppIcon className="w-8 h-8" />,
        available: false,
    },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function IntegrationsPage() {
    const { can } = usePermissions();
    const searchParams = useSearchParams();
    const router = useRouter();
    const { isLoading, refetch, isConnected, getIntegration } = useIntegrations();

    const [connecting, setConnecting] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);
    const [disconnectTarget, setDisconnectTarget] = useState<CatalogueEntry | null>(null);

    // Detect ?connected=google after OAuth callback redirect
    useEffect(() => {
        const connected = searchParams.get('connected');
        if (connected === 'google') {
            toast.success('Google Workspace connected!');
            refetch();
            // Clean the query param from the URL without a full reload
            const url = new URL(window.location.href);
            url.searchParams.delete('connected');
            router.replace(url.pathname + url.search, { scroll: false });
        }
        const error = searchParams.get('error');
        if (error) {
            const messages: Record<string, string> = {
                google_denied:          'Google connection was cancelled.',
                state_expired:          'The OAuth session expired. Please try again.',
                token_exchange_failed:  'Failed to connect Google. Please try again.',
                configuration_error:    'OAuth is not configured. Contact support.',
                db_error:               'Failed to save connection. Please try again.',
            };
            toast.error(messages[error] ?? 'Connection failed. Please try again.');
            const url = new URL(window.location.href);
            url.searchParams.delete('error');
            router.replace(url.pathname + url.search, { scroll: false });
        }
    }, [searchParams]);

    const handleConnect = async (entry: CatalogueEntry) => {
        if (entry.provider !== 'google') return;
        setConnecting(true);
        try {
            const { url } = await api.post<{ url: string }>('/api/v1/integrations/google/connect');
            window.location.href = url;
        } catch {
            toast.error('Failed to start Google connection. Please try again.');
            setConnecting(false);
        }
    };

    const handleDisconnectConfirm = async () => {
        if (!disconnectTarget) return;
        setDisconnecting(true);
        try {
            await api.del(`/api/v1/integrations/${disconnectTarget.provider}`);
            toast.success(`${disconnectTarget.name} disconnected`);
            refetch();
        } catch {
            toast.error(`Failed to disconnect ${disconnectTarget.name}.`);
        } finally {
            setDisconnecting(false);
            setDisconnectTarget(null);
        }
    };

    return (
        <PermissionGate resource="integrations" action="read">
            <div className="space-y-6">
                {/* Header */}
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">
                        Integrations
                    </h1>
                    <p className="text-muted-foreground mt-2">
                        Connect your workspace with external tools and services.
                    </p>
                </div>

                {/* Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {isLoading
                        ? Array.from({ length: 5 }).map((_, i) => (
                            <Skeleton key={i} className="h-48 rounded-xl" />
                        ))
                        : CATALOGUE.map((entry) => {
                            const connected = isConnected(entry.provider);
                            const integration = getIntegration(entry.provider);

                            return (
                                <div
                                    key={entry.provider}
                                    className={cn(
                                        "rounded-xl border bg-card p-6 flex flex-col gap-4 transition-colors",
                                        entry.available
                                            ? "border-border"
                                            : "border-border/40 opacity-50"
                                    )}
                                >
                                    {/* Icon + status */}
                                    <div className="flex items-start justify-between">
                                        <div className="h-14 w-14 rounded-xl bg-muted flex items-center justify-center shrink-0">
                                            {entry.icon}
                                        </div>
                                        {!entry.available && (
                                            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border border-border/50 rounded-full px-2 py-0.5">
                                                Coming soon
                                            </span>
                                        )}
                                        {entry.available && connected && (
                                            <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-500">
                                                <CheckCircle2 className="h-3.5 w-3.5" />
                                                Connected
                                            </span>
                                        )}
                                    </div>

                                    {/* Name + description */}
                                    <div className="flex-1 space-y-1">
                                        <h3 className="font-semibold text-foreground text-sm">
                                            {entry.name}
                                        </h3>
                                        <p className="text-xs text-muted-foreground">
                                            {entry.description}
                                        </p>
                                    </div>

                                    {/* Scope pills */}
                                    <div className="flex flex-wrap gap-1.5">
                                        {entry.scopes.map((scope) => (
                                            <span
                                                key={scope}
                                                className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                                            >
                                                {scope}
                                            </span>
                                        ))}
                                    </div>

                                    {/* Connected-at + actions */}
                                    <div className="border-t border-border/50 pt-4 flex items-center justify-between gap-2">
                                        {connected && integration ? (
                                            <span className="text-[11px] text-muted-foreground">
                                                Connected{' '}
                                                {formatDistanceToNow(new Date(integration.createdAt), {
                                                    addSuffix: true,
                                                })}
                                            </span>
                                        ) : (
                                            <span />
                                        )}

                                        {entry.available && (
                                            <div className="flex items-center gap-2 ml-auto">
                                                {connected ? (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                                                        onClick={() => setDisconnectTarget(entry)}
                                                        disabled={!can('integrations', 'delete')}
                                                    >
                                                        Disconnect
                                                    </Button>
                                                ) : (
                                                    <Button
                                                        size="sm"
                                                        onClick={() => handleConnect(entry)}
                                                        disabled={connecting || !can('integrations', 'create')}
                                                    >
                                                        {connecting ? (
                                                            <>
                                                                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                                                Connecting...
                                                            </>
                                                        ) : (
                                                            'Connect'
                                                        )}
                                                    </Button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                </div>
            </div>

            {/* Disconnect confirmation dialog */}
            <AlertDialog
                open={!!disconnectTarget}
                onOpenChange={(open) => !open && setDisconnectTarget(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Disconnect {disconnectTarget?.name}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Your agent will lose access to{' '}
                            {disconnectTarget?.scopes.join(', ')}.
                            You can reconnect at any time.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={disconnecting}>
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDisconnectConfirm}
                            disabled={disconnecting}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {disconnecting ? (
                                <>
                                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                    Disconnecting...
                                </>
                            ) : (
                                'Disconnect'
                            )}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </PermissionGate>
    );
}
