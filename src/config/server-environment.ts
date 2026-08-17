export type AppEnvironment = "development" | "test" | "preview" | "production";

interface EnvironmentSource {
  APP_ENVIRONMENT?: string;
  SUPABASE_PROJECT_REF?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  PRIVILEGED_AUDIT_HMAC_KEY?: string;
  DEPLOYMENT_COMMIT?: string;
  NEXT_PUBLIC_SUPABASE_SECRET_KEY?: string;
  NEXT_PUBLIC_PRIVILEGED_AUDIT_HMAC_KEY?: string;
}

export interface ServerEnvironment {
  name: AppEnvironment;
  deployment: {
    commit: string | null;
  };
  supabase: {
    projectRef: string;
    url: string;
    publishableKey: string;
    secretKey: string;
  };
  privilegedAuditHmacKey: string;
}

export type PublicSupabaseEnvironment = Omit<
  ServerEnvironment,
  "supabase" | "privilegedAuditHmacKey" | "deployment"
> & {
  supabase: Omit<ServerEnvironment["supabase"], "secretKey">;
};

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

export function readPublicSupabaseEnvironment(
  source: EnvironmentSource,
): PublicSupabaseEnvironment {
  if (source.NEXT_PUBLIC_SUPABASE_SECRET_KEY) {
    throw new Error("NEXT_PUBLIC_SUPABASE_SECRET_KEY must never be exposed");
  }
  if (source.NEXT_PUBLIC_PRIVILEGED_AUDIT_HMAC_KEY) {
    throw new Error(
      "NEXT_PUBLIC_PRIVILEGED_AUDIT_HMAC_KEY must never be exposed",
    );
  }

  const name = required(source, "APP_ENVIRONMENT");
  if (!environmentNames.has(name as AppEnvironment)) {
    throw new Error(`Unsupported APP_ENVIRONMENT: ${name}`);
  }

  const projectRef = required(source, "SUPABASE_PROJECT_REF");
  const url = required(source, "SUPABASE_URL");
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("SUPABASE_URL must be a valid URL");
  }

  const isLoopback =
    parsedUrl.hostname === "127.0.0.1" &&
    (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:");
  const isProjectOrigin =
    parsedUrl.origin === `https://${projectRef}.supabase.co`;
  if (!isLoopback && !isProjectOrigin) {
    throw new Error("SUPABASE_URL does not match SUPABASE_PROJECT_REF");
  }

  return {
    name: name as AppEnvironment,
    supabase: {
      projectRef,
      url,
      publishableKey: required(source, "SUPABASE_PUBLISHABLE_KEY"),
    },
  };
}

export function readServerEnvironment(
  source: EnvironmentSource,
): ServerEnvironment {
  const environment = readPublicSupabaseEnvironment(source);
  const privilegedAuditHmacKey = required(source, "PRIVILEGED_AUDIT_HMAC_KEY");
  if (privilegedAuditHmacKey.length < 32) {
    throw new Error("PRIVILEGED_AUDIT_HMAC_KEY must be at least 32 characters");
  }
  const deploymentCommit = source.DEPLOYMENT_COMMIT;
  const isHosted =
    environment.name === "preview" || environment.name === "production";
  if (
    (isHosted && !deploymentCommit) ||
    (deploymentCommit !== undefined && !/^[0-9a-f]{40}$/.test(deploymentCommit))
  ) {
    throw new Error(
      "DEPLOYMENT_COMMIT must be a 40-character Git commit in hosted environments",
    );
  }
  return {
    ...environment,
    deployment: { commit: deploymentCommit ?? null },
    privilegedAuditHmacKey,
    supabase: {
      ...environment.supabase,
      secretKey: required(source, "SUPABASE_SECRET_KEY"),
    },
  };
}
