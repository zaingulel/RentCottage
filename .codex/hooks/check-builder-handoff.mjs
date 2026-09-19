#!/usr/bin/env node

import { checkCodexHandoff } from "../../scripts/lib/handoff-hook-adapters.mjs";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;

let result;
try {
  result = checkCodexHandoff(JSON.parse(raw));
} catch {
  result = { outcome: "unvalidated", reason: "hook input was not valid JSON" };
}

if (result.outcome === "rejected") {
  console.error(result.reason);
  process.exit(2);
}

if (result.outcome === "unvalidated") {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: `Handoff contract NOT validated: ${result.reason}`,
      },
    }),
  );
}
