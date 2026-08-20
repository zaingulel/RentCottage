import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createRequestCottagePublication,
  createRequestCottageTranslation,
  revalidatePath,
} = vi.hoisted(() => ({
  createRequestCottagePublication: vi.fn(),
  createRequestCottageTranslation: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("./request-cottage-publication", () => ({
  createRequestCottagePublication,
  createRequestCottageTranslation,
}));

import {
  correctCottageLocalizationAction,
  decideCottageLocalizationAction,
  decideCottagePublicationAction,
  generateCottageTranslationAction,
  reportCottageTranslationAction,
  routeCottageTranslationToHumanReviewAction,
} from "./actions";

const cycleId = "20000000-0000-4000-8000-000000000024";

function baseForm() {
  const form = new FormData();
  form.set("locale", "en");
  form.set("targetLocale", "ar");
  form.set("reviewCycleId", cycleId);
  form.set("reason", "Reviewed carefully");
  return form;
}

describe("Cottage publication actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["approved", "yes"],
    ["approved", ""],
    ["reviewCycleId", "not-a-uuid"],
    ["targetLocale", "fr"],
    ["reason", "   "],
  ])(
    "rejects malformed locale decisions without mutation (%s)",
    async (key, value) => {
      const form = baseForm();
      form.set("approved", "true");
      form.set(key, value);

      await expect(decideCottageLocalizationAction(form)).rejects.toThrow(
        "Cottage publication action input is invalid",
      );
      expect(createRequestCottagePublication).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("surfaces a missing generated target without refreshing review state", async () => {
    const correct = vi
      .fn()
      .mockRejectedValue(
        new Error("A generated localized revision is required"),
      );
    createRequestCottagePublication.mockResolvedValue({ correct });
    const form = baseForm();
    form.set("description", "Human-authored Arabic");
    form.set("houseRules", "Human-authored rules");

    await expect(correctCottageLocalizationAction(form)).rejects.toThrow(
      "A generated localized revision is required",
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("preserves a literal false decision at the application boundary", async () => {
    const decideLocale = vi.fn().mockResolvedValue(undefined);
    createRequestCottagePublication.mockResolvedValue({ decideLocale });
    const form = baseForm();
    form.set("approved", "false");

    await expect(
      decideCottageLocalizationAction(form),
    ).resolves.toBeUndefined();
    expect(decideLocale).toHaveBeenCalledWith(
      cycleId,
      "ar",
      false,
      "Reviewed carefully",
    );
  });

  it.each([
    ["description", ""],
    ["houseRules", ""],
    ["reason", ""],
  ])(
    "rejects incomplete corrections without mutation (%s)",
    async (key, value) => {
      const form = baseForm();
      form.set("description", "Corrected description");
      form.set("houseRules", "Corrected rules");
      form.set(key, value);

      await expect(correctCottageLocalizationAction(form)).rejects.toThrow(
        "Cottage publication action input is invalid",
      );
      expect(createRequestCottagePublication).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed publication decisions without mutation", async () => {
    const form = baseForm();
    form.set("approved", "1");

    await expect(decideCottagePublicationAction(form)).rejects.toThrow(
      "Cottage publication action input is invalid",
    );
    expect(createRequestCottagePublication).not.toHaveBeenCalled();
  });

  it("routes the selected current localization to human review", async () => {
    const routeHumanReview = vi.fn().mockResolvedValue(undefined);
    createRequestCottagePublication.mockResolvedValue({ routeHumanReview });
    const form = baseForm();

    await routeCottageTranslationToHumanReviewAction(form);

    expect(routeHumanReview).toHaveBeenCalledWith(
      cycleId,
      "ar",
      "Reviewed carefully",
    );
    expect(revalidatePath).toHaveBeenCalled();
  });

  it.each([
    ["ordinary", "ordinary"],
    ["stronger_model", "stronger_model"],
  ] as const)(
    "re-resolves administrator authority before %s translation",
    async (route, expectedRoute) => {
      const assertTranslationAdministrator = vi
        .fn()
        .mockResolvedValue(undefined);
      const generateTranslation = vi
        .fn()
        .mockResolvedValue({ status: "completed" });
      createRequestCottageTranslation.mockResolvedValue({
        assertTranslationAdministrator,
        generateTranslation,
      });
      const form = baseForm();
      form.set("route", route);

      await generateCottageTranslationAction(form);

      expect(assertTranslationAdministrator).toHaveBeenCalledOnce();
      expect(generateTranslation).toHaveBeenCalledWith(
        cycleId,
        "ar",
        expectedRoute,
      );
      expect(revalidatePath).toHaveBeenCalled();
    },
  );

  it("rejects an unapproved translation route before runtime composition", async () => {
    const form = baseForm();
    form.set("route", "free-form-model");

    await expect(generateCottageTranslationAction(form)).rejects.toThrow(
      "Cottage publication action input is invalid",
    );
    expect(createRequestCottageTranslation).not.toHaveBeenCalled();
  });

  it("lets the owner report only a concrete immutable localized revision", async () => {
    const reportTranslation = vi.fn().mockResolvedValue(undefined);
    createRequestCottagePublication.mockResolvedValue({ reportTranslation });
    const form = baseForm();
    form.set("localizedRevisionId", "30000000-0000-4000-8000-000000000024");

    await reportCottageTranslationAction(form);

    expect(reportTranslation).toHaveBeenCalledWith(
      cycleId,
      "30000000-0000-4000-8000-000000000024",
      "Reviewed carefully",
    );
  });

  it.each([
    ["targetLocale", "fr"],
    ["localizedRevisionId", "stale"],
    ["reason", ""],
  ])("rejects malformed translation control input (%s)", async (key, value) => {
    const form = baseForm();
    form.set("localizedRevisionId", "30000000-0000-4000-8000-000000000024");
    form.set(key, value);

    await expect(reportCottageTranslationAction(form)).rejects.toThrow(
      "Cottage publication action input is invalid",
    );
    expect(createRequestCottagePublication).not.toHaveBeenCalled();
  });
});
