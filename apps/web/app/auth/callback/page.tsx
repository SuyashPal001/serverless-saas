"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

function CallbackContent() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get("code");

    if (!code) {
      setError("No authorization code found in the URL.");
      return;
    }

    async function exchangeCode() {
      try {
        const domain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN;
        const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
        const callbackUrl = process.env.NEXT_PUBLIC_COGNITO_CALLBACK_URL;

        // 1. Exchange code for tokens
        const tokenResponse = await fetch(`${domain}/oauth2/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: clientId!,
            redirect_uri: callbackUrl!,
            code: code ?? "",
          }),
        });

        if (!tokenResponse.ok) {
          const errData = await tokenResponse.json();
          throw new Error(errData.error_description || errData.error || "Failed to exchange code for tokens");
        }

        const tokens = await tokenResponse.json();
        const idToken = tokens.id_token;

        // 2. Create session — sets platform_token httpOnly cookie
        const sessionResponse = await fetch("/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: idToken }),
        });

        if (!sessionResponse.ok) {
          throw new Error("Failed to create session on the server");
        }

        // 3. Decode JWT claims
        const payloadBase64 = idToken.split(".")[1];
        const payloadJson = atob(payloadBase64);
        const claims = JSON.parse(payloadJson);

        const tenantSlug = claims["custom:tenantSlug"];

        // 4. Wait for browser to commit the cookie before navigating
        await new Promise(resolve => setTimeout(resolve, 200));

        // 5. Hard redirect — forces full page load so cookie is read fresh
        if (tenantSlug) {
          window.location.href = `/${tenantSlug}/dashboard`;
        } else {
          window.location.href = "/onboarding";
        }
      } catch (err: any) {
        console.error("Auth callback error:", err);
        setError(err.message || "An error occurred during authentication.");
      }
    }

    exchangeCode();
  }, [searchParams]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 text-center">
        <h1 className="text-2xl font-bold text-destructive mb-4">Authentication Error</h1>
        <p className="text-muted-foreground mb-6">{error}</p>
        <a href="/auth/login" className="text-primary hover:underline font-medium">
          Back to login
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
      <p className="text-muted-foreground">Completing sign in...</p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="flex flex-col items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Loading...</p>
      </div>
    }>
      <CallbackContent />
    </Suspense>
  );
}