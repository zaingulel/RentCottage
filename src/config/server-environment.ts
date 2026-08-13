export type AppEnvironment = "development" | "test" | "preview" | "production";

interface EnvironmentSource {
  APP_ENVIRONMENT?: string;
  SUPABASE_PROJECT_REF?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  NEXT_PUBLIC_SUPABASE_SECRET_KEY?: string;
}

export interface ServerEnvironment {
  name: AppEnvironment;
  supabase: {
    projectRef: string;
    url: string;
    publishableKey: string;
    secretKey: string;
  };
}

const environmentNames = new Set<AppEnvironment>([
  "development",
  "test",
  "preview",
  "production",
]);

function required(source: EnvironmentSource, key: keyof EnvironmentSource) {
  const value = source[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

export function readServerEnvironment(
  source: EnvironmentSource,
): ServerEnvironment {
  if (source.NEXT_PUBLIC_SUPABASE_SECRET_KEY) {
    throw new Error("NEXT_PUBLIC_SUPABASE_SECRET_KEY must never be exposed");
  }

  const name = required(source, "APP_ENVIRONMENT");
  if (!environmentNames.has(name as AppEnvironment)) {
    throw new Error(`Unsupported APP_ENVIRONMENT: ${name}`);
  }

  const projectRef = required(source, "SUPABASE_PROJECT_REF");
  const url = required(source, "SUPABASE_URL");
  if (!url.startsWith("http://127.0.0.1") && !url.includes(projectRef)) {
    throw new Error("SUPABASE_URL does not match SUPABASE_PROJECT_REF");
  }

  return {
    name: name as AppEnvironment,
    supabase: {
      projectRef,
      url,
      publishableKey: required(source, "SUPABASE_PUBLISHABLE_KEY"),
      secretKey: required(source, "SUPABASE_SECRET_KEY"),
    },
  };
}
