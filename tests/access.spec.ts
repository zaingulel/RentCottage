import { expect, test } from "@playwright/test";
import { createHmac } from "node:crypto";
import * as OTPAuth from "otpauth";
import { createClient } from "@supabase/supabase-js";

const auditClient = createClient(
  process.env.SUPABASE_URL ?? "",
  process.env.SUPABASE_SECRET_KEY ?? "",
  { auth: { autoRefreshToken: false, persistSession: false } },
);

function expectedEmailDigest(email: string) {
  return createHmac("sha256", process.env.PRIVILEGED_AUDIT_HMAC_KEY ?? "")
    .update(email.trim().toLowerCase())
    .digest("hex");
}

async function administratorId(email: string) {
  const { data, error } = await auditClient.auth.admin.listUsers();
  if (error) throw error;
  const userId = data.users.find((user) => user.email === email)?.id;
  if (!userId) throw new Error(`No test administrator exists for ${email}`);
  return userId;
}

async function currentAudit(
  actorUserId: string,
  attemptedAfter: string,
  stage: "primary" | "mfa",
  outcome: "succeeded" | "failed",
) {
  const { data, error } = await auditClient
    .from("privileged_sign_in_attempts")
    .select("id, actor_user_id, email_digest, attempted_at")
    .eq("actor_user_id", actorUserId)
    .eq("stage", stage)
    .eq("outcome", outcome)
    .gte("attempted_at", attemptedAfter)
    .order("attempted_at", { ascending: false })
    .limit(1)
    .single();
  if (error) throw error;
  return data;
}

async function currentDocumentAccessAudit(
  actorUserId: string,
  occurredAfter: string,
) {
  const { data, error } = await auditClient
    .from("owner_verification_document_audit")
    .select(
      "id, document_id, actor_user_id, actor_subject_id, action, object_path, occurred_at",
    )
    .eq("actor_subject_id", actorUserId)
    .eq("action", "access_granted")
    .gte("occurred_at", occurredAfter)
    .order("occurred_at", { ascending: false })
    .limit(1)
    .single();
  if (error) throw error;
  return data;
}

function journeyPhone(projectName: string, digits: [string, string, string]) {
  const suffixes: Record<string, string> = {
    mobile: digits[0],
    desktop: digits[1],
    worker: digits[2],
  };
  const suffix = suffixes[projectName];
  if (!suffix) throw new Error(`Unmapped Playwright project: ${projectName}`);
  return `+964750000000${suffix}`;
}

test.describe.configure({ mode: "serial" });

test("a Customer verifies an Iraqi phone without losing the booking draft", async ({
  page,
}) => {
  await page.goto("/en/request/garden-house");
  await expect(
    page.getByText("Phone verification is available."),
  ).toBeVisible();
  await page
    .getByLabel("Note to the owner")
    .fill("Ground-floor access, please");
  await page.getByLabel("Iraqi phone number").fill("+9647500000000");
  await page.getByRole("button", { name: "Send verification code" }).click();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify" }).click();

  await expect(page.getByText("You have Customer access only")).toBeVisible();
  await expect(page.getByLabel("Note to the owner")).toHaveValue(
    "Ground-floor access, please",
  );
});

test("a prospective Cottage Owner receives no approved-owner claim", async ({
  page,
}) => {
  await page.goto("/ckb/owner/access");
  await page.getByLabel("ژمارە تەلەفۆنی عێراقی").fill("+9647500000001");
  await page.getByRole("button", { name: "کۆدی پشتڕاستکردنەوە بنێرە" }).click();
  await page.getByLabel("کۆدی پشتڕاستکردنەوە").fill("123456");
  await page.getByRole("button", { name: "پشتڕاست بکەرەوە" }).click();

  await expect(page.getByText(/چاوەڕێی پەسەندە/)).toBeVisible();
});

test("Arabic access renders right to left", async ({ page }) => {
  await page.goto("/ar/owner/access");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByLabel("رقم الهاتف العراقي")).toBeVisible();
});

test("a Cottage Owner saves, resumes and submits a complete private application", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.goto("/en/owner/access");
  await page
    .getByLabel("Iraqi phone number")
    .fill(journeyPhone(testInfo.project.name, ["3", "4", "5"]));
  await page.getByRole("button", { name: "Send verification code" }).click();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(
    page.getByText("Verified. Your Cottage Owner access is awaiting approval."),
  ).toBeVisible();
  expect(
    (await page.context().cookies()).some((cookie) =>
      cookie.name.startsWith("rentcottage-auth"),
    ),
  ).toBe(true);
  await page
    .getByRole("link", { name: "Continue to Owner Application" })
    .click();

  await page.getByLabel("Legal name").fill("Zana Kareem");
  await page.getByLabel("Cottage name").fill("Garden House");
  await page.getByLabel("Governorate").fill("Erbil");
  await page.getByLabel("Approximate public area").fill("Shaqlawa countryside");
  await page
    .getByLabel("Exact private address")
    .fill("Near the eastern orchard road");
  await page.getByLabel("Guest capacity").fill("8");
  await page.getByLabel("Bedrooms").fill("3");
  await page.getByLabel("Bathrooms").fill("2");
  await page.getByLabel("Garden").check();
  await page.getByLabel("Parking").check();
  await page
    .getByLabel("Cottage description")
    .fill("A quiet family cottage surrounded by fruit trees.");
  await page
    .getByLabel("House Rules")
    .fill("Families only. No amplified music after 10pm.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Legal name")).toHaveValue("Zana Kareem");
  await expect(page.getByLabel("Cottage name")).toHaveValue("Garden House");
  await expect(page.getByLabel("Garden")).toBeChecked();
  await expect(page.getByLabel("Parking")).toBeChecked();

  const evidence = [
    ["Identity evidence", "identity.pdf"],
    ["Authority-to-rent evidence", "authority.pdf"],
    ["Licence or exemption evidence", "licence.pdf"],
    ["Payout-account evidence", "payout.pdf"],
  ] as const;
  for (const [label, filename] of evidence) {
    const card = page.getByRole("article", { name: label });
    await card.locator('input[type="file"]').setInputFiles({
      name: filename,
      mimeType: "application/pdf",
      buffer:
        filename === "identity.pdf"
          ? Buffer.concat([
              Buffer.from("%PDF-1.7\n"),
              Buffer.alloc(1_099_980),
              Buffer.from("\n%%EOF"),
            ])
          : Buffer.from("%PDF-1.7\nprivate-test-document\n%%EOF"),
    });
    await card.getByRole("button", { name: "Upload document" }).click();
    await expect(
      page.getByRole("article", { name: label }).getByText(filename),
    ).toBeVisible();
  }

  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(page.getByText("Submitted for review")).toBeVisible();
  await expect(page.getByLabel("Legal name")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Submit application" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /publish/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /booking/i })).toHaveCount(0);

  await expect(page.getByRole("link", { name: /secure link/i })).toHaveCount(0);
});

test("Arabic Owner Application stays right to left and private", async ({
  page,
}, testInfo) => {
  await page.goto("/ar/owner/access");
  await page
    .getByLabel("رقم الهاتف العراقي")
    .fill(journeyPhone(testInfo.project.name, ["6", "7", "8"]));
  await page.getByRole("button", { name: "أرسل رمز التحقق" }).click();
  await page.getByLabel("رمز التحقق").fill("123456");
  await page.getByRole("button", { name: "تحقق" }).click();
  await expect(page.getByText(/بانتظار الموافقة/)).toBeVisible();
  await page.getByRole("link", { name: "تابع إلى طلب المالك" }).click();

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: "بياناتك" })).toBeVisible();
  await expect(page.getByText(/لا تُنشر وثائق التحقق/)).toBeVisible();
});

test("a Platform Administrator reaches access only after authenticator MFA", async ({
  page,
}, testInfo) => {
  const email = `platform-administrator-${testInfo.project.name}@rentcottage.test`;
  const actorUserId = await administratorId(email);
  const attemptedAfter = new Date().toISOString();
  await page.goto("/en/administrator/access");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Local-test-password-2026");
  await page.getByRole("button", { name: "Continue" }).click();
  const secret = await page.getByTestId("mfa-secret").textContent();
  if (!secret) throw new Error("MFA enrollment returned no secret");
  const failedAttemptedAfter = new Date().toISOString();
  await page.getByLabel("Authenticator app code").fill("12");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText(/code could not be confirmed/)).toBeVisible();
  const failedAudit = await currentAudit(
    actorUserId,
    failedAttemptedAfter,
    "mfa",
    "failed",
  );
  expect(failedAudit.actor_user_id).toBe(actorUserId);
  expect(failedAudit.email_digest).toBe(expectedEmailDigest(email));
  const code = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
  }).generate();
  await page.getByLabel("Authenticator app code").fill(code);
  await page.getByRole("button", { name: "Verify" }).click();

  await expect(page.getByText(/Administrator access is ready/)).toBeVisible();
  const audit = await currentAudit(
    actorUserId,
    attemptedAfter,
    "mfa",
    "succeeded",
  );
  expect(audit.actor_user_id).toBe(actorUserId);
  expect(audit.email_digest).toBe(expectedEmailDigest(email));
  expect(new Date(audit.attempted_at).getTime()).toBeGreaterThanOrEqual(
    new Date(attemptedAfter).getTime(),
  );

  await page
    .getByRole("link", { name: "Review submitted Owner Applications" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Submitted Owner Applications" }),
  ).toBeVisible();
  await expect(page.getByText("identity.pdf").first()).toBeVisible();
  const accessedAfter = new Date(Date.now() - 5_000).toISOString();
  const identityDocument = page
    .locator("li")
    .filter({ hasText: "identity.pdf" })
    .first();
  await identityDocument
    .getByRole("button", { name: "Create secure link" })
    .click();
  const secureLink = identityDocument.getByRole("link", {
    name: "Open secure document",
  });
  await expect(secureLink).toBeVisible();
  const signedUrl = await secureLink.getAttribute("href");
  if (!signedUrl) throw new Error("Secure document link has no URL");
  const documentResponse = await page.request.get(signedUrl);
  expect(documentResponse.status()).toBe(200);
  expect(documentResponse.headers()["content-type"]).toContain(
    "application/pdf",
  );
  expect((await documentResponse.body()).subarray(0, 4).toString()).toBe(
    "%PDF",
  );
  const documentAudit = await currentDocumentAccessAudit(
    actorUserId,
    accessedAfter,
  );
  expect(documentAudit.actor_user_id).toBe(actorUserId);
  expect(documentAudit.actor_subject_id).toBe(actorUserId);
  expect(documentAudit.action).toBe("access_granted");
  expect(documentAudit.document_id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  expect(decodeURIComponent(new URL(signedUrl).pathname)).toContain(
    `/owner-verification/${documentAudit.object_path}`,
  );
});

test("an empty administrator password is recorded as a failed attempt", async ({
  page,
}, testInfo) => {
  const email = `platform-administrator-${testInfo.project.name}@rentcottage.test`;
  const actorUserId = await administratorId(email);
  const attemptedAfter = new Date().toISOString();
  await page.goto("/en/administrator/access");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText(/sign-in is invalid/)).toBeVisible();
  const audit = await currentAudit(
    actorUserId,
    attemptedAfter,
    "primary",
    "failed",
  );
  expect(audit.actor_user_id).toBe(actorUserId);
  expect(audit.email_digest).toBe(expectedEmailDigest(email));
});

test("failed administrator sign-in gives no privileged access", async ({
  page,
}, testInfo) => {
  const email = `platform-administrator-${testInfo.project.name}@rentcottage.test`;
  const actorUserId = await administratorId(email);
  const attemptedAfter = new Date().toISOString();
  await page.goto("/en/administrator/access");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText(/sign-in is invalid/)).toBeVisible();
  await expect(page.getByLabel("Authenticator app code")).toHaveCount(0);
  const audit = await currentAudit(
    actorUserId,
    attemptedAfter,
    "primary",
    "failed",
  );
  expect(audit.actor_user_id).toBe(actorUserId);
  expect(audit.email_digest).toBe(expectedEmailDigest(email));
  expect(new Date(audit.attempted_at).getTime()).toBeGreaterThanOrEqual(
    new Date(attemptedAfter).getTime(),
  );
});
