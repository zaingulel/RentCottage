import { createClient } from "@supabase/supabase-js";

import { getServerEnvironment } from "@/config/server-runtime";

export function createSupabaseServerClient() {
  const { supabase } = getServerEnvironment();

  return createClient(supabase.url, supabase.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
