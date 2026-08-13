import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getServerEnvironment } from "@/config/server-runtime";

export async function createRequestSupabaseClient() {
  const cookieStore = await cookies();
  const { supabase } = getServerEnvironment();

  return createServerClient(supabase.url, supabase.publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (values) => {
        for (const { name, value, options } of values) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });
}
