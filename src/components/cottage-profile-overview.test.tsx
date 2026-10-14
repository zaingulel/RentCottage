import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/cottage-profile/actions", () => ({
  createCottageProfileDraftAction: vi.fn(),
}));

import type { CottageProfile } from "@/cottage-profile/cottage-profile";
import { createCottageProfileDraftAction } from "@/cottage-profile/actions";
import { formatIqd } from "@/i18n/format";
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
    expect(screen.getByText("Started in Owner Application").className).toBe(
      "status-badge",
    );
    const card = screen.getByRole("article");
    expect(card.children).toHaveLength(5);
    expect(card).toHaveClass("card");
    expect(card.children[0]).toHaveClass("cottage-profile-card-cover");
    expect(card.children[0].querySelectorAll("span.status-badge")).toHaveLength(
      2,
    );
    expect(card.children[1]).toBe(screen.getByRole("heading", { level: 2 }));
    expect(screen.getByRole("heading", { level: 2 })).toHaveClass("card-title");
    expect(card.children[2]).toHaveClass("card-detail");
    expect(card.children[3]).toHaveClass("card-small-print");
    expect(card.lastElementChild).toHaveClass("cottage-profile-card-actions");
    expect(card.lastElementChild).toContainElement(
      screen.getByRole("link", { name: "Open Cottage Profile" }),
    );
    expect(
      screen.getByRole("link", { name: "Open Cottage Profile" }),
    ).toHaveClass("action-content");
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("page-title");
    expect(screen.queryByText("01")).toBeNull();
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

  it("shows the first ready photo as the cover, with the badges ahead of it", () => {
    const photo = (id: string, state: "pending" | "ready") => ({
      id,
      originalFilename: `${id}.png`,
      mediaType: "image/png",
      sizeBytes: 1024,
      state,
      updatedAt: "2026-08-17T09:00:00.000Z",
    });
    const pendingId = "90000000-0000-4000-8000-000000000001";
    const firstReadyId = "90000000-0000-4000-8000-000000000002";
    const secondReadyId = "90000000-0000-4000-8000-000000000003";
    render(
      <CottageProfileOverview
        locale="en"
        actor="owner"
        profiles={[
          {
            ...profile,
            photos: [
              photo(pendingId, "pending"),
              photo(firstReadyId, "ready"),
              photo(secondReadyId, "ready"),
            ],
          },
        ]}
      />,
    );

    const cover = screen.getByRole("img", {
      name: "Cover photo of Application Cottage",
    });
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(decodeURIComponent(cover.getAttribute("src") ?? "")).toContain(
      `/api/cottage-profile-photos/${firstReadyId}`,
    );
    expect(screen.queryByText("No photos yet")).toBeNull();
    expect(
      screen
        .getByText("Started in Owner Application")
        .compareDocumentPosition(cover) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it.each([
    ["en", "No photos yet"],
    ["ar", "لا توجد صور بعد"],
    ["ckb", "هێشتا وێنە نییە"],
  ] as const)(
    "shows the no-photos panel and no image for a profile with no ready photo in %s",
    (locale, label) => {
      render(
        <CottageProfileOverview
          locale={locale}
          actor="owner"
          profiles={[profile]}
        />,
      );

      expect(screen.getByText(label)).toBeVisible();
      expect(screen.queryByRole("img")).toBeNull();
    },
  );

  it.each([
    ["Application Cottage", "ar", "صورة غلاف Application Cottage"],
    ["Application Cottage", "ckb", "وێنەی بەرگی Application Cottage"],
    ["Cottage $& $$", "ar", "صورة غلاف Cottage $& $$"],
    ["Cottage $& $$", "ckb", "وێنەی بەرگی Cottage $& $$"],
  ] as const)(
    "names the cottage %s in the cover photo alternative in %s",
    (name, locale, alternative) => {
      render(
        <CottageProfileOverview
          locale={locale}
          actor="owner"
          profiles={[
            {
              ...profile,
              name,
              photos: [
                {
                  id: "90000000-0000-4000-8000-000000000002",
                  originalFilename: "cover.png",
                  mediaType: "image/png",
                  sizeBytes: 1024,
                  state: "ready",
                  updatedAt: "2026-08-17T09:00:00.000Z",
                },
              ],
            },
          ]}
        />,
      );

      expect(screen.getByRole("img", { name: alternative })).toBeVisible();
    },
  );

  it.each([
    ["en", "From "],
    ["ar", "ابتداءً من "],
    ["ckb", "دەستپێک لە "],
  ] as const)(
    "shows the translated From Price formatted as IQD on a published profile in %s",
    (locale, prefix) => {
      render(
        <CottageProfileOverview
          locale={locale}
          actor="owner"
          profiles={[{ ...profile, ...published }]}
          fromPrices={{
            status: "loaded",
            fromPrices: { [profile.id]: 180000 },
          }}
        />,
      );

      expect(
        screen.getByText(`${prefix}${formatIqd(180000, locale)}`),
      ).toHaveClass("cottage-profile-card-price");
    },
  );

  it("shows no price, and no zero, where a loaded read has no price for the profile", () => {
    const { container } = render(
      <CottageProfileOverview
        locale="en"
        actor="owner"
        profiles={[{ ...profile, ...published }]}
        fromPrices={{ status: "loaded", fromPrices: {} }}
      />,
    );

    expect(container.querySelector(".cottage-profile-card-price")).toBeNull();
    expect(screen.queryByText(/IQD/)).toBeNull();
  });

  it.each([
    ["en", "Price unavailable"],
    ["ar", "السعر غير متاح"],
    ["ckb", "نرخ بەردەست نییە"],
  ] as const)(
    "says the price is unavailable on a published profile but not a draft when the read failed in %s",
    (locale, label) => {
      const publishedView = render(
        <CottageProfileOverview
          locale={locale}
          actor="owner"
          profiles={[{ ...profile, ...published }]}
          fromPrices={{ status: "unavailable" }}
        />,
      );
      expect(screen.getByText(label)).toHaveClass("cottage-profile-card-price");
      publishedView.unmount();

      const { container } = render(
        <CottageProfileOverview
          locale={locale}
          actor="owner"
          profiles={[profile]}
          fromPrices={{ status: "unavailable" }}
        />,
      );
      expect(screen.queryByText(label)).toBeNull();
      expect(container.querySelector(".cottage-profile-card-price")).toBeNull();
    },
  );

  it("shows no price element when the list carries no price read", () => {
    const { container } = render(
      <CottageProfileOverview
        locale="en"
        actor="administrator"
        profiles={[{ ...profile, ...published }]}
      />,
    );

    expect(container.querySelector(".cottage-profile-card-price")).toBeNull();
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

      const card = within(screen.getByRole("article"));
      expect(card.getByText(publishedLabel)).toBeVisible();
      expect(card.queryByText(draftLabel)).toBeNull();
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

      expect(
        within(screen.getByRole("article")).getByText(label),
      ).toBeVisible();
    },
  );

  it("states the owner's counts in a sentence and tiles that match the listed cards", () => {
    const { container } = render(
      <CottageProfileOverview
        locale="en"
        actor="owner"
        profiles={[
          { ...profile, id: "a", ...published },
          { ...profile, id: "b", ...publishedWithUnpublishedChanges },
          { ...profile, id: "c", ...neverPublishedDraft },
          { ...profile, id: "d", ...neverPublishedSubmitted },
          { ...profile, id: "e", ...abandoned },
        ]}
        waitingRequestCount={4}
      />,
    );

    expect(
      screen.getByText("You have 2 published cottages and 1 draft."),
    ).toBeVisible();
    expect(
      screen.getAllByRole("listitem").map((tile) => tile.textContent),
    ).toEqual(["2 Published", "1 Draft", "4 Requests waiting"]);
    expect(container.querySelectorAll(".status-badge-published")).toHaveLength(
      2,
    );
    expect(container.querySelectorAll(".status-badge-draft")).toHaveLength(1);
  });

  it("hides the waiting requests tile when waiting requests are switched off", () => {
    const { rerender } = render(
      <CottageProfileOverview locale="en" actor="owner" profiles={[profile]} />,
    );

    expect(
      screen.getAllByRole("listitem").map((tile) => tile.textContent),
    ).toEqual(["0 Published", "1 Draft"]);
    expect(screen.queryByText("Requests waiting")).toBeNull();

    rerender(
      <CottageProfileOverview
        locale="en"
        actor="owner"
        profiles={[profile]}
        waitingRequestCount={0}
      />,
    );

    expect(screen.getAllByRole("listitem")[2]).toHaveTextContent(
      "0 Requests waiting",
    );
  });

  it("shows an owner with no cottages an empty state and no tiles", () => {
    const { container } = render(
      <CottageProfileOverview
        locale="en"
        actor="owner"
        profiles={[]}
        canCreate
        waitingRequestCount={0}
      />,
    );

    expect(container.querySelector(".empty-state")).toHaveTextContent(
      "You have no cottages yet.",
    );
    expect(screen.queryByRole("list")).toBeNull();
    expect(container.querySelector("header p")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Create another cottage draft" }),
    ).toBeEnabled();
  });

  it("keeps the administrator list free of the owner summary", () => {
    const { container, rerender } = render(
      <CottageProfileOverview
        locale="en"
        actor="administrator"
        profiles={[profile]}
        waitingRequestCount={3}
      />,
    );

    expect(
      screen.getByText(
        "Review unpublished working copies without changing submitted owner source.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText(/You have/)).toBeNull();

    rerender(
      <CottageProfileOverview
        locale="en"
        actor="administrator"
        profiles={[]}
      />,
    );

    expect(
      screen.getByText("No Cottage Profiles are available."),
    ).toBeVisible();
    expect(container.querySelector(".empty-state")).toBeNull();
  });

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

  it.each([
    [
      "a never-published draft",
      neverPublishedDraft,
      "Private draft",
      "status-badge status-badge-draft",
    ],
    [
      "never published and submitted",
      neverPublishedSubmitted,
      "Submitted for content approval",
      "status-badge status-badge-review",
    ],
    ["abandoned", abandoned, "Abandoned", "status-badge"],
    [
      "published",
      published,
      "Published",
      "status-badge status-badge-published",
    ],
    [
      "published with unpublished changes",
      publishedWithUnpublishedChanges,
      "Published; unpublished changes",
      "status-badge status-badge-published",
    ],
    [
      "published with an update awaiting approval",
      publishedUpdateAwaitingApproval,
      "Published; update awaiting approval",
      "status-badge status-badge-published",
    ],
  ] as const)(
    "shows the dot for a Cottage Profile that is %s",
    (_state, fields, label, badgeClass) => {
      render(
        <CottageProfileOverview
          locale="en"
          actor="owner"
          profiles={[{ ...profile, ...fields }]}
        />,
      );

      expect(
        within(screen.getByRole("article")).getByText(label).className,
      ).toBe(badgeClass);
    },
  );
});
