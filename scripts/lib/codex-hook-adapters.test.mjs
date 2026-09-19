// codex-hook-adapters.test.mjs — the Codex handoff payload adapter,
// including the fail-open decision for an encrypted dispatch body.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  codexHandoffForGuard,
  isOpaqueDispatchMessage,
} from "./codex-hook-adapters.mjs";

test("codexHandoffForGuard maps the Codex dispatch shape onto the shared handoff shape", () => {
  assert.deepEqual(
    codexHandoffForGuard({ agent_type: "builder", message: "Slice: x" }),
    { subagent_type: "builder", prompt: "Slice: x" },
  );
  assert.deepEqual(codexHandoffForGuard(undefined), {
    subagent_type: undefined,
    prompt: undefined,
  });
});

test("isOpaqueDispatchMessage accepts only a full Fernet-shaped token", () => {
  const opaque = `gAAAAA${"A".repeat(100)}`;
  assert.equal(isOpaqueDispatchMessage(opaque), true);
  assert.equal(isOpaqueDispatchMessage("gAAAAABshort"), false);
  assert.equal(
    isOpaqueDispatchMessage(
      "Slice: booking request\nClaim: renders pending copy\n",
    ),
    false,
  );
  assert.equal(isOpaqueDispatchMessage(42), false);
  assert.equal(isOpaqueDispatchMessage(undefined), false);
});
