import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import * as OTPAuth from "otpauth";

const url = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!url || !secretKey || !publishableKey) {
  console.error(
    "SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY are required",
  );
  process.exitCode = 2;
} else {
  const client = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const password = "Local-test-password-2026";
  const { data: users, error: listError } = await client.auth.admin.listUsers();
  if (listError) throw listError;
  for (const profile of ["mobile", "desktop", "worker"]) {
    const email = `platform-administrator-${profile}@rentcottage.test`;
    const existing = users.users.find((user) => user.email === email);
    if (existing) {
      const { error } = await client.auth.admin.deleteUser(existing.id);
      if (error) throw error;
    }
    const { data, error } = await client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    const { error: provisionError } = await client.rpc(
      "provision_platform_administrator",
      { target_user_id: data.user.id },
    );
    if (provisionError) throw provisionError;
  }

  const reviewerEmail = "cottage-profile-fixture-reviewer@rentcottage.test";
  const existingReviewer = users.users.find(
    (user) => user.email === reviewerEmail,
  );
  if (existingReviewer) {
    const { error } = await client.auth.admin.deleteUser(existingReviewer.id);
    if (error) throw error;
  }
  const { data: reviewerUser, error: reviewerUserError } =
    await client.auth.admin.createUser({
      email: reviewerEmail,
      password,
      email_confirm: true,
    });
  if (reviewerUserError) throw reviewerUserError;
  const { error: reviewerProvisionError } = await client.rpc(
    "provision_platform_administrator",
    { target_user_id: reviewerUser.user.id },
  );
  if (reviewerProvisionError) throw reviewerProvisionError;
  const reviewerClient = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: reviewerSignInError } =
    await reviewerClient.auth.signInWithPassword({
      email: reviewerEmail,
      password,
    });
  if (reviewerSignInError) throw reviewerSignInError;
  const { data: enrolledFactor, error: enrollError } =
    await reviewerClient.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Cottage Profile fixture reviewer",
    });
  if (enrollError) throw enrollError;
  const { data: challenge, error: challengeError } =
    await reviewerClient.auth.mfa.challenge({ factorId: enrolledFactor.id });
  if (challengeError) throw challengeError;
  const reviewerCode = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(enrolledFactor.totp.secret),
  }).generate();
  const { error: verifyFactorError } = await reviewerClient.auth.mfa.verify({
    factorId: enrolledFactor.id,
    challengeId: challenge.id,
    code: reviewerCode,
  });
  if (verifyFactorError) throw verifyFactorError;

  const ownerClient = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const phone = "+9647500000002";
  const { error: otpError } = await ownerClient.auth.signInWithOtp({ phone });
  if (otpError) throw otpError;
  const { data: verified, error: verifyError } =
    await ownerClient.auth.verifyOtp({
      phone,
      token: "123456",
      type: "sms",
    });
  if (verifyError) throw verifyError;
  if (!verified.user) throw new Error("Concurrent upload test has no owner");
  const ownerUserId = verified.user.id;
  const { error: claimError } = await ownerClient.rpc(
    "claim_marketplace_role",
    { requested_role: "cottage_owner" },
  );
  if (claimError) throw claimError;
  const { error: saveError } = await ownerClient.rpc("save_owner_application", {
    requested_applicant_kind: "individual",
    requested_legal_name: "Concurrent Upload Test",
    requested_company_name: null,
    requested_licensing_basis: "licence",
    requested_exemption_basis: null,
    requested_cottage_name: "Concurrency Cottage",
    requested_governorate: "Erbil",
    requested_approximate_location: "Test area",
    requested_exact_address: "Test address",
    requested_capacity: 2,
    requested_bedrooms: 1,
    requested_bathrooms: 1,
    requested_amenities: [],
    requested_description: "Concurrent registration regression fixture.",
    requested_house_rules: "Test only.",
  });
  if (saveError) throw saveError;
  const { data: application, error: applicationError } = await ownerClient
    .from("owner_applications")
    .select("id")
    .single();
  if (applicationError) throw applicationError;

  const pdfBytes = new TextEncoder().encode("%PDF-1.7\nfixture\n%%EOF");
  const pdfDigest = createHash("sha256").update(pdfBytes).digest("hex");
  const prepareUpload = async (suffix) => {
    const objectPath = `${ownerUserId}/${application.id}/identity/90000000-0000-4000-8000-00000000000${suffix}.pdf`;
    const { data: cleanupId, error: prepareError } = await client.rpc(
      "prepare_owner_verification_document_upload",
      {
        requested_owner_user_id: ownerUserId,
        requested_application_id: application.id,
        requested_kind: "identity",
        requested_object_path: objectPath,
        requested_original_filename: `identity-${suffix}.pdf`,
        requested_media_type: "application/pdf",
        requested_size_bytes: pdfBytes.byteLength,
      },
    );
    if (prepareError) throw prepareError;
    const { error: uploadError } = await client.storage
      .from("owner-verification")
      .upload(objectPath, pdfBytes, {
        contentType: "application/pdf",
        upsert: false,
      });
    if (uploadError) throw uploadError;
    return { cleanupId, objectPath };
  };

  const baseline = await prepareUpload(0);
  const { error: baselineError } = await client.rpc(
    "register_owner_verification_document",
    { target_cleanup_id: baseline.cleanupId },
  );
  if (baselineError) throw baselineError;

  const candidates = await Promise.all(
    Array.from({ length: 8 }, (_, index) => prepareUpload(index + 1)),
  );
  const registrations = await Promise.all(
    candidates.map(({ cleanupId }) =>
      client.rpc("register_owner_verification_document", {
        target_cleanup_id: cleanupId,
      }),
    ),
  );
  const registrationError = registrations.find(({ error }) => error)?.error;
  if (registrationError) throw registrationError;

  const { data: currentDocument, error: documentError } = await ownerClient
    .from("owner_verification_documents")
    .select("object_path")
    .eq("kind", "identity")
    .single();
  if (documentError) throw documentError;
  const { data: pendingCleanup, error: cleanupError } = await client
    .from("owner_verification_document_cleanup")
    .select("object_path")
    .eq("application_id", application.id)
    .eq("reason", "replaced")
    .eq("status", "pending");
  if (cleanupError) throw cleanupError;

  const expectedPaths = new Set(
    [baseline, ...candidates]
      .map(({ objectPath }) => objectPath)
      .filter((objectPath) => objectPath !== currentDocument.object_path),
  );
  const recordedPaths = new Set(
    pendingCleanup.map(({ object_path: objectPath }) => objectPath),
  );
  if (
    expectedPaths.size !== 8 ||
    recordedPaths.size !== expectedPaths.size ||
    [...expectedPaths].some((objectPath) => !recordedPaths.has(objectPath))
  ) {
    throw new Error(
      "Concurrent document registration did not preserve every displaced object for cleanup",
    );
  }

  const cottageOwnerFixtures = [
    { profile: "mobile", phone: "+9647510000000" },
    { profile: "desktop", phone: "+9647510000001" },
    { profile: "worker", phone: "+9647510000002" },
  ];
  for (const fixture of cottageOwnerFixtures) {
    const { data: fixtureIdentity, error: fixtureIdentityError } =
      await client.auth.admin.createUser({
        phone: fixture.phone,
        password,
        phone_confirm: true,
      });
    if (fixtureIdentityError) throw fixtureIdentityError;
    const fixtureOwner = createClient(url, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: verifiedOwner, error: ownerVerifyError } =
      await fixtureOwner.auth.signInWithPassword({
        phone: fixture.phone,
        password,
      });
    if (ownerVerifyError) throw ownerVerifyError;
    if (
      !verifiedOwner.user ||
      verifiedOwner.user.id !== fixtureIdentity.user.id
    ) {
      throw new Error("Fixture owner was not created");
    }
    const { error: fixtureClaimError } = await fixtureOwner.rpc(
      "claim_marketplace_role",
      { requested_role: "cottage_owner" },
    );
    if (fixtureClaimError) throw fixtureClaimError;
    const { error: fixtureSaveError } = await fixtureOwner.rpc(
      "save_owner_application",
      {
        requested_applicant_kind: "individual",
        requested_legal_name: `${fixture.profile} Cottage Owner`,
        requested_company_name: null,
        requested_licensing_basis: "licence",
        requested_exemption_basis: null,
        requested_cottage_name: `${fixture.profile} Application Cottage`,
        requested_governorate: "Erbil",
        requested_approximate_location: "Near Shaqlawa",
        requested_exact_address: "Private orchard road",
        requested_capacity: 8,
        requested_bedrooms: 3,
        requested_bathrooms: 2,
        requested_amenities: ["garden", "parking"],
        requested_description: "A private approved-owner browser fixture.",
        requested_house_rules: "Respect neighbours and leave the cottage tidy.",
      },
    );
    if (fixtureSaveError) throw fixtureSaveError;
    const { data: fixtureApplication, error: fixtureApplicationError } =
      await fixtureOwner.from("owner_applications").select("id").single();
    if (fixtureApplicationError) throw fixtureApplicationError;

    for (const [index, kind] of [
      "identity",
      "authority_to_rent",
      "licensing_or_exemption",
      "payout_account",
    ].entries()) {
      const objectPath = `${verifiedOwner.user.id}/${fixtureApplication.id}/${kind}/${crypto.randomUUID()}.pdf`;
      const { data: cleanupId, error: fixturePrepareError } = await client.rpc(
        "prepare_owner_verification_document_upload_v2",
        {
          requested_owner_user_id: verifiedOwner.user.id,
          requested_application_id: fixtureApplication.id,
          requested_kind: kind,
          requested_object_path: objectPath,
          requested_original_filename: `${fixture.profile}-${kind}-${index}.pdf`,
          requested_media_type: "application/pdf",
          requested_size_bytes: pdfBytes.byteLength,
          requested_content_digest: pdfDigest,
        },
      );
      if (fixturePrepareError) throw fixturePrepareError;
      const { error: fixtureUploadError } = await client.storage
        .from("owner-verification")
        .upload(objectPath, pdfBytes, {
          contentType: "application/pdf",
          upsert: false,
        });
      if (fixtureUploadError) throw fixtureUploadError;
      const { error: fixtureRegisterError } = await client.rpc(
        "register_owner_verification_document_v2",
        { target_cleanup_id: cleanupId },
      );
      if (fixtureRegisterError) throw fixtureRegisterError;
    }
    const { data: submittedApplication, error: fixtureSubmitError } =
      await fixtureOwner.rpc("submit_owner_application");
    if (fixtureSubmitError) throw fixtureSubmitError;
    const { error: fixtureApproveError } = await reviewerClient.rpc(
      "review_owner_application",
      {
        target_application_id: fixtureApplication.id,
        expected_version: submittedApplication.version,
        requested_action: "approve",
        requested_reason: "Approved browser fixture.",
        requested_fields: [],
        requested_document_kinds: [],
        requested_jurisdiction: "Kurdistan Region, Iraq",
        requested_licensing_basis: "licence",
        requested_licence_or_exemption_basis: "Test licence",
        requested_expiry_dates: {
          licensing_or_exemption: "2035-12-31",
        },
      },
    );
    if (fixtureApproveError) throw fixtureApproveError;
  }
  console.log(
    "Concurrent verification registration preserved all 8 displaced objects for cleanup.",
  );
  console.log(
    "Prepared approved Cottage Profile fixtures for every browser project.",
  );
}
