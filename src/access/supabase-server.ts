import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getServerEnvironment } from "@/config/server-runtime";
import { supabaseAuthCookieName } from "./supabase-auth-cookie";

export async function createRequestSupabaseClient(
  cookieAccess: "read-write" | "read-only" = "read-write",
) {
  const cookieStore = await cookies();
  const { supabase } = getServerEnvironment();

  return createServerClient(supabase.url, supabase.publishableKey, {
    cookieOptions: { name: supabaseAuthCookieName },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (values) => {
        // Revoked-session cleanup cannot write render cookies; middleware owns response persistence.
        if (cookieAccess === "read-only") return;
        for (const { name, value, options } of values) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });
}

export async function clearRequestSupabaseSession() {
  const cookieStore = await cookies();

  for (const cookie of cookieStore.getAll()) {
    if (cookie.name.startsWith(supabaseAuthCookieName)) {
      cookieStore.set(cookie.name, "", { path: "/", maxAge: 0 });
    }
  }
}
