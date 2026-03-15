"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

interface InviteDetails {
    tenantName: string;
    tenantSlug: string;
    roleName: string;
    inviterName: string;
    email: string;
    expiresAt: string;
}

interface UserProfile {
    email: string;
    name: string;
}

export default function InvitePage() {
    const router = useRouter();
    const params = useParams();
    const token = params.token as string;

    const [invite, setInvite] = useState<InviteDetails | null>(null);
    const [user, setUser] = useState<UserProfile | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isAccepting, setIsAccepting] = useState(false);

    useEffect(() => {
        async function fetchData() {
            try {
                // 1. Fetch invite details
                const inviteRes = await fetch(`/api/proxy/api/v1/invitations/${token}`);
                if (!inviteRes.ok) {
                    const data = await inviteRes.json();
                    throw new Error(data.error || "Invalid or expired invitation");
                }
                const inviteData = await inviteRes.json();
                setInvite(inviteData);

                // 2. Fetch auth status
                const profileRes = await fetch("/api/proxy/api/v1/auth/me");
                if (profileRes.ok) {
                    const profileData = await profileRes.json();
                    setUser(profileData);
                }
            } catch (err: any) {
                console.error("Fetch Error:", err);
                setError(err.message || "Failed to load invitation details");
            } finally {
                setIsLoading(false);
            }
        }

        if (token) {
            fetchData();
        }
    }, [token]);

    async function handleAccept() {
        setIsAccepting(true);
        setError(null);

        try {
            const res = await fetch(`/api/proxy/api/v1/invitations/${token}/accept`, {
                method: "POST",
            });

            if (!res.ok) {
                const data = await res.json();
                if (data.code === "EMAIL_MISMATCH") {
                    throw new Error(`You're signed in as ${user?.email} but this invite was sent to ${invite?.email}. Please sign in with the correct account.`);
                }
                throw new Error(data.error || "Failed to accept invitation");
            }

            const data = await res.json();

            // Clear session and redirect to login to get fresh JWT claims
            await fetch("/api/auth/session", { method: "DELETE" });

            router.push(`/auth/login?invited=true&slug=${data.tenantSlug}`);
            router.refresh();
        } catch (err: any) {
            console.error("Accept Error:", err);
            setError(err.message || "An error occurred while accepting the invitation");
        } finally {
            setIsAccepting(false);
        }
    }

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen">
                <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
                <p className="text-muted-foreground">Loading invitation details...</p>
            </div>
        );
    }

    if (error && !invite) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center">
                <Card className="w-full max-w-md">
                    <CardHeader>
                        <CardTitle className="text-destructive">Invitation Error</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-muted-foreground">{error}</p>
                    </CardContent>
                    <CardFooter className="justify-center">
                        <Button variant="outline" onClick={() => router.push("/auth/login")}>
                            Back to login
                        </Button>
                    </CardFooter>
                </Card>
            </div>
        );
    }

    const isLoggedIn = !!user;

    return (
        <div className="flex items-center justify-center min-h-screen bg-background">
            <Card className="w-full max-w-md p-2 border border-border bg-card shadow-sm">
                <CardHeader className="text-center space-y-1">
                    <CardTitle className="text-2xl font-bold">Join the Team</CardTitle>
                    <CardDescription>
                        You've been invited to join <strong>{invite?.tenantName}</strong>
                    </CardDescription>
                </CardHeader>

                <CardContent className="space-y-4">
                    <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Invited by:</span>
                            <span className="font-medium text-foreground">{invite?.inviterName}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Role:</span>
                            <span className="font-medium text-foreground">{invite?.roleName}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">Sent to:</span>
                            <span className="font-medium text-foreground">{invite?.email}</span>
                        </div>
                    </div>

                    {error && (
                        <div className="p-3 text-sm font-medium text-destructive bg-destructive/10 rounded-md">
                            {error}
                        </div>
                    )}
                </CardContent>

                <CardFooter className="flex flex-col space-y-2">
                    {isLoggedIn ? (
                        <Button
                            className="w-full"
                            onClick={handleAccept}
                            disabled={isAccepting}
                        >
                            {isAccepting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Accept Invitation
                        </Button>
                    ) : (
                        <>
                            <Button
                                className="w-full"
                                onClick={() => router.push(`/auth/login?redirect=/auth/invite/${token}`)}
                            >
                                Sign in to accept
                            </Button>
                        </>
                    )}
                </CardFooter>
            </Card>
        </div>
    );
}
