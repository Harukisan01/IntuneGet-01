import { NextRequest, NextResponse } from 'next/server';

const PROTECTED_ROUTES = ['/dashboard'];

// Rotte escluse dal redirect di setup (la pagina setup stessa e le sue API)
const SETUP_EXCLUDED = ['/setup', '/api/setup', '/_next', '/favicon', '/icons'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── SETUP AUTOMATICO ──────────────────────────────────────────────────────
  // Se NEXT_PUBLIC_AZURE_AD_CLIENT_ID non è configurata, l'app non può
  // autenticarsi. Redirect a /setup finché non viene configurata.
  const isSetupRoute = SETUP_EXCLUDED.some((r) => pathname.startsWith(r));
  if (!isSetupRoute) {
    const clientId = process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID;
    if (!clientId || clientId.trim() === '') {
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
