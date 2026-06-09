import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from './lib/supabase/middleware';

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
  '/settings'
];

export async function middleware(request: NextRequest) {
  const response = await updateSession(request);
  const isProtected = protectedPrefixes.some((prefix) => request.nextUrl.pathname.startsWith(prefix));

  if (!isProtected) return response;

  const hasSupabaseCookies = request.cookies.getAll().some((cookie) => cookie.name.startsWith('sb-'));
  if (!hasSupabaseCookies) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('redirectedFrom', request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
