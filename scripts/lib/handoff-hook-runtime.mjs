export async function runHandoffHook(
  checkProviderHandoff,
  {
    input = process.stdin,
    stdout = process.stdout,
    stderr = process.stderr,
  } = {},
) {
  let raw = "";
  for await (const chunk of input) raw += chunk;

  let result;
  try {
    result = checkProviderHandoff(JSON.parse(raw));
  } catch {
    result = {
      outcome: "unvalidated",
      reason: "hook input was not valid JSON",
    };
  }

  if (result.outcome === "rejected") {
    stderr.write(`${result.reason}\n`);
    return 2;
  }

  if (result.outcome === "unvalidated") {
    stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: `Handoff contract NOT validated: ${result.reason}`,
        },
      })}\n`,
    );
  }

  return 0;
}
