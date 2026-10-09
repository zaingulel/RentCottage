import { afterEach, describe, expect, it, vi } from "vitest";

const originalWorkerServer = process.env.PLAYWRIGHT_SERVER;
const originalWorkerPort = process.env.PLAYWRIGHT_WORKER_PORT;
const originalNextPort = process.env.PLAYWRIGHT_NEXT_PORT;

async function loadConfig(port) {
  vi.resetModules();
  process.env.PLAYWRIGHT_SERVER = "worker";
  if (port === undefined) delete process.env.PLAYWRIGHT_WORKER_PORT;
  else process.env.PLAYWRIGHT_WORKER_PORT = port;
  return (await import("../playwright.config.ts")).default;
}

async function loadNextConfig(port) {
  vi.resetModules();
  process.env.PLAYWRIGHT_SERVER = "next";
  process.env.PLAYWRIGHT_NEXT_PORT = port;
  return (await import("../playwright.config.ts")).default;
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  if (originalWorkerServer === undefined) delete process.env.PLAYWRIGHT_SERVER;
  else process.env.PLAYWRIGHT_SERVER = originalWorkerServer;
  if (originalWorkerPort === undefined)
    delete process.env.PLAYWRIGHT_WORKER_PORT;
  else process.env.PLAYWRIGHT_WORKER_PORT = originalWorkerPort;
  if (originalNextPort === undefined) delete process.env.PLAYWRIGHT_NEXT_PORT;
  else process.env.PLAYWRIGHT_NEXT_PORT = originalNextPort;
});

describe("Playwright Worker port isolation", () => {
  it("uses one validated override for the browser and preview server", async () => {
    const config = await loadConfig("8798");

    expect(config.use.baseURL).toBe("http://127.0.0.1:8798");
    expect(config.webServer.url).toBe("http://127.0.0.1:8798/api/health");
    expect(config.webServer.command).toContain("--port 8798");
  });

  it.each(["0", "1024", "65536", "not-a-port", "8798 --help"])(
    "rejects an unsafe Worker port: %s",
    async (port) => {
      await expect(loadConfig(port)).rejects.toThrow(
        "PLAYWRIGHT_WORKER_PORT must be an integer from 1025 to 65535",
      );
    },
  );

  it("defaults to the established Worker port", async () => {
    const config = await loadConfig(undefined);

    expect(config.use.baseURL).toBe("http://127.0.0.1:8788");
    expect(config.webServer.url).toBe("http://127.0.0.1:8788/api/health");
    expect(config.webServer.command).toContain("--port 8788");
  });
});

describe("Playwright Next port isolation", () => {
  it("uses one validated override for the browser and the Next server", async () => {
    const config = await loadNextConfig("3107");

    expect(config.use.baseURL).toBe("http://127.0.0.1:3107");
    expect(config.webServer.url).toBe("http://127.0.0.1:3107/ar");
    expect(config.webServer.command).toBe(
      "npm run build && npm run start -- -p 3107",
    );
  });

  it.each(["0", "1024", "65536", "not-a-port", "3107 --help"])(
    "rejects an unsafe Next port: %s",
    async (port) => {
      await expect(loadNextConfig(port)).rejects.toThrow(
        "PLAYWRIGHT_NEXT_PORT must be an integer from 1025 to 65535",
      );
    },
  );
});

describe("Playwright build freshness", () => {
  it("rebuilds by default and never accepts an existing Next or Worker server", async () => {
    delete process.env.PLAYWRIGHT_NEXT_PORT;
    const worker = await loadConfig();
    expect(worker.webServer.command).toMatch(/^npm run build:worker && /);
    expect(worker.webServer.reuseExistingServer).toBe(false);
    vi.resetModules();
    process.env.PLAYWRIGHT_SERVER = "next";
    const next = (await import("../playwright.config.ts")).default;
    expect(next.webServer.command).toBe(
      "npm run build && npm run start -- -p 3000",
    );
    expect(next.webServer.reuseExistingServer).toBe(false);
  });

  it("reuses only Worker compilation while preserving preview bindings and settings", async () => {
    const standard = await loadConfig("8798");
    const prebuilt = (await import("../playwright.worker-prebuilt.config.ts"))
      .default;
    expect(prebuilt).toMatchObject({
      ...standard,
      webServer: {
        ...standard.webServer,
        command: standard.webServer.command.replace(
          /^npm run build:worker && /,
          "",
        ),
        reuseExistingServer: false,
      },
    });
    expect(prebuilt.webServer.command).toMatch(/^WRANGLER_LOG_PATH=/);
    expect(prebuilt.webServer.command).not.toContain("build");
  });

  it.each([undefined, "next", "invalid"])(
    "rejects prebuilt startup outside Worker mode: %s",
    async (server) => {
      if (server === undefined) delete process.env.PLAYWRIGHT_SERVER;
      else process.env.PLAYWRIGHT_SERVER = server;
      await expect(
        import("../playwright.worker-prebuilt.config.ts"),
      ).rejects.toThrow("Prebuilt preview requires PLAYWRIGHT_SERVER=worker");
    },
  );

  it("reuses only Next.js compilation while keeping the server settings", async () => {
    const standard = await loadNextConfig("3107");
    const prebuilt = (await import("../playwright.next-prebuilt.config.ts"))
      .default;
    expect(prebuilt).toEqual({
      ...standard,
      webServer: {
        ...standard.webServer,
        command: "npm run start -- -p 3107",
      },
    });
    expect(prebuilt.webServer.command).not.toContain("build");
  });

  it.each([undefined, "worker", "invalid"])(
    "rejects prebuilt Next.js startup outside Next mode: %s",
    async (server) => {
      if (server === undefined) delete process.env.PLAYWRIGHT_SERVER;
      else process.env.PLAYWRIGHT_SERVER = server;
      await expect(
        import("../playwright.next-prebuilt.config.ts"),
      ).rejects.toThrow(
        "Prebuilt Next.js start requires PLAYWRIGHT_SERVER=next",
      );
    },
  );
});

describe("Playwright reporters", () => {
  it("prints per-test durations beside GitHub annotations in CI and keeps local list output", async () => {
    vi.stubEnv("CI", "true");
    const ci = await loadConfig();
    expect(ci.reporter).toEqual([["github"], ["list"]]);

    vi.stubEnv("CI", undefined);
    const local = await loadConfig();
    expect(local.reporter).toBe("list");
  });
});

describe("Playwright test time limit", () => {
  it("gives local browser tests 90 seconds and keeps the hosted limit at 30 seconds", async () => {
    vi.stubEnv("CI", "true");
    const ci = await loadConfig();
    expect(ci.timeout).toBe(30_000);

    vi.stubEnv("CI", undefined);
    const local = await loadConfig();
    expect(local.timeout).toBe(90_000);
  });
});
