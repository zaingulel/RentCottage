// @vitest-environment node
import { fork } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let directory;
beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "rentcottage-capture-boundary-"));
  await build({
    entryPoints: ["scripts/booking-request-capture-recovery-worker.ts"],
    outfile: join(directory, "worker.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
  });
  writeFileSync(
    join(directory, "npx"),
    `#!/usr/bin/env node
import('node:fs').then(({writeFileSync}) => {
  writeFileSync(process.env.CAPTURE_STATUS_ARGS, JSON.stringify(process.argv.slice(2)));
  process.stdout.write(JSON.stringify({API_URL: process.env.CAPTURE_STATUS_URL}));
  process.exitCode = Number(process.env.CAPTURE_STATUS_EXIT);
});
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(directory, "observe.mjs"),
    `
globalThis.fetch = async (url, options) => {
  process.send({stage: "http", url: String(url), apikey: new Headers(options.headers).get("apikey")});
  return new Response("[]", {status: 200, headers: {"content-type": "application/json"}});
};
await import("./worker.mjs");
`,
  );
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

async function invoke(
  url,
  statusUrl = "http://127.0.0.1:55331",
  statusExit = 0,
) {
  const child = fork(join(directory, "observe.mjs"), [], {
    execArgv: [],
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      CAPTURE_WORKER_MODE: "recover",
      SUPABASE_URL: url,
      SUPABASE_SECRET_KEY: "fixture-service-key",
      SUPABASE_LOCAL_WORKDIR: directory,
      CAPTURE_STATUS_URL: statusUrl,
      CAPTURE_STATUS_EXIT: String(statusExit),
      CAPTURE_STATUS_ARGS: join(directory, "status-args.json"),
    },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    timeout: 10_000,
  });
  const messages = [];
  child.on("message", (message) => messages.push(message));
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  return { code, messages, stderr };
}

describe("Capture recovery worker environment boundary", () => {
  it("rejects an inherited remote API before transmitting the service key", async () => {
    const result = await invoke("https://untrusted.example");
    expect(
      result.messages.filter((message) => message.stage === "http"),
    ).toEqual([]);
    expect(result.code).toBe(1);
    expect(result.messages).toEqual([
      {
        stage: "error",
        message:
          "Capture worker API must match the disposable local Supabase origin",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("fixture-service-key");
  });
  it("uses the exact origin reported by the guarded project without changing local recovery", async () => {
    const result = await invoke("http://127.0.0.1:55331");
    expect(result.code).toBe(0);
    expect(result.messages).toEqual([
      {
        stage: "http",
        url: "http://127.0.0.1:55331/rest/v1/rpc/claim_due_booking_request_captures",
        apikey: "fixture-service-key",
      },
      { stage: "complete", result: [] },
    ]);
    expect(
      JSON.parse(readFileSync(join(directory, "status-args.json"), "utf8")),
    ).toEqual([
      "supabase",
      "status",
      "--output",
      "json",
      "--workdir",
      directory,
    ]);
  });
  it.each([
    ["http://127.0.0.1:59999", "http://127.0.0.1:55331"],
    ["http://127.0.0.1:55331/path", "http://127.0.0.1:55331"],
    ["http://user:password@127.0.0.1:55331", "http://127.0.0.1:55331"],
    ["http://127.0.0.1:55331?redirect=remote", "http://127.0.0.1:55331"],
    ["https://untrusted.example", "https://untrusted.example"],
    ["http://127.0.0.1:55331", "not-a-url"],
  ])(
    "rejects mismatched or nonlocal origin %s / %s before HTTP",
    async (url, statusUrl) => {
      const result = await invoke(url, statusUrl);
      expect(result.code).toBe(1);
      expect(result.messages).toEqual([
        {
          stage: "error",
          message:
            "Capture worker API must match the disposable local Supabase origin",
        },
      ]);
      expect(JSON.stringify(result)).not.toContain("fixture-service-key");
    },
  );
  it("rejects unavailable local status even if output contains a plausible API origin", async () => {
    const result = await invoke(
      "http://127.0.0.1:55331",
      "http://127.0.0.1:55331",
      1,
    );
    expect(result.code).toBe(1);
    expect(
      result.messages.filter((message) => message.stage === "http"),
    ).toEqual([]);
  });
});
