export type ResponsesFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export class ResponsesTransportError extends Error {
  readonly kind: "connection" | "timeout" | "invalid_response";

  constructor(kind: "connection" | "timeout" | "invalid_response") {
    super(`Responses transport ${kind}`);
    this.kind = kind;
  }
}

function invalid(): never {
  throw new ResponsesTransportError("invalid_response");
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function number(value: unknown): number {
  if (typeof value !== "number") invalid();
  return value;
}

function cancelWithoutWaiting(
  target: { cancel(reason?: unknown): Promise<void> } | undefined,
): void {
  if (!target) return;
  try {
    void target.cancel().catch(() => undefined);
  } catch {
    // Cancellation is best-effort; the bounded caller must still terminate.
  }
}

async function readBoundedBody(
  response: Response,
  signal: AbortSignal,
  maximumBytes: number,
): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^[0-9]+$/.test(declaredLength)) invalid();
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length > maximumBytes) {
      cancelWithoutWaiting(response.body ?? undefined);
      invalid();
    }
  }
  if (!response.body) invalid();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let abortHandler: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    abortHandler = () => reject(new ResponsesTransportError("timeout"));
    signal.addEventListener("abort", abortHandler, { once: true });
  });
  try {
    while (true) {
      const part = await Promise.race([reader.read(), aborted]);
      if (part.done) break;
      received += part.value.byteLength;
      if (received > maximumBytes) {
        cancelWithoutWaiting(reader);
        invalid();
      }
      chunks.push(part.value);
    }
  } catch (error) {
    cancelWithoutWaiting(reader);
    throw error;
  } finally {
    if (abortHandler) signal.removeEventListener("abort", abortHandler);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    invalid();
  }
}

export async function fetchBoundedJson({
  fetch,
  url,
  init,
  timeoutMilliseconds,
  maximumResponseBytes,
}: {
  fetch: ResponsesFetch;
  url: string;
  init: Omit<RequestInit, "signal">;
  timeoutMilliseconds: number;
  maximumResponseBytes: number;
}): Promise<{ ok: true; value: unknown } | { ok: false; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMilliseconds);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      cancelWithoutWaiting(response.body ?? undefined);
      return { ok: false, status: response.status };
    }
    const text = await readBoundedBody(
      response,
      controller.signal,
      maximumResponseBytes,
    );
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch {
      invalid();
    }
  } catch (error) {
    if (error instanceof ResponsesTransportError) throw error;
    if (
      controller.signal.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      throw new ResponsesTransportError("timeout");
    }
    throw new ResponsesTransportError("connection");
  } finally {
    clearTimeout(timer);
  }
}

export function parseResponsesEnvelope(value: unknown, expectedModel: string) {
  const response = record(value);
  if (
    response.status !== "completed" ||
    response.model !== expectedModel ||
    !Array.isArray(response.output)
  ) {
    invalid();
  }
  let message: Record<string, unknown> | undefined;
  for (const itemValue of response.output) {
    const item = record(itemValue);
    if (item.type === "reasoning") {
      if (
        typeof item.id !== "string" ||
        item.id.length === 0 ||
        !Array.isArray(item.summary) ||
        !item.summary.every((part) => {
          const summary = record(part);
          return (
            summary.type === "summary_text" && typeof summary.text === "string"
          );
        })
      ) {
        invalid();
      }
      continue;
    }
    if (item.type !== "message" || message) invalid();
    message = item;
  }
  if (
    !message ||
    message.type !== "message" ||
    message.role !== "assistant" ||
    message.status !== "completed" ||
    !Array.isArray(message.content) ||
    message.content.length !== 1
  ) {
    invalid();
  }
  const content = record(message.content[0]);
  if (content.type !== "output_text" || typeof content.text !== "string")
    invalid();
  const usage = record(response.usage);
  const inputTokens = number(usage.input_tokens);
  const outputTokens = number(usage.output_tokens);
  const totalTokens = number(usage.total_tokens);
  let output: unknown;
  try {
    output = JSON.parse(content.text);
  } catch {
    invalid();
  }
  return {
    output: record(output),
    usage: { inputTokens, outputTokens, totalTokens },
  };
}
