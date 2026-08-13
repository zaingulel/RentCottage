import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const USAGE = "Usage: npm run verify:preview -- <https-preview-url>";

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

async function requireSuccessfulResponse(fetchImpl, url, description) {
  const response = await fetchImpl(url, { redirect: "error" });
  if (!response.ok) {
    throw new Error(`${description} returned HTTP ${response.status}`);
  }
  return response;
}

export async function verifyPreview(origin, fetchImpl = fetch) {
  const shellUrl = new URL("/ar", origin).href;
  const healthUrl = new URL("/api/health?check=supabase", origin).href;

  await requireSuccessfulResponse(fetchImpl, shellUrl, "Arabic shell");
  const healthResponse = await requireSuccessfulResponse(
    fetchImpl,
    healthUrl,
    "Supabase health check",
  );
  const health = await healthResponse.json();
  if (health?.ok !== true || health?.supabase?.connected !== true) {
    throw new Error("Hosted health check did not prove Supabase connectivity");
  }

  return { shellUrl, healthUrl };
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
    await verifyPreview(origin, fetchImpl);
    stdout(`Verified preview ${origin.href} at commit ${resolveCommit()}`);
    return 0;
  } catch (error) {
    stderr(`Preview verification failed: ${error.message}`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
