interface BookingRequestRuntimeEnvironment {
  readonly APP_ENVIRONMENT?: string;
  readonly SUPABASE_PROJECT_REF?: string;
  readonly SUPABASE_URL?: string;
}

const loopbackHostnames = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function bookingRequestTestRuntimeIsEnabled(
  environment: BookingRequestRuntimeEnvironment = process.env,
): boolean {
  if (
    environment.APP_ENVIRONMENT !== "test" ||
    environment.SUPABASE_PROJECT_REF !== "local-test" ||
    typeof environment.SUPABASE_URL !== "string"
  ) {
    return false;
  }
  try {
    const supabaseOrigin = new URL(environment.SUPABASE_URL);
    return (
      supabaseOrigin.protocol === "http:" &&
      loopbackHostnames.has(supabaseOrigin.hostname)
    );
  } catch {
    return false;
  }
}
