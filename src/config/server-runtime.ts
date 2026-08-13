import { readServerEnvironment } from "./server-environment";

export function getServerEnvironment() {
  return readServerEnvironment({
    APP_ENVIRONMENT: process.env.APP_ENVIRONMENT,
    SUPABASE_PROJECT_REF: process.env.SUPABASE_PROJECT_REF,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    NEXT_PUBLIC_SUPABASE_SECRET_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_SECRET_KEY,
  });
}
