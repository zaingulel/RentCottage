import { afterEach, expect, it, vi } from "vitest";

const { requestClient, createClient, getUser, rpc, revalidatePath } =
  vi.hoisted(() => ({
    requestClient: vi.fn(),
    createClient: vi.fn(),
    getUser: vi.fn(),
    rpc: vi.fn(),
    revalidatePath: vi.fn(),
  }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/access/supabase-server", () => ({
  createRequestSupabaseClient: requestClient,
}));
vi.mock("@supabase/supabase-js", () => ({ createClient }));
vi.mock("@/config/server-runtime", () => ({
  getServerEnvironment: () => ({
    name: "test",
    supabase: {
      projectRef: "local-test",
      url: "http://127.0.0.1:54331",
      secretKey: "fictional-test-secret",
    },
  }),
}));

afterEach(() => vi.unstubAllEnvs());

it("keeps messaging effects unavailable outside the exact local test runtime", async () => {
  const localEnvironment = {
    APP_ENVIRONMENT: "test",
    SUPABASE_PROJECT_REF: "local-test",
    SUPABASE_URL: "http://127.0.0.1:54331",
  };
  const forbiddenEnvironments = [
    { APP_ENVIRONMENT: "production" },
    { APP_ENVIRONMENT: "preview" },
    { SUPABASE_PROJECT_REF: "another-project" },
    { SUPABASE_URL: "https://fictional-project.supabase.co" },
    { SUPABASE_URL: "http://fictional-project.example:54331" },
    { SUPABASE_URL: "not-a-url" },
    { APP_ENVIRONMENT: undefined },
  ];
  const commandId = "11111111-1111-4111-8111-111111111111";
  const conversationId = "22222222-2222-4222-8222-222222222222";
  const messageId = "33333333-3333-4333-8333-333333333333";
  const translationId = "44444444-4444-4444-8444-444444444444";

  for (const environment of [{}, ...forbiddenEnvironments]) {
    vi.resetModules();
    vi.clearAllMocks();
    for (const [key, value] of Object.entries({
      ...localEnvironment,
      ...environment,
    })) {
      vi.stubEnv(key, value);
    }
    const client = { auth: { getUser }, rpc };
    requestClient.mockResolvedValue(client);
    createClient.mockReturnValue(client);
    const { createRequestMessagingRuntime } = await import(
      "./request-messaging-runtime"
    );
    const runtime = await createRequestMessagingRuntime();

    if (Object.keys(environment).length === 0) {
      expect(runtime.enabled).toBe(true);
    } else {
      expect(runtime.enabled, JSON.stringify(environment)).toBe(false);
      const actions = await import("./actions");
      await expect(
        actions.startMessagingConversation({
          publicSlug: "cottage-0123456789abcdef0123456789abcdef",
          commandId,
        }),
      ).resolves.toEqual({ status: "unavailable" });
      await expect(
        actions.openBookingMessagingConversation({
          bookingRequestReference: "RC-REQ-0123456789ABCDEF",
          commandId,
        }),
      ).resolves.toEqual({ status: "unavailable" });
      await expect(
        actions.sendMessagingMessage({
          locale: "en",
          conversationId,
          commandId,
          originalLanguage: "ar",
          originalBody: "رسالة اختبارية",
        }),
      ).resolves.toEqual({ status: "unavailable" });
      await expect(
        actions.translateMessagingMessage({
          locale: "en",
          messageId,
          targetLanguage: "en",
        }),
      ).resolves.toEqual({ status: "unavailable" });
      await expect(
        actions.reportMessagingTranslation({
          translationId,
          commandId,
          category: "incorrect",
        }),
      ).resolves.toEqual({ status: "unavailable" });
    }

    expect(getUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  }
});
