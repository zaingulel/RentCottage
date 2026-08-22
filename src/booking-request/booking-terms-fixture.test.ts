import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BOOKING_TERMS_VERSION,
  bookingTermsFixture,
} from "./booking-terms-fixture";

describe("fictional marketplace booking terms", () => {
  const requiredDisclosures = {
    en: [
      "local software test only",
      "full displayed Customer Total",
      "remains pending",
      "fictional cancellation and no-show",
      "Do not share phone numbers",
      "not been approved by legal counsel",
    ],
    ar: [
      "اختبار برمجي محلي فقط",
      "إجمالي العميل المعروض كاملاً",
      "يبقى الطلب قيد الانتظار",
      "الإلغاء الخيالي وعدم الحضور",
      "لا تشارك أرقام الهواتف",
      "لم يعتمدها مستشار قانوني",
    ],
    ckb: [
      "تەنها تاقیکردنەوەی نەرمامێری ناوخۆییە",
      "تەواوی کۆی گشتی کڕیار",
      "داواکارییەکە بە چاوەڕوانی دەمێنێتەوە",
      "هەڵوەشاندنەوە و نەهاتنی خەیاڵی",
      "ژمارەی تەلەفۆن هاوبەش مەکە",
      "لەلایەن ڕاوێژکاری یاساییەوە پەسەند نەکراوە",
    ],
  } as const;

  it.each(["en", "ar", "ckb"] as const)(
    "binds the complete %s body to its literal SHA-256 identity",
    (locale) => {
      const fixture = bookingTermsFixture(locale);
      expect(fixture).toMatchObject({
        version: BOOKING_TERMS_VERSION,
        locale,
        operative: false,
      });
      expect(fixture.body.length).toBeGreaterThan(400);
      expect(fixture.body.match(/^\d+\./gm)).toHaveLength(7);
      for (const disclosure of requiredDisclosures[locale]) {
        expect(fixture.body).toContain(disclosure);
      }
      expect(
        createHash("sha256").update(fixture.body, "utf8").digest("hex"),
      ).toBe(fixture.sha256);
    },
  );

  it.each(["en", "ar", "ckb"] as const)(
    "keeps the PostgreSQL %s fixture body byte-for-byte aligned",
    (locale) => {
      const migration = readFileSync(
        resolve(
          process.cwd(),
          "supabase/migrations/20260821110000_booking_request_submission.sql",
        ),
        "utf8",
      );
      const branch = migration.match(
        new RegExp(`when '${locale}' then \\$terms\\$([\\s\\S]+?)\\$terms\\$`),
      )?.[1];
      expect(branch).toBe(bookingTermsFixture(locale).body);
    },
  );
});
