import { execFileSync } from "node:child_process";

export function boundedDiagnostic(value, limit = 1_000) {
  const normalized = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+\b/g, "[REDACTED]")
    .replace(/\b(Bearer)\s+\S+/gi, "$1 [REDACTED]")
    .replace(
      /\b(token|secret|password|authorization)\s*[:=]\s*\S+/gi,
      "$1=[REDACTED]",
    )
    .trim();
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, limit)}... [truncated]`;
}

export function errorDiagnostic(error, limit = 1_000) {
  return boundedDiagnostic(error?.message ?? error, limit) || "Unknown error";
}

export function graphqlResponseError(context, errors) {
  const errorList = Array.isArray(errors) ? errors : [];
  const codes = [
    ...new Set(
      errorList
        .map((error) => error?.extensions?.code)
        .filter(
          (code) =>
            typeof code === "string" && /^[A-Z][A-Z0-9_.-]{0,79}$/.test(code),
        ),
    ),
  ].slice(0, 10);
  const codeSummary = codes.length > 0 ? ` codes=${codes.join(",")}` : "";
  return new Error(
    `${boundedDiagnostic(context, 240)} failed: GraphQL returned ${errorList.length} error(s)${codeSummary}`,
  );
}

export function graphqlResponseErrors(response, context) {
  const safeContext = boundedDiagnostic(context, 240);
  if (
    response === null ||
    typeof response !== "object" ||
    Array.isArray(response)
  )
    throw new Error(
      `${safeContext} returned malformed GraphQL response evidence`,
    );
  if (!Object.hasOwn(response, "errors")) return [];
  if (!Array.isArray(response.errors))
    throw new Error(
      `${safeContext} returned malformed GraphQL errors evidence`,
    );
  return response.errors;
}

export function runGh(
  args,
  { input, execute = execFileSync, timeoutMs = 60_000 } = {},
) {
  try {
    return execute("gh", args, {
      encoding: "utf8",
      input,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      timeout: timeoutMs,
    }).trim();
  } catch (error) {
    if (error.code === "ETIMEDOUT" || error.killed === true)
      throw new Error(`gh ${args.join(" ")} timed out after ${timeoutMs}ms`);
    const command = boundedDiagnostic(args.slice(0, 3).join(" "), 240);
    const stderr = boundedDiagnostic(error.stderr, 1_000);
    const status = Number.isInteger(error.status) ? error.status : "unknown";
    const signal = typeof error.signal === "string" ? error.signal : "none";
    throw new Error(
      `gh ${command} failed status=${status} signal=${signal}${stderr ? ` stderr=${stderr}` : ""}`,
    );
  }
}
