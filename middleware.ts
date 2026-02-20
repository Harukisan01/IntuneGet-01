import { NextRequest, NextResponse } from 'next/server';

const PROTECTED_ROUTES = ['/dashboard'];

// Rotte escluse dal redirect di setup
const SETUP_EXCLUDED = ['/setup', '/api/setup', '/_next', '/favicon', '/icons'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── SETUP AUTOMATICO ──────────────────────────────────────────────────────
  // NOTA: NEXT_PUBLIC_* vars sono inlined a build-time e risultano vuote
  // nell'Edge/Node middleware a runtime. Usiamo una variabile server-side
  // (AZURE_CLIENT_SECRET) come indicatore che l'app è configurata.
  const isSetupRoute = SETUP_EXCLUDED.some((r) => pathname.startsWith(r));
  if (!isSetupRoute) {
    const isConfigured =
      process.env.AZURE_CLIENT_SECRET ||
      process.env.AZURE_AD_CLIENT_SECRET;

    if (!isConfigured) {
      return NextResponse.redirect(new URL('/setup', request.url));
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  // Protect dashboard routes: redirect to sign-in if no auth hint cookie
  const isProtected = PROTECTED_ROUTES.some((route) => pathname.startsWith(route));
  if (isProtected) {
    const authHint = request.cookies.get('msal-auth-hint');
    if (!authHint?.value) {
      const signinUrl = new URL('/auth/signin', request.url);
      signinUrl.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(signinUrl);
    }
  }

  const response = NextResponse.next();

  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/).*)'],
};
