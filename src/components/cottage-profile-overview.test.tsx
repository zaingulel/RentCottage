import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/cottage-profile/actions", () => ({
  createCottageProfileDraftAction: vi.fn(),
}));

import type { CottageProfile } from "@/cottage-profile/cottage-profile";
import { createCottageProfileDraftAction } from "@/cottage-profile/actions";
import { CottageProfileOverview } from "./cottage-profile-overview";

const profile = {
  id: "70000000-0000-4000-8000-000000000001",
  ownerUserId: "10000000-0000-4000-8000-000000000701",
  applicationId: "20000000-0000-4000-8000-000000000701",
  currentPublicationId: null,
  status: "draft",
  version: 1,
  name: "Application Cottage",
  governorate: "Erbil",
  approximateLocation: "Near Shaqlawa",
  exactAddress: "Private address",
  exactLatitude: null,
  exactLongitude: null,
  privateDirections: "",
  capacity: 8,
  bedrooms: 3,
  bathrooms: 2,
  amenities: ["garden"],
  sourceLanguage: "en",
  description: "Description",
  houseRules: "Rules",
  photos: [],
  submittedSourceRevision: null,
  hasUnpublishedContentChange: false,
  updatedAt: "2026-08-17T09:00:00.000Z",
} satisfies CottageProfile;

const publicationId = "80000000-0000-4000-8000-000000000001";

type StatusFields = Pick<
  CottageProfile,
  "status" | "currentPublicationId" | "hasUnpublishedContentChange"
>;

const neverPublishedDraft: StatusFields = {
  status: "draft",
  currentPublicationId: null,
  hasUnpublishedContentChange: false,
};
const neverPublishedSubmitted: StatusFields = {
  status: "submitted_for_content_approval",
  currentPublicationId: null,
  hasUnpublishedContentChange: false,
};
const abandoned: StatusFields = {
  status: "abandoned",
  currentPublicationId: null,
  hasUnpublishedContentChange: false,
};
const published: StatusFields = {
  status: "draft",
  currentPublicationId: publicationId,
  hasUnpublishedContentChange: false,
};
const publishedWithUnpublishedChanges: StatusFields = {
  status: "draft",
  currentPublicationId: publicationId,
  hasUnpublishedContentChange: true,
};
const publishedUpdateAwaitingApproval: StatusFields = {
  status: "submitted_for_content_approval",
  currentPublicationId: publicationId,
  hasUnpublishedContentChange: true,
};

describe("Cottage Profile overview", () => {
  it("shows the continued application profile and allows approved owners to add another draft", () => {
    render(
      <CottageProfileOverview
        locale="en"
        actor="owner"
        profiles={[profile]}
        canCreate
      />,
    );

    expect(screen.getByText("Started in Owner Application")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open Cottage Profile" }),
    ).toHaveAttribute(
      "href",
      "/en/owner/cottages/70000000-0000-4000-8000-000000000001",
    );
    expect(
      screen.getByRole("button", { name: "Create another cottage draft" }),
    ).toBeEnabled();
  });

  it("announces localized feedback when draft creation is denied", async () => {
    vi.mocked(createCottageProfileDraftAction).mockResolvedValue({
      status: "denied",
    });
    render(
      <CottageProfileOverview
        locale="ar"
        actor="owner"
        profiles={[profile]}
        canCreate
      />,
    );

    fireEvent.submit(
      screen
        .getByRole("button", { name: "إنشاء مسودة كوخ أخرى" })
        .closest("form")!,
    );

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "لا يمكن لحساب المالك هذا إنشاء مسودة كوخ أخرى.",
      ),
    );
  });

  it.each([
    [
      "capacity_limit",
      "You can have up to 20 open unpublished Cottage Profiles.",
    ],
    [
      "rate_limit",
      "You can create up to 20 additional Cottage Profiles in 24 hours.",
    ],
  ] as const)("announces the distinct %s outcome", async (status, message) => {
    vi.mocked(createCottageProfileDraftAction).mockResolvedValue({ status });
    render(
      <CottageProfileOverview
        locale="en"
        actor="owner"
        profiles={[profile]}
        canCreate
      />,
    );

    fireEvent.submit(
      screen
        .getByRole("button", { name: "Create another cottage draft" })
        .closest("form")!,
    );

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(message),
    );
  });

  it("keeps lifecycle controls out of the overview where owner eligibility is unavailable", () => {
    render(
      <CottageProfileOverview
        locale="en"
        actor="owner"
        profiles={[
          profile,
          {
            ...profile,
            id: "70000000-0000-4000-8000-000000000002",
            applicationId: null,
          },
        ]}
        canCreate
      />,
    );

    expect(screen.queryByRole("button", { name: "Abandon draft" })).toBeNull();
  });

  it("labels an abandoned administrator profile without offering an ungrounded lifecycle control", () => {
    render(
      <CottageProfileOverview
        locale="ckb"
        actor="administrator"
        profiles={[{ ...profile, applicationId: null, status: "abandoned" }]}
      />,
    );

    expect(screen.getByText("وازهێنراو")).toBeVisible();
    expect(screen.queryByLabelText("هۆکاری بەڕێوەبەر")).toBeNull();
  });

  it.each([
    ["owner", "en", "Published", "Private draft"],
    ["owner", "ar", "منشور", "مسودة خاصة"],
    ["owner", "ckb", "بڵاوکراوەتەوە", "ڕەشنووسی تایبەت"],
    ["administrator", "en", "Published", "Private draft"],
    ["administrator", "ar", "منشور", "مسودة خاصة"],
    ["administrator", "ckb", "بڵاوکراوەتەوە", "ڕەشنووسی تایبەت"],
  ] as const)(
    "never labels a published Cottage Profile as a draft in the %s list in %s",
    (actor, locale, publishedLabel, draftLabel) => {
      render(
        <CottageProfileOverview
          locale={locale}
          actor={actor}
          profiles={[{ ...profile, currentPublicationId: publicationId }]}
        />,
      );

      expect(screen.getByText(publishedLabel)).toBeVisible();
      expect(screen.queryByText(draftLabel)).toBeNull();
    },
  );

  it.each([
    ["a never-published draft", "en", neverPublishedDraft, "Private draft"],
    ["a never-published draft", "ar", neverPublishedDraft, "مسودة خاصة"],
    ["a never-published draft", "ckb", neverPublishedDraft, "ڕەشنووسی تایبەت"],
    [
      "never published and submitted",
      "en",
      neverPublishedSubmitted,
      "Submitted for content approval",
    ],
    [
      "never published and submitted",
      "ar",
      neverPublishedSubmitted,
      "مُرسل للموافقة على المحتوى",
    ],
    [
      "never published and submitted",
      "ckb",
      neverPublishedSubmitted,
      "نێردراوە بۆ پەسەندکردنی ناوەڕۆک",
    ],
    ["abandoned", "en", abandoned, "Abandoned"],
    ["abandoned", "ar", abandoned, "متروك"],
    ["abandoned", "ckb", abandoned, "وازهێنراو"],
    ["published", "en", published, "Published"],
    ["published", "ar", published, "منشور"],
    ["published", "ckb", published, "بڵاوکراوەتەوە"],
    [
      "published with unpublished changes",
      "en",
      publishedWithUnpublishedChanges,
      "Published; unpublished changes",
    ],
    [
      "published with unpublished changes",
      "ar",
      publishedWithUnpublishedChanges,
      "منشور؛ تعديلات غير منشورة",
    ],
    [
      "published with unpublished changes",
      "ckb",
      publishedWithUnpublishedChanges,
      "بڵاوکراوەتەوە؛ گۆڕانکاریی بڵاونەکراوە هەیە",
    ],
    [
      "published with an update awaiting approval",
      "en",
      publishedUpdateAwaitingApproval,
      "Published; update awaiting approval",
    ],
    [
      "published with an update awaiting approval",
      "ar",
      publishedUpdateAwaitingApproval,
      "منشور؛ التحديث بانتظار الموافقة",
    ],
    [
      "published with an update awaiting approval",
      "ckb",
      publishedUpdateAwaitingApproval,
      "بڵاوکراوەتەوە؛ نوێکردنەوەکە چاوەڕێی پەسەندکردنە",
    ],
  ] as const)(
    "labels a Cottage Profile that is %s in %s",
    (_state, locale, fields, label) => {
      render(
        <CottageProfileOverview
          locale={locale}
          actor="owner"
          profiles={[{ ...profile, ...fields }]}
        />,
      );

      expect(screen.getByText(label)).toBeVisible();
    },
  );

  it("shows a localized administrator continuation link", () => {
    render(
      <CottageProfileOverview
        locale="ar"
        actor="administrator"
        profiles={[profile]}
        continuationHref="/ar/administrator/cottages?afterProfileId=next"
      />,
    );

    expect(
      screen.getByRole("link", { name: "ملفات الأكواخ التالية" }),
    ).toHaveAttribute("href", "/ar/administrator/cottages?afterProfileId=next");
  });
});
