/**
 * Runtime configuration helper for Docker/self-hosted deployments.
 *
 * Next.js inlines NEXT_PUBLIC_* env vars at build time, which means they are
 * empty when the Docker image is built without them. This module reads from
 * window.__RUNTIME_CONFIG__ (injected by layout.tsx at request time) first,
 * then falls back to process.env for Vercel / dev builds where the value is
 * already inlined correctly.
 */

declare global {
  interface Window {
    __RUNTIME_CONFIG__?: {
      NEXT_PUBLIC_AZURE_AD_CLIENT_ID?: string;
    };
  }
}

export function getPublicClientId(): string {
  // 1. Try runtime injected config (Client-side, Docker/Azure Web App)
  if (typeof window !== "undefined" && window.__RUNTIME_CONFIG__?.NEXT_PUBLIC_AZURE_AD_CLIENT_ID) {
    return window.__RUNTIME_CONFIG__.NEXT_PUBLIC_AZURE_AD_CLIENT_ID;
  }

  // 2. Try process.env with bracket notation (Server-side, avoids inlining empty string at build time)
  // This is crucial for Azure Web App where env vars are injected into the process
  if (process.env["NEXT_PUBLIC_AZURE_AD_CLIENT_ID"]) {
    return process.env["NEXT_PUBLIC_AZURE_AD_CLIENT_ID"];
  }

  // 3. Fallback to standard process.env (Client-side dev, Vercel)
  // This might return empty string if built in Docker without env vars
  const inlined = process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID;
  if (inlined) {
    return inlined;
  }

  // 4. Log error if missing (critical for auth)
  if (typeof window !== "undefined") {
    console.error("IntuneGet: NEXT_PUBLIC_AZURE_AD_CLIENT_ID is missing from both runtime config and process.env!");
  }

  return "";
}
