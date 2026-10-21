import { afterEach, expect, it, vi } from "vitest";

const { requestClient, createClient, getUser, rpc, resolveRequestAccount } =
  vi.hoisted(() => ({
    requestClient: vi.fn(),
    createClient: vi.fn(),
    getUser: vi.fn(),
    rpc: vi.fn(),
    resolveRequestAccount: vi.fn(),
  }));

vi.mock("server-only", () => ({}));
vi.mock("@/access/supabase-server", () => ({
  createRequestSupabaseClient: requestClient,
}));
vi.mock("@supabase/supabase-js", () => ({ createClient }));
vi.mock("@/access/request-account-context", () => ({
  resolveRequestAccount,
}));
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

it("admits review services only in the exact local test runtime", async () => {
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
    const { createRequestCustomerReview } = await import(
      "./request-customer-review"
    );
    const { createRequestReviewTranslation } = await import(
      "./request-review-translation"
    );
    const review = await createRequestCustomerReview();
    const translation = createRequestReviewTranslation();

    if (Object.keys(environment).length === 0) {
      expect(review?.submit).toBeTypeOf("function");
      expect(translation?.translate).toBeTypeOf("function");
      expect(requestClient).toHaveBeenCalledOnce();
      expect(createClient).toHaveBeenCalledOnce();
    } else {
      expect(review, JSON.stringify(environment)).toBeUndefined();
      expect(translation, JSON.stringify(environment)).toBeUndefined();
      expect(requestClient).not.toHaveBeenCalled();
      expect(createClient).not.toHaveBeenCalled();
    }

    expect(getUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(resolveRequestAccount).not.toHaveBeenCalled();
  }
});
