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

import type {
  CottageProfile,
  CottageProfileDraftRequirement,
} from "@/cottage-profile/cottage-profile";
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
  it.each(["en", "ar", "ckb"] as const)(
    "renders the approved cottage list presentation in %s",
    (locale) => {
      const expectations = {
        en: {
          guests: ["1 guest", "2 guests", "3 guests", "11 guests"],
          bedrooms: ["1 bedroom", "2 bedrooms", "3 bedrooms", "11 bedrooms"],
          maximumGuests: "100 guests",
          edit: "Edit cottage",
          open: "Open Cottage Profile",
        },
        ar: {
          guests: ["1 ضيف", "2 ضيفان", "3 ضيوف", "11 ضيفًا"],
          bedrooms: ["1 غرفة نوم", "2 غرفتا نوم", "3 غرف نوم", "11 غرفة نوم"],
          maximumGuests: "100 ضيف",
          edit: "تعديل الكوخ",
          open: "فتح ملف الكوخ",
        },
        ckb: {
          guests: ["١ میوان", "٢ میوان", "٣ میوان", "١١ میوان"],
          bedrooms: [
            "١ ژووری نوستن",
            "٢ ژووری نوستن",
            "٣ ژووری نوستن",
            "١١ ژووری نوستن",
          ],
          maximumGuests: "١٠٠ میوان",
          edit: "دەستکاریکردنی کۆتێج",
          open: "کردنەوەی پرۆفایلی کۆتێج",
        },
      };
      const copy = expectations[locale];
      for (const actor of ["owner", "administrator"] as const) {
        const maximumCapacity = render(
          <CottageProfileOverview
            locale={locale}
            actor={actor}
            canCreate
            profiles={[
              { ...profile, ...published, capacity: 100, bedrooms: null },
            ]}
          />,
        );
        expect(
          screen.getByText(copy.maximumGuests, { exact: true }),
        ).toBeVisible();
        maximumCapacity.unmount();
        for (const [capacity, bedrooms, index] of [
          [1, 1, 0],
          [2, 2, 1],
          [3, 3, 2],
          [11, 11, 3],
          [1, null, 0],
          [null, 1, 0],
          [null, null, 0],
        ] as const) {
          const { container, unmount } = render(
            <CottageProfileOverview
              locale={locale}
              actor={actor}
              canCreate
              profiles={[{ ...profile, ...published, capacity, bedrooms }]}
            />,
          );
          const card = screen.getByRole("article");
          const facts = card.querySelector(".cottage-profile-card-facts")!;
          expect(
            within(facts as HTMLElement).queryByText(copy.guests[index], {
              exact: true,
            }) !== null,
          ).toBe(capacity !== null);
          expect(
            within(facts as HTMLElement).queryByText(copy.bedrooms[index], {
              exact: true,
            }) !== null,
          ).toBe(bedrooms !== null);
          expect(facts.children).toHaveLength(
            1 + Number(capacity !== null) + Number(bedrooms !== null),
          );
          const action = within(card).getByRole("link", {
            name: actor === "owner" ? copy.edit : copy.open,
          });
          expect(action).toHaveClass("action-text");
          expect(action).not.toHaveClass("action-primary");
          expect(action).toHaveAttribute(
            "href",
            `/${locale}/${actor}/cottages/${profile.id}`,
          );
          expect(
            action.querySelector('[aria-hidden="true"]'),
          ).toHaveTextContent("→");
          if (actor === "administrator")
            expect(container.querySelector("header form")).toBeNull();
          unmount();
        }
      }
      const cases = [
        { ...neverPublishedDraft, canCreate: true, expected: copy.open },
        { ...neverPublishedSubmitted, canCreate: true, expected: copy.open },
        { ...abandoned, canCreate: true, expected: copy.open },
        {
          ...publishedUpdateAwaitingApproval,
          canCreate: true,
          expected: copy.open,
        },
        { ...published, canCreate: false, expected: copy.open },
        {
          ...publishedWithUnpublishedChanges,
          canCreate: true,
          expected: copy.edit,
        },
      ];
      for (const state of cases) {
        const { unmount } = render(
          <CottageProfileOverview
            locale={locale}
            actor="owner"
            canCreate={state.canCreate}
            profiles={[{ ...profile, ...state }]}
          />,
        );
        expect(
          screen.getByRole("link", { name: state.expected }),
        ).toHaveAttribute("href", `/${locale}/owner/cottages/${profile.id}`);
        unmount();
      }
    },
  );

  it("keeps draft creation in the heading for eligible owners", async () => {
    const expectations = {
      en: {
        add: "Add a cottage",
        denied: "This owner account cannot create another cottage draft.",
      },
      ar: {
        add: "إضافة كوخ",
        denied: "لا يمكن لحساب المالك هذا إنشاء مسودة كوخ أخرى.",
      },
      ckb: {
        add: "زیادکردنی کۆتێج",
        denied: "ئەم هەژماری خاوەنە ناتوانێت ڕەشنووسێکی کۆتێجی تر دروست بکات.",
      },
    };
    for (const locale of ["en", "ar", "ckb"] as const) {
      for (const profiles of [[], [profile]]) {
        vi.mocked(createCottageProfileDraftAction)
          .mockClear()
          .mockResolvedValue({ status: "denied" });
        const { container, unmount } = render(
          <CottageProfileOverview
            locale={locale}
            actor="owner"
            canCreate
            profiles={profiles}
          />,
        );
        const button = screen.getByRole("button", {
          name: expectations[locale].add,
        });
        expect(container.querySelector("header")).toContainElement(button);
        const form = button.closest("form")!;
        expect(new FormData(form).get("locale")).toBe(locale);
        fireEvent.submit(form);
        await waitFor(() =>
          expect(screen.getByRole("alert")).toHaveTextContent(
            expectations[locale].denied,
          ),
        );
        expect(form).toContainElement(screen.getByRole("alert"));
        expect(
          vi.mocked(createCottageProfileDraftAction).mock.calls[0][0],
        ).toEqual({ status: "idle" });
        expect(
          vi
            .mocked(createCottageProfileDraftAction)
            .mock.calls[0][1].get("locale"),
        ).toBe(locale);
        unmount();
      }
      for (const actor of ["owner", "administrator"] as const) {
        const { unmount } = render(
          <CottageProfileOverview
            locale={locale}
            actor={actor}
            canCreate={actor === "administrator"}
            profiles={[profile]}
          />,
        );
        expect(
          screen.queryByRole("button", { name: expectations[locale].add }),
        ).toBeNull();
        unmount();
      }
    }
  });

  it("renders authoritative draft progress and one next step in every launch language", () => {
    const requirements = [
      "name",
      "governorate",
      "approximateLocation",
      "capacity",
      "bedrooms",
      "bathrooms",
      "amenities",
      "exactPoint",
      "privateDirections",
      "sourceLanguage",
      "description",
      "houseRules",
      "photos",
    ] as const satisfies readonly CottageProfileDraftRequirement[];
    const expectations = {
      en: {
        counts: [
          "0 of 13 requirements complete",
          "5 of 13 requirements complete",
          "12 of 13 requirements complete",
          "13 of 13 requirements complete",
        ],
        next: [
          "Next: add the cottage name.",
          "Next: choose the governorate.",
          "Next: add an approximate public location.",
          "Next: set guest capacity.",
          "Next: set bedrooms.",
          "Next: set bathrooms.",
          "Next: choose at least one amenity.",
          "Next: enter the cottage's exact coordinates.",
          "Next: add private directions.",
          "Next: choose the source language.",
          "Next: add a description.",
          "Next: add House Rules.",
          "Next: add or check your photos. You need 1–12 ready photos.",
        ],
        continue: "Continue setup",
        review: "Review and submit",
        open: "Open Cottage Profile",
        ready: "Ready to submit for content approval",
        unavailable: "Progress unavailable",
        check: "Open the Cottage Profile to check the required details",
        readOnly:
          "Submission is unavailable while your owner account is expired or suspended",
      },
      ar: {
        counts: [
          "اكتمل 0 من 13 متطلبًا",
          "اكتمل 5 من 13 متطلبًا",
          "اكتمل 12 من 13 متطلبًا",
          "اكتمل 13 من 13 متطلبًا",
        ],
        next: [
          "التالي: أضف اسم الكوخ.",
          "التالي: اختر المحافظة.",
          "التالي: أضف موقعًا عامًا تقريبيًا.",
          "التالي: حدّد سعة الضيوف.",
          "التالي: حدّد عدد غرف النوم.",
          "التالي: حدّد عدد الحمامات.",
          "التالي: اختر مرفقًا واحدًا على الأقل.",
          "التالي: أدخل إحداثيات الكوخ الدقيقة.",
          "التالي: أضف اتجاهات الوصول الخاصة.",
          "التالي: اختر لغة المصدر.",
          "التالي: أضف وصفًا.",
          "التالي: أضف قواعد المنزل.",
          "التالي: أضف صورك أو تحقق منها. تحتاج إلى 1–12 صورة جاهزة.",
        ],
        continue: "متابعة الإعداد",
        review: "المراجعة والإرسال",
        open: "فتح ملف الكوخ",
        ready: "جاهز للإرسال للموافقة على المحتوى",
        unavailable: "التقدم غير متاح",
        check: "افتح ملف الكوخ للتحقق من التفاصيل المطلوبة",
        readOnly:
          "الإرسال غير متاح ما دام حساب المالك منتهي الصلاحية أو موقوفًا",
      },
      ckb: {
        counts: [
          "٠ لە ١٣ پێداویستی تەواو کراوە",
          "٥ لە ١٣ پێداویستی تەواو کراوە",
          "١٢ لە ١٣ پێداویستی تەواو کراوە",
          "١٣ لە ١٣ پێداویستی تەواو کراوە",
        ],
        next: [
          "دواتر: ناوی کۆتێج زیاد بکە.",
          "دواتر: پارێزگا هەڵبژێرە.",
          "دواتر: شوێنێکی گشتیی نزیکەیی زیاد بکە.",
          "دواتر: ژمارەی میوان دیاری بکە.",
          "دواتر: ژمارەی ژوورەکانی نوستن دیاری بکە.",
          "دواتر: ژمارەی حەمامەکان دیاری بکە.",
          "دواتر: لانیکەم یەک خزمەتگوزاری هەڵبژێرە.",
          "دواتر: کۆئۆردیناتە وردەکانی کۆتێج بنووسە.",
          "دواتر: ڕێنمایی تایبەتی گەیشتن زیاد بکە.",
          "دواتر: زمانی سەرچاوە هەڵبژێرە.",
          "دواتر: وەسفێک زیاد بکە.",
          "دواتر: یاساکانی ماڵ زیاد بکە.",
          "دواتر: وێنەکانت زیاد بکە یان بیانپشکنە. پێویستت بە ١–١٢ وێنەی ئامادەیە.",
        ],
        continue: "بەردەوامبوون لە ئامادەکردن",
        review: "پێداچوونەوە و ناردن",
        open: "کردنەوەی پرۆفایلی کۆتێج",
        ready: "ئامادەیە بۆ ناردن بۆ پەسەندکردنی ناوەڕۆک",
        unavailable: "پێشکەوتن بەردەست نییە",
        check: "پرۆفایلی کۆتێج بکەرەوە بۆ پشکنینی وردەکارییە پێویستەکان",
        readOnly:
          "لە کاتێکدا هەژماری خاوەنەکەت بەسەرچووە یان ڕاگیراوە، ناردن بەردەست نییە",
      },
    };
    for (const locale of ["en", "ar", "ckb"] as const) {
      const expected = expectations[locale];
      const cases: {
        report: CottageProfile["draftProgress"];
        count: string;
        next: string;
        action: string;
      }[] = [
        {
          report: {
            status: "loaded",
            completed: 0,
            nextRequirement: "name",
            submissionAllowed: true,
          },
          count: expected.counts[0]!,
          next: expected.next[0]!,
          action: expected.continue,
        },
        {
          report: {
            status: "loaded",
            completed: 5,
            nextRequirement: "bathrooms",
            submissionAllowed: true,
          },
          count: expected.counts[1]!,
          next: expected.next[5]!,
          action: expected.continue,
        },
        ...requirements.map((key, index) => ({
          report: {
            status: "loaded" as const,
            completed: 12,
            nextRequirement: key,
            submissionAllowed: true,
          },
          count: expected.counts[2]!,
          next: expected.next[index]!,
          action: expected.continue,
        })),
        {
          report: {
            status: "loaded",
            completed: 13,
            nextRequirement: null,
            submissionAllowed: true,
          },
          count: expected.counts[3]!,
          next: expected.ready,
          action: expected.review,
        },
        {
          report: {
            status: "loaded",
            completed: 5,
            nextRequirement: "bathrooms",
            submissionAllowed: false,
          },
          count: expected.counts[1]!,
          next: expected.readOnly,
          action: expected.open,
        },
        {
          report: {
            status: "loaded",
            completed: 13,
            nextRequirement: null,
            submissionAllowed: false,
          },
          count: expected.counts[3]!,
          next: expected.readOnly,
          action: expected.open,
        },
        ...[undefined, { status: "unavailable" as const }].map((report) => ({
          report,
          count: expected.unavailable,
          next: expected.check,
          action: expected.open,
        })),
      ];
      for (const state of cases) {
        const { unmount } = render(
          <CottageProfileOverview
            locale={locale}
            actor="owner"
            profiles={[{ ...profile, draftProgress: state.report }]}
          />,
        );
        const card = screen.getByRole("article");
        expect(
          within(card).getByText(state.count, { exact: true }),
        ).toBeVisible();
        expect(
          within(card).getByText(state.next, { exact: true }),
        ).toBeVisible();
        expect(
          card.querySelectorAll(".cottage-profile-draft-next-step"),
        ).toHaveLength(1);
        expect(card.children).toHaveLength(5);
        expect(card.children[3]).toHaveClass("cottage-profile-card-supporting");
        const bar = card.querySelector(".cottage-profile-draft-progress-track");
        if (state.report?.status === "loaded") {
          expect(bar).toHaveAttribute("aria-hidden", "true");
          if (state.report.completed === 5) {
            const fill = bar!.querySelector("span")!;
            expect(fill.style.inlineSize).toMatch(/%$/);
            expect(Number.parseFloat(fill.style.inlineSize)).toBeCloseTo(
              38.46153846,
              3,
            );
          }
        } else expect(bar).toBeNull();
        expect(within(card).queryByRole("progressbar")).toBeNull();
        expect(within(card).queryByRole("status")).toBeNull();
        expect(
          within(card).getByRole("link", { name: state.action }),
        ).toHaveAttribute("href", `/${locale}/owner/cottages/${profile.id}`);
        unmount();
      }
      for (const [actor, fields] of [
        ["owner", published],
        ["owner", neverPublishedSubmitted],
        ["owner", abandoned],
        ["administrator", neverPublishedDraft],
      ] as const) {
        const { unmount } = render(
          <CottageProfileOverview
            locale={locale}
            actor={actor}
            profiles={[
              {
                ...profile,
                ...fields,
                draftProgress: {
                  status: "loaded",
                  completed: 13,
                  nextRequirement: null,
                  submissionAllowed: true,
                },
              },
            ]}
          />,
        );
        expect(screen.queryByText(expected.counts[3]!)).toBeNull();
        expect(screen.queryByText(expected.ready)).toBeNull();
        expect(
          screen
            .getByRole("article")
            .querySelector(".cottage-profile-draft-progress"),
        ).toBeNull();
        expect(
          screen.getByRole("link", { name: expected.open }),
        ).toHaveAttribute("href", `/${locale}/${actor}/cottages/${profile.id}`);
        unmount();
      }
    }
  });

  it("shows Sorani photo count digits without Sorani locale data", () => {
    const RealNumberFormat = Intl.NumberFormat;
    const numberFormat = vi
      .spyOn(Intl, "NumberFormat")
      .mockImplementation(function (locales, options) {
        const first = Array.isArray(locales) ? locales[0] : locales;
        return new RealNumberFormat(
          typeof first === "string" && first.startsWith("ckb")
            ? "en-US"
            : locales,
          options,
        );
      });
    const photos: CottageProfile["photos"] = (
      ["ready", "pending", "ready"] as const
    ).map((state, index) => ({
      id: `90000000-0000-4000-8000-00000000000${index + 1}`,
      originalFilename: `synthetic-${index + 1}.png`,
      mediaType: "image/png",
      sizeBytes: 1024,
      state,
      updatedAt: "2026-08-17T09:00:00.000Z",
    }));
    try {
      for (const [locale, expected] of [
        ["ckb", "٢/١٢ وێنە تایبەتەکانی کۆتێج"],
        ["en", "2/12 Private cottage photos"],
        ["ar", "2/12 صور الكوخ الخاصة"],
      ] as const) {
        const { unmount } = render(
          <CottageProfileOverview
            locale={locale}
            actor="owner"
            profiles={[{ ...profile, ...published, photos }]}
          />,
        );
        expect(screen.getByText(expected)).toBeVisible();
        unmount();
      }
    } finally {
      numberFormat.mockRestore();
    }
  });

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
    expect(card.children[3]).toHaveClass("cottage-profile-card-supporting");
    expect(card.lastElementChild).toHaveClass("cottage-profile-card-actions");
    expect(card.lastElementChild).toContainElement(
      screen.getByRole("link", { name: "Open Cottage Profile" }),
    );
    expect(
      screen.getByRole("link", { name: "Open Cottage Profile" }),
    ).toHaveClass("action-text");
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("page-title");
    expect(screen.queryByText("01")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Open Cottage Profile" }),
    ).toHaveAttribute(
      "href",
      "/en/owner/cottages/70000000-0000-4000-8000-000000000001",
    );
    expect(screen.getByRole("button", { name: "Add a cottage" })).toBeEnabled();
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
      screen.getByRole("button", { name: "إضافة كوخ" }).closest("form")!,
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
      screen.getByRole("button", { name: "Add a cottage" }).closest("form")!,
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
    expect(screen.getByRole("button", { name: "Add a cottage" })).toBeEnabled();
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
