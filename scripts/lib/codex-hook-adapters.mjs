// Codex hook transport adapter — keeps provider payload shapes out of handoff policy.

export function codexHandoffForGuard(toolInput) {
  return {
    subagent_type: toolInput?.agent_type,
    prompt: toolInput?.message,
  };
}

// Codex encrypts a live dispatch body as a Fernet token at this version, so the handoff contract is
// unreadable even when the dispatch names an agent type. Anchored and newline-free, so a filled
// multi-line handoff template can never be mistaken for one. The length floor is the Fernet frame
// itself — version byte, 8-byte timestamp, 16-byte initialisation vector, 32-byte authentication tag
// — so a short `gAAAAA…` lookalike cannot skip validation it should have received.
const FERNET_FRAME_BYTES = 57;

export function isOpaqueDispatchMessage(message) {
  if (
    typeof message !== "string" ||
    !/^gAAAAA[A-Za-z0-9_-]+={0,2}$/.test(message)
  )
    return false;
  return Buffer.from(message, "base64url").length >= FERNET_FRAME_BYTES;
}
