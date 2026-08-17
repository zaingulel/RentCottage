import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const USAGE = "Usage: npm run verify:preview -- <https-preview-url>";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 6;
const RETRY_DELAY_MS = 1_000;

class PreviewVerificationError extends Error {
  constructor(message, retryable, options) {
    super(message, options);
    this.retryable = retryable;
  }
}

const wait = (delayMs) =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

export function parsePreviewUrl(value) {
  const url = new URL(value);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";

  if (
    (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
    url.username ||
    url.password
  ) {
    throw new Error(USAGE);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(USAGE);
  }
  return url;
}

async function requireSuccessfulResponse(
  fetchImpl,
  url,
  description,
  parseJson = false,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new PreviewVerificationError(
        `${description} returned HTTP ${response.status}`,
        response.status === 404 ||
          response.status === 429 ||
          response.status >= 500,
      );
    }
    if (!parseJson) return response;
    try {
      return await response.json();
    } catch (error) {
      throw new PreviewVerificationError(
        `${description} returned invalid JSON`,
        true,
        { cause: error },
      );
    }
  } catch (error) {
    if (error instanceof PreviewVerificationError) throw error;
    if (controller.signal.aborted) {
      throw new PreviewVerificationError(
        `${description} timed out after ${REQUEST_TIMEOUT_MS}ms`,
        true,
        { cause: error },
      );
    }
    throw new PreviewVerificationError(
      `${description} request failed: ${error.message}`,
      true,
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyPreviewAttempt(origin, expectedCommit, fetchImpl) {
  const shellUrl = new URL("/ar", origin).href;
  const healthUrl = new URL("/api/health?check=supabase", origin).href;

  await requireSuccessfulResponse(fetchImpl, shellUrl, "Arabic shell");
  const health = await requireSuccessfulResponse(
    fetchImpl,
    healthUrl,
    "Supabase health check",
    true,
  );
  if (health?.ok !== true || health?.supabase?.connected !== true) {
    throw new PreviewVerificationError(
      "Hosted health check did not prove Supabase connectivity",
      true,
    );
  }
  if (health?.deployment?.commit !== expectedCommit) {
    throw new PreviewVerificationError(
      `Hosted preview did not serve expected commit ${expectedCommit}`,
      true,
    );
  }

  return { shellUrl, healthUrl };
}

export async function verifyPreview(
  origin,
  expectedCommit,
  fetchImpl = fetch,
  {
    maxAttempts = MAX_ATTEMPTS,
    retryDelayMs = RETRY_DELAY_MS,
    sleep = wait,
  } = {},
) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await verifyPreviewAttempt(origin, expectedCommit, fetchImpl);
    } catch (error) {
      lastError = error;
      if (!error.retryable || attempt === maxAttempts) throw error;
      await sleep(retryDelayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

function currentCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
}

export async function main(
  args,
  {
    fetchImpl = fetch,
    resolveCommit = currentCommit,
    retryOptions,
    stderr = console.error,
    stdout = console.log,
  } = {},
) {
  let origin;
  try {
    if (args.length !== 1) throw new Error(USAGE);
    origin = parsePreviewUrl(args[0]);
  } catch {
    stderr(USAGE);
    return 2;
  }

  try {
    const commit = resolveCommit();
    await verifyPreview(origin, commit, fetchImpl, retryOptions);
    stdout(`Verified preview ${origin.href} at commit ${commit}`);
    return 0;
  } catch (error) {
    stderr(`Preview verification failed: ${error.message}`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
