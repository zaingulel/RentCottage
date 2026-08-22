import { afterEach, describe, expect, it, vi } from "vitest";

const originalWorkerServer = process.env.PLAYWRIGHT_SERVER;
const originalWorkerPort = process.env.PLAYWRIGHT_WORKER_PORT;

async function loadConfig(port) {
  vi.resetModules();
  process.env.PLAYWRIGHT_SERVER = "worker";
  if (port === undefined) delete process.env.PLAYWRIGHT_WORKER_PORT;
  else process.env.PLAYWRIGHT_WORKER_PORT = port;
  return (await import("../playwright.config.ts")).default;
}

afterEach(() => {
  vi.resetModules();
  if (originalWorkerServer === undefined) delete process.env.PLAYWRIGHT_SERVER;
  else process.env.PLAYWRIGHT_SERVER = originalWorkerServer;
  if (originalWorkerPort === undefined)
    delete process.env.PLAYWRIGHT_WORKER_PORT;
  else process.env.PLAYWRIGHT_WORKER_PORT = originalWorkerPort;
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
