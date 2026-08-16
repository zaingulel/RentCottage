import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("hosted health route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses the server-only Supabase key only as the REST API key", async () => {
    vi.stubEnv("APP_ENVIRONMENT", "preview");
    vi.stubEnv("SUPABASE_PROJECT_REF", "preview-project");
    vi.stubEnv("SUPABASE_URL", "https://preview-project.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "publishable-browser-key");
    vi.stubEnv("SUPABASE_SECRET_KEY", "secret-server-key");
    vi.stubEnv("PRIVILEGED_AUDIT_HMAC_KEY", "a".repeat(32));

    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("https://preview.example.com/api/health?check=supabase"),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://preview-project.supabase.co/rest/v1/",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
      apikey: "secret-server-key",
    });
    await expect(response.json()).resolves.toEqual({
      ok: true,
      environment: "preview",
      supabase: {
        configured: true,
        connected: true,
        projectRef: "preview-project",
      },
    });
  });
});
