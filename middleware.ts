import { NextResponse, type NextRequest } from 'next/server';

const protectedPrefixes = [
  '/workspace',
  '/fiscal-years',
  '/dimensions',
  '/audit',
  '/layer1',
  '/baseline',
  '/drivers',
  '/reforecast',
  '/actuals',
  '/variance',
  '/waterfall',
  '/ai',
  '/settings',
  '/onboarding'
];

export function middleware(request: NextRequest) {
  const isProtected = protectedPrefixes.some((prefix) => request.nextUrl.pathname.startsWith(prefix));

  if (!isProtected) return NextResponse.next();

  const hasSupabaseCookies = request.cookies.getAll().some((cookie) => cookie.name.startsWith('sb-'));
  if (!hasSupabaseCookies) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('redirectedFrom', request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
