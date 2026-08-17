import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("hosted health route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("probes Supabase health without using the server-only key", async () => {
    const deploymentCommit = "a".repeat(40);
    vi.stubEnv("APP_ENVIRONMENT", "preview");
    vi.stubEnv("SUPABASE_PROJECT_REF", "preview-project");
    vi.stubEnv("SUPABASE_URL", "https://preview-project.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "publishable-browser-key");
    vi.stubEnv("SUPABASE_SECRET_KEY", "secret-server-key");
    vi.stubEnv("PRIVILEGED_AUDIT_HMAC_KEY", "a".repeat(32));
    vi.stubEnv("DEPLOYMENT_COMMIT", deploymentCommit);

    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("https://preview.example.com/api/health?check=supabase"),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://preview-project.supabase.co/auth/v1/health",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
      apikey: "publishable-browser-key",
    });
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(
      "secret-server-key",
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      environment: "preview",
      deployment: { commit: deploymentCommit },
      supabase: {
        configured: true,
        connected: true,
        projectRef: "preview-project",
      },
    });
  });
});
