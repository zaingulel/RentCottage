import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { readPublicSupabaseEnvironment } from "@/config/server-environment";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { supabase } = readPublicSupabaseEnvironment({
    APP_ENVIRONMENT: process.env.APP_ENVIRONMENT,
    SUPABASE_PROJECT_REF: process.env.SUPABASE_PROJECT_REF,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_SECRET_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_SECRET_KEY,
  });
  const client = createServerClient(supabase.url, supabase.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values) => {
        for (const { name, value } of values) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of values) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  await client.auth.getClaims();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|uploads/).*)"],
};
