import { pathToFileURL } from "node:url";

const REQUEST_TIMEOUT_MS = 10_000;

class SupabaseSecretVerificationError extends Error {
  constructor(category, options) {
    super(category, options);
    this.category = category;
  }
}

function requiredExact(source, key) {
  const value = source[key];
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value !== value.trim()
  ) {
    throw new Error(`${key} is invalid`);
  }
  return value;
}

export async function verifySupabaseSecret(source, fetchImpl = fetch) {
  let origin;
  let secretKey;
  try {
    const projectRef = requiredExact(source, "SUPABASE_PROJECT_REF");
    const url = requiredExact(source, "SUPABASE_URL");
    secretKey = requiredExact(source, "SUPABASE_SECRET_KEY");
    origin = new URL(url);
    if (
      origin.origin !== `https://${projectRef}.supabase.co` ||
      url !== origin.origin
    ) {
      throw new Error("project origin mismatch");
    }
  } catch (error) {
    throw new SupabaseSecretVerificationError("invalid configuration", {
      cause: error,
    });
  }

  let response;
  try {
    response = await fetchImpl(`${origin.origin}/rest/v1/`, {
      headers: { apikey: secretKey },
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new SupabaseSecretVerificationError("unable to reach Supabase", {
      cause: error,
    });
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new SupabaseSecretVerificationError("secret rejected");
    }
    if (response.status === 429 || response.status >= 500) {
      throw new SupabaseSecretVerificationError("provider unavailable");
    }
    throw new SupabaseSecretVerificationError("unexpected Supabase response");
  }
}

export async function main(
  args,
  { source = process.env, fetchImpl = fetch, stderr = console.error } = {},
) {
  if (args.length !== 0) return 2;
  try {
    await verifySupabaseSecret(source, fetchImpl);
    return 0;
  } catch (error) {
    const category =
      error instanceof SupabaseSecretVerificationError
        ? error.category
        : "unexpected error";
    stderr(`Supabase server secret verification failed: ${category}`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
