export function initiateGoogleSignIn(): void {
  const domain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN!;
  const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID!;
  const callbackUrl = process.env.NEXT_PUBLIC_COGNITO_CALLBACK_URL!;

  const url = `${domain}/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(callbackUrl)}&identity_provider=Google&scope=openid%20email%20profile`;

  window.location.href = url;
}
