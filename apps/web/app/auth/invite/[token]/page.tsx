"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signUp, confirmSignUp, resendConfirmationCode, signIn } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
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

const createAccountSchema = z.object({
    name: z.string().min(1, { message: "Name is required" }),
    password: z.string().min(8, { message: "Password must be at least 8 characters" }),
    confirmPassword: z.string(),
}).refine(d => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
});

const verifySchema = z.object({
    code: z.string().length(6, { message: "Verification code must be 6 digits" }),
});

type CreateAccountSchema = z.infer<typeof createAccountSchema>;
type VerifySchema = z.infer<typeof verifySchema>;

export default function InvitePage() {
    const router = useRouter();
    const params = useParams();
    const searchParams = useSearchParams();
    const token = params.token as string;
    const errorCode = searchParams.get("error");

    const [invite, setInvite] = useState<InviteDetails | null>(null);
    const [user, setUser] = useState<UserProfile | null>(null);
    const [emailExists, setEmailExists] = useState<boolean | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isCheckingEmail, setIsCheckingEmail] = useState(false);
    const [isAccepting, setIsAccepting] = useState(false);

    // New user signup flow steps
    const [createStep, setCreateStep] = useState<"form" | "verify">("form");
    const [pendingCredentials, setPendingCredentials] = useState<{ name: string; password: string } | null>(null);
    const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);
    const [resendSuccess, setResendSuccess] = useState(false);

    const createAccountForm = useForm<CreateAccountSchema>({
        resolver: zodResolver(createAccountSchema),
        defaultValues: { name: "", password: "", confirmPassword: "" },
    });

    const verifyForm = useForm<VerifySchema>({
        resolver: zodResolver(verifySchema),
        defaultValues: { code: "" },
    });

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

                // 2. Check if invited email has an existing account
                setIsCheckingEmail(true);
                try {
                    const checkEmailRes = await fetch(`/api/proxy/api/v1/auth/check-email?email=${encodeURIComponent(inviteData.email)}`);
                    if (checkEmailRes.ok) {
                        const checkData = await checkEmailRes.json();
                        setEmailExists(checkData.exists);
                    }
                } catch (e) {
                    console.error("Failed to check email existence:", e);
                } finally {
                    setIsCheckingEmail(false);
                }

                // 3. Fetch auth status
                let profileData = null;
                const profileRes = await fetch("/api/proxy/api/v1/auth/me");
                if (profileRes.ok) {
                    profileData = await profileRes.json();
                    setUser(profileData);
                }

                // 4. Handle OAuth callback errors
                if (errorCode) {
                    switch (errorCode) {
                        case "EMAIL_MISMATCH":
                            const currentEmail = profileData?.email ? ` as ${profileData.email}` : "";
                            setError(`You're signed in${currentEmail} but this invite was sent to ${inviteData.email}. Please sign out and sign in with the correct account.`);
                            break;
                        case "EXPIRED":
                            setError("This invitation has expired.");
                            break;
                        case "REVOKED":
                            setError("This invitation has been revoked.");
                            break;
                        case "ALREADY_ACCEPTED":
                            setError("This invitation has already been accepted.");
                            break;
                        case "ACCEPT_FAILED":
                            setError("Failed to accept invitation. Please try again.");
                            break;
                        default:
                            setError("An error occurred while processing your invitation.");
                    }
                }
            } catch (err: any) {
                console.error("Fetch Error:", err);
                if (!errorCode) {
                    setError(err.message || "Failed to load invitation details");
                }
            } finally {
                setIsLoading(false);
            }
        }

        if (token) {
            fetchData();
        }
    }, [token, errorCode]);

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

    async function handleCreateAccount(data: CreateAccountSchema) {
        if (!invite) return;
        setIsSubmittingCreate(true);
        setError(null);

        try {
            await signUp(data.name, invite.email, data.password);
            setPendingCredentials({ name: data.name, password: data.password });
            setCreateStep("verify");
        } catch (err: any) {
            console.error("SignUp error:", err);
            setError(err.message || "Failed to create account. Please try again.");
        } finally {
            setIsSubmittingCreate(false);
        }
    }

    async function handleVerifyAndAccept(data: VerifySchema) {
        if (!invite || !pendingCredentials) return;
        setIsSubmittingCreate(true);
        setError(null);

        try {
            // 1. Confirm Cognito account
            await confirmSignUp(invite.email, data.code);

            // 2. Sign in to get tokens
            const { idToken, refreshToken } = await signIn(invite.email, pendingCredentials.password);

            // 3. Set session cookie
            const sessionRes = await fetch("/api/auth/session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: idToken, refreshToken }),
            });
            if (!sessionRes.ok) throw new Error("Failed to create session");

            // 4. Accept the invitation
            const acceptRes = await fetch(`/api/proxy/api/v1/invitations/${token}/accept`, {
                method: "POST",
            });
            if (!acceptRes.ok) {
                const acceptData = await acceptRes.json();
                throw new Error(acceptData.error || "Failed to accept invitation");
            }
            const acceptData = await acceptRes.json();

            // 5. Clear session — user must re-login to get JWT with tenantId stamped
            await fetch("/api/auth/session", { method: "DELETE" });
            router.push(`/auth/login?invited=true&slug=${acceptData.tenantSlug}`);
            router.refresh();
        } catch (err: any) {
            console.error("Verify+Accept error:", err);
            setError(err.message || "An error occurred. Please try again.");
        } finally {
            setIsSubmittingCreate(false);
        }
    }

    async function handleResendCode() {
        if (!invite) return;
        setResendSuccess(false);
        setError(null);

        try {
            await resendConfirmationCode(invite.email);
            setResendSuccess(true);
        } catch (err: any) {
            console.error("Resend error:", err);
            setError(err.message || "Failed to resend code. Please try again.");
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
    const isEmailMatch = isLoggedIn && user?.email?.toLowerCase() === invite?.email?.toLowerCase();
    const isEmailMismatch = isLoggedIn && user?.email?.toLowerCase() !== invite?.email?.toLowerCase();
    const isNewUser = emailExists === false;
    const isExistingUser = emailExists === true;

    // New user — verify step (shown inline, overrides the normal card layout)
    if (!isLoggedIn && isNewUser && createStep === "verify") {
        return (
            <div className="flex items-center justify-center min-h-screen bg-background">
                <Card className="w-full max-w-md p-2 border border-border bg-card shadow-sm">
                    <CardHeader className="text-center space-y-1">
                        <CardTitle className="text-2xl font-bold">Verify your email</CardTitle>
                        <CardDescription>
                            We sent a 6-digit code to <span className="font-medium text-foreground">{invite?.email}</span>
                        </CardDescription>
                    </CardHeader>

                    <CardContent className="space-y-4">
                        {error && (
                            <div className="p-3 text-sm font-medium text-destructive bg-destructive/10 rounded-md">
                                {error}
                            </div>
                        )}
                        {resendSuccess && (
                            <div className="p-3 text-sm font-medium text-green-500 bg-green-500/10 rounded-md">
                                Verification code resent successfully!
                            </div>
                        )}

                        <Form {...verifyForm}>
                            <form onSubmit={verifyForm.handleSubmit(handleVerifyAndAccept)} className="space-y-4">
                                <FormField
                                    control={verifyForm.control}
                                    name="code"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Verification Code</FormLabel>
                                            <FormControl>
                                                <Input
                                                    placeholder="123456"
                                                    maxLength={6}
                                                    disabled={isSubmittingCreate}
                                                    {...field}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <Button type="submit" className="w-full" disabled={isSubmittingCreate}>
                                    {isSubmittingCreate && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    {isSubmittingCreate ? "Verifying..." : "Verify & Accept Invitation"}
                                </Button>
                            </form>
                        </Form>
                    </CardContent>

                    <CardFooter className="flex flex-col space-y-2">
                        <p className="text-sm text-muted-foreground">Didn't receive the code?</p>
                        <Button variant="outline" size="sm" onClick={handleResendCode}>
                            Resend code
                        </Button>
                    </CardFooter>
                </Card>
            </div>
        );
    }

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

                    {/* New user — create account form */}
                    {!isLoggedIn && isNewUser && (
                        <>
                            <div className="relative">
                                <div className="absolute inset-0 flex items-center">
                                    <span className="w-full border-t border-border" />
                                </div>
                                <div className="relative flex justify-center text-xs uppercase">
                                    <span className="bg-card px-2 text-muted-foreground">Create your account</span>
                                </div>
                            </div>

                            <Form {...createAccountForm}>
                                <form onSubmit={createAccountForm.handleSubmit(handleCreateAccount)} className="space-y-3">
                                    <FormField
                                        control={createAccountForm.control}
                                        name="name"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Your name</FormLabel>
                                                <FormControl>
                                                    <Input placeholder="John Doe" disabled={isSubmittingCreate} {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={createAccountForm.control}
                                        name="password"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Password</FormLabel>
                                                <FormControl>
                                                    <Input placeholder="••••••••" type="password" disabled={isSubmittingCreate} {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={createAccountForm.control}
                                        name="confirmPassword"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>Confirm password</FormLabel>
                                                <FormControl>
                                                    <Input placeholder="••••••••" type="password" disabled={isSubmittingCreate} {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <Button type="submit" className="w-full" disabled={isSubmittingCreate}>
                                        {isSubmittingCreate && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        {isSubmittingCreate ? "Creating account..." : "Create account & accept"}
                                    </Button>
                                </form>
                            </Form>
                        </>
                    )}
                </CardContent>

                <CardFooter className="flex flex-col space-y-2">
                    {/* Logged in, email matches — direct accept */}
                    {isLoggedIn && isEmailMatch && (
                        <Button className="w-full" onClick={handleAccept} disabled={isAccepting}>
                            {isAccepting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Accept Invitation
                        </Button>
                    )}

                    {/* Logged in, wrong account */}
                    {isEmailMismatch && (
                        <Button
                            variant="outline"
                            className="w-full"
                            onClick={async () => {
                                await fetch("/api/auth/session", { method: "DELETE" });
                                router.refresh();
                            }}
                        >
                            Sign out and use different account
                        </Button>
                    )}

                    {/* Not logged in, checking email status */}
                    {!isLoggedIn && isCheckingEmail && (
                        <div className="flex items-center justify-center w-full py-2">
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground mr-2" />
                            <span className="text-sm text-muted-foreground">Checking account...</span>
                        </div>
                    )}

                    {/* Not logged in, existing user — redirect to login */}
                    {!isLoggedIn && isExistingUser && !isCheckingEmail && (
                        <Button
                            className="w-full"
                            onClick={() => router.push(`/auth/login?redirect=/auth/invite/${token}`)}
                        >
                            Sign in to accept
                        </Button>
                    )}

                    {/* Not logged in, email check not yet complete */}
                    {!isLoggedIn && emailExists === null && !isCheckingEmail && (
                        <Button
                            className="w-full"
                            onClick={() => router.push(`/auth/login?redirect=/auth/invite/${token}`)}
                        >
                            Sign in to accept
                        </Button>
                    )}
                </CardFooter>
            </Card>
        </div>
    );
}
