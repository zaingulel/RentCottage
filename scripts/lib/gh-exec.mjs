// gh-exec.mjs — the shared `gh` CLI wrapper that reports GraphQL-quota exhaustion
// honestly.
//
// #461: when the GitHub GraphQL hourly budget is exhausted, `gh` fails with
// misleading messages ("unknown owner type", "API rate limit exceeded for user ID
// ..." with no reset time). In the 2026-07-20 incident this sent debugging toward
// auth when the real answer was "wait 90 seconds". `ghExec` runs the real command
// and, ONLY on failure, probes the free `rate_limit` endpoint (costs nothing against
// the quota) — if the quota is genuinely the culprit it rethrows a new error naming
// the true cause + reset time; otherwise it rethrows the ORIGINAL error unchanged so
// the probe can never mask a real failure.

import { execFileSync } from 'node:child_process';

function defaultExec(args) {
  // Bounded timeout so a hung gh process (network stall, stray auth prompt) fails
  // loud instead of blocking a ritual forever; 60s covers the slowest --paginate
  // reads with wide margin. Applies to the rate-limit probe too (same exec).
  return execFileSync('gh', args, { encoding: 'utf8', timeout: 60_000 });
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Pure: given the error a `gh` invocation threw and the parsed (or raw-string)
// `gh api rate_limit` payload — or null/undefined when the probe itself failed —
// decide what to throw. Never masks a real failure: any payload that isn't a clean
// "graphql quota is exhausted" shape falls through to the original error untouched.
export function classifyGhFailure(originalError, rateLimitJson) {
  if (rateLimitJson == null) return originalError;
  let payload;
  try {
    payload = typeof rateLimitJson === 'string' ? JSON.parse(rateLimitJson) : rateLimitJson;
  } catch {
    return originalError;
  }
  const graphql = payload?.resources?.graphql;
  if (!graphql || graphql.remaining !== 0) return originalError;
  const reset = new Date(graphql.reset * 1000);
  const hhmm = `${pad2(reset.getHours())}:${pad2(reset.getMinutes())}`;
  return new Error(
    `GitHub GraphQL quota exhausted (0/${graphql.limit}) — resets ${hhmm} — retry after that\n` +
    `underlying: ${originalError.message}`,
  );
}

// The wrapper CLIs call instead of invoking `gh` directly. `execImpl(args) → stdout`
// is injectable (defaults to a real `execFileSync('gh', ...)` call) so this is
// testable without `gh`. On failure, probes `rate_limit` in its OWN try/catch — a
// probe failure rethrows the original error, never the probe's.
export function ghExec(args, execImpl = defaultExec) {
  try {
    return execImpl(args);
  } catch (originalError) {
    let probePayload;
    try {
      probePayload = execImpl(['api', 'rate_limit']);
    } catch {
      throw originalError;
    }
    throw classifyGhFailure(originalError, probePayload);
  }
}
