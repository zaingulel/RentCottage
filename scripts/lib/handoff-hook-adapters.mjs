import { checkHandoff } from "./handoff-check.mjs";

const FERNET_SHAPED_RE = /^gAAAAA[A-Za-z0-9_-]+={0,2}$/;
const MINIMUM_FERNET_FRAME_BYTES = 57;

function normalizedAgentType(value) {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function mapClaudeHandoff(payload) {
  return {
    agentType: normalizedAgentType(payload?.tool_input?.subagent_type),
    prompt: payload?.tool_input?.prompt,
  };
}

export function mapCodexHandoff(payload) {
  return {
    agentType: normalizedAgentType(payload?.tool_input?.agent_type),
    prompt: payload?.tool_input?.message,
  };
}

function isOpaquePrompt(prompt) {
  if (
    typeof prompt !== "string" ||
    prompt.includes("\n") ||
    prompt.includes("\r") ||
    !FERNET_SHAPED_RE.test(prompt)
  ) {
    return false;
  }
  return Buffer.from(prompt, "base64url").length >= MINIMUM_FERNET_FRAME_BYTES;
}

function checkMappedHandoff(mapped) {
  const result = checkHandoff(mapped);
  if (result.outcome !== "out-of-scope" && isOpaquePrompt(mapped.prompt)) {
    return {
      outcome: "unvalidated",
      reason:
        "guarded handoff prompt was opaque and unavailable for structural validation",
    };
  }
  return result;
}

export function checkClaudeHandoff(payload) {
  return checkMappedHandoff(mapClaudeHandoff(payload));
}

export function checkCodexHandoff(payload) {
  return checkMappedHandoff(mapCodexHandoff(payload));
}
