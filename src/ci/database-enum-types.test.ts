// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { statuses } from "@/administrator-records/administrator-records";
import { states } from "@/booking-request/administrator-payment-history";
import { cottageProfileSourceLanguages } from "@/cottage-profile/cottage-profile";
import { verificationDocumentKinds } from "@/owner-application/owner-application";
import { ownerApplicationStatuses } from "@/owner-application/owner-application-status";

function withoutLineComments(text: string) {
  return text.replace(/--[^\n]*/g, "");
}

const declaredTypes = withoutLineComments(
  readFileSync(resolve(process.cwd(), "supabase/schemas/01_types.sql"), "utf8"),
);

function enumValues(name: string, schema = declaredTypes) {
  const declaration = new RegExp(
    `CREATE TYPE "public"\\."${name}" AS ENUM \\(([^)]*)\\)`,
  ).exec(schema);
  const values = [...(declaration?.[1] ?? "").matchAll(/'([^']*)'/g)].map(
    (match) => match[1],
  );
  if (values.length === 0) {
    throw new Error(`Enum type ${name} is not declared with values`);
  }
  return values;
}

function sorted(values: readonly string[]) {
  return [...values].sort();
}

function withoutExclusions(name: string, exclusions: readonly string[]) {
  const values = enumValues(name);
  for (const exclusion of exclusions) {
    expect(values).toContain(exclusion);
  }
  return values.filter((value) => !exclusions.includes(value));
}

describe("Database enum types", () => {
  it("owner_application_status matches ownerApplicationStatuses", () => {
    expect(sorted(ownerApplicationStatuses)).toEqual(
      sorted(enumValues("owner_application_status")),
    );
  });

  it("owner_verification_document_kind matches verificationDocumentKinds", () => {
    expect(sorted(verificationDocumentKinds)).toEqual(
      sorted(enumValues("owner_verification_document_kind")),
    );
  });

  it("cottage_profile_source_language matches cottageProfileSourceLanguages", () => {
    expect(sorted(cottageProfileSourceLanguages)).toEqual(
      sorted(enumValues("cottage_profile_source_language")),
    );
  });

  it("owner_approval_state matches the administrator owners list", () => {
    expect(sorted(statuses.owners)).toEqual(
      sorted(enumValues("owner_approval_state")),
    );
  });

  it("cottage_profile_status matches the administrator cottages list", () => {
    expect(sorted(statuses.cottages)).toEqual(
      sorted(enumValues("cottage_profile_status")),
    );
  });

  it("account_role minus platform_administrator matches the administrator customers list", () => {
    expect(sorted(statuses.customers)).toEqual(
      sorted(withoutExclusions("account_role", ["platform_administrator"])),
    );
  });

  it("owner_application_status minus draft matches the administrator applications list", () => {
    expect(sorted(statuses.applications)).toEqual(
      sorted(withoutExclusions("owner_application_status", ["draft"])),
    );
  });

  it("booking_request_authorization_claim_state is contained in the payment history states", () => {
    expect(states).toEqual(
      expect.arrayContaining(
        enumValues("booking_request_authorization_claim_state"),
      ),
    );
  });

  it("fails loudly when a named type is absent from the declared schema", () => {
    expect(() => enumValues("missing_enum_type")).toThrow(
      "Enum type missing_enum_type is not declared with values",
    );
  });

  it("ignores a value commented out of a declared enum", () => {
    const schema = withoutLineComments(
      `CREATE TYPE "public"."sample_state" AS ENUM (\n    'kept',\n    -- 'removed',\n    'also_kept'\n);`,
    );
    expect(enumValues("sample_state", schema)).toEqual(["kept", "also_kept"]);
  });
});
