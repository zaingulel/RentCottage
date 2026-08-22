import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  bookingRequestAcceptanceEvidence,
  bookingRequestUiPolicy,
} from "./booking-request-policy";

describe("Booking Request policy", () => {
  it.each([
    ["2099-08-21T18:00:00.000Z", false, true],
    ["2099-08-21T18:00:00.001Z", true, true],
    ["2099-08-20T00:00:00.000Z", false, false],
    ["2099-08-20T00:00:00.001Z", false, true],
  ] as const)(
    "evaluates the exact six- and 48-hour boundaries from %s",
    (evaluatedAt, insideCutoff, requiresInside48HourNoRefundAcceptance) => {
      expect(
        bookingRequestUiPolicy({
          firstStartsAt: "2099-08-22T00:00:00.000Z",
          evaluatedAt,
        }),
      ).toEqual({
        insideCutoff,
        requiresInside48HourNoRefundAcceptance,
      });
    },
  );

  it("rejects invalid dates instead of rendering a permissive policy", () => {
    expect(() =>
      bookingRequestUiPolicy({
        firstStartsAt: "not-a-date",
        evaluatedAt: "2099-08-20T00:00:00.000Z",
      }),
    ).toThrow("valid timestamps");
  });

  it("returns the exact authoritative localized acceptance evidence", () => {
    expect(
      bookingRequestAcceptanceEvidence({
        locale: "ar",
        termsVersion: "fictional-local-test-2026-08-22-v1",
        requiresInside48HourNoRefundAcceptance: true,
      }),
    ).toEqual({
      locale: "ar",
      cancellationPolicy:
        "الإلغاء قبل 48 ساعة على الأقل يعيد المبلغ كاملاً. لا استرداد عند الإلغاء خلال 48 ساعة أو عدم الحضور.",
      cancellationAcceptance: "أوافق على سياسة الإلغاء.",
      marketplaceTermsAcceptance:
        "أوافق على شروط الحجز في المنصة. (fictional-local-test-2026-08-22-v1)",
      inside48Warning:
        "يبدأ هذا الطلب خلال 48 ساعة وسيصبح غير قابل للاسترداد فور قبوله.",
      inside48Acceptance: "أفهم وأوافق على عدم الاسترداد خلال 48 ساعة.",
    });
  });

  it.each(["en", "ar", "ckb"] as const)(
    "keeps the self-contained database migration in parity with %s acceptance copy",
    (locale) => {
      const migration = readFileSync(
        resolve(
          process.cwd(),
          "supabase/migrations/20260821110000_booking_request_submission.sql",
        ),
        "utf8",
      );
      const functionBody = migration.match(
        /create function public\.booking_request_acceptance_evidence[\s\S]+?revoke all on function public\.booking_request_acceptance_evidence/,
      )?.[0];
      expect(functionBody).toBeDefined();
      const branch = functionBody?.match(
        new RegExp(
          `when '${locale}' then([\\s\\S]+?)(?=\\n    when '|\\n  end;)`,
        ),
      )?.[1];
      expect(branch).toBeDefined();
      const outside48 = bookingRequestAcceptanceEvidence({
        locale,
        termsVersion: "fictional-local-test-2026-08-22-v1",
        requiresInside48HourNoRefundAcceptance: false,
      });
      const inside48 = bookingRequestAcceptanceEvidence({
        locale,
        termsVersion: "fictional-local-test-2026-08-22-v1",
        requiresInside48HourNoRefundAcceptance: true,
      });
      const sqlLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;

      expect(branch).toContain(
        `'cancellationPolicy', ${sqlLiteral(outside48.cancellationPolicy)}`,
      );
      expect(branch).toContain(
        `'cancellationAcceptance', ${sqlLiteral(outside48.cancellationAcceptance)}`,
      );
      expect(branch).toContain(
        `'marketplaceTermsAcceptance', ${sqlLiteral(
          outside48.marketplaceTermsAcceptance.replace(
            "fictional-local-test-2026-08-22-v1)",
            "",
          ),
        )} || target_terms_version || ')'`,
      );
      expect(branch).toContain(sqlLiteral(inside48.inside48Warning ?? ""));
      expect(branch).toContain(sqlLiteral(inside48.inside48Acceptance ?? ""));
    },
  );
});
