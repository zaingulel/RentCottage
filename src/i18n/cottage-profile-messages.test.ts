import { describe, expect, it } from "vitest";

import {
  cottageProfileCounts,
  ownerCottagesSummarySentence,
} from "./cottage-profile-messages";
import type { Locale } from "./routing";

const publicationId = "80000000-0000-4000-8000-000000000001";

describe("owner Cottage Profile counts", () => {
  it("counts as published and draft exactly the cottages whose badges say so", () => {
    expect(
      cottageProfileCounts([
        {
          status: "draft",
          currentPublicationId: null,
          hasUnpublishedContentChange: false,
        },
        {
          status: "submitted_for_content_approval",
          currentPublicationId: null,
          hasUnpublishedContentChange: false,
        },
        {
          status: "abandoned",
          currentPublicationId: null,
          hasUnpublishedContentChange: false,
        },
        {
          status: "draft",
          currentPublicationId: publicationId,
          hasUnpublishedContentChange: false,
        },
        {
          status: "draft",
          currentPublicationId: publicationId,
          hasUnpublishedContentChange: true,
        },
        {
          status: "submitted_for_content_approval",
          currentPublicationId: publicationId,
          hasUnpublishedContentChange: true,
        },
      ]),
    ).toEqual({ published: 3, drafts: 1 });
  });

  it.each<{
    locale: Locale;
    published: number;
    drafts: number;
    expected: string;
  }>([
    {
      locale: "en",
      published: 2,
      drafts: 1,
      expected: "You have 2 published cottages and 1 draft.",
    },
    {
      locale: "en",
      published: 1,
      drafts: 0,
      expected: "You have 1 published cottage.",
    },
    { locale: "en", published: 0, drafts: 3, expected: "You have 3 drafts." },
    {
      locale: "en",
      published: 0,
      drafts: 0,
      expected: "None of your cottages is published yet.",
    },
    {
      locale: "ar",
      published: 2,
      drafts: 1,
      expected: "لديك 2 كوخان منشوران و1 مسودة.",
    },
    {
      locale: "ar",
      published: 11,
      drafts: 2,
      expected: "لديك 11 كوخًا منشورًا و2 مسودتان.",
    },
    {
      locale: "ar",
      published: 1,
      drafts: 0,
      expected: "لديك 1 كوخ منشور.",
    },
    { locale: "ar", published: 0, drafts: 3, expected: "لديك 3 مسودات." },
    {
      locale: "ar",
      published: 0,
      drafts: 0,
      expected: "لم يُنشر أي من أكواخك بعد.",
    },
    {
      locale: "ckb",
      published: 2,
      drafts: 1,
      expected: "٢ کۆتێجی بڵاوکراوە و ١ ڕەشنووست هەیە.",
    },
    {
      locale: "ckb",
      published: 1,
      drafts: 0,
      expected: "١ کۆتێجی بڵاوکراوەت هەیە.",
    },
    { locale: "ckb", published: 0, drafts: 3, expected: "٣ ڕەشنووست هەیە." },
    {
      locale: "ckb",
      published: 0,
      drafts: 0,
      expected: "هێشتا هیچ کام لە کۆتێجەکانت بڵاونەکراوەتەوە.",
    },
  ])(
    "words the owner's counts in $locale for $published published and $drafts drafts",
    ({ locale, published, drafts, expected }) => {
      expect(ownerCottagesSummarySentence(locale, { published, drafts })).toBe(
        expected,
      );
    },
  );
});
