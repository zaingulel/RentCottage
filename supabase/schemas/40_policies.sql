SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;
SET default_tablespace = '';
SET default_table_access_method = "heap";

CREATE POLICY "Account holder reads own context" ON "public"."account_contexts" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));

CREATE POLICY "Applicant or MFA administrator reads Owner Applications" ON "public"."owner_applications" FOR SELECT TO "authenticated" USING ((("owner_user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (("status" <> 'draft'::"public"."owner_application_status") AND ( SELECT "public"."is_platform_administrator"('aal2'::"text") AS "is_platform_administrator"))));

CREATE POLICY "Applicant or MFA administrator reads renewal work" ON "public"."owner_application_renewal_work" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."owner_applications"
  WHERE (("owner_applications"."id" = "owner_application_renewal_work"."application_id") AND ("owner_applications"."owner_user_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR ( SELECT "public"."is_platform_administrator"('aal2'::"text") AS "is_platform_administrator")));

CREATE POLICY "Applicant or MFA administrator reads verification metadata" ON "public"."owner_verification_documents" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."owner_applications"
  WHERE (("owner_applications"."id" = "owner_verification_documents"."application_id") AND ("owner_applications"."owner_user_id" = ( SELECT "auth"."uid"() AS "uid"))))) OR (( SELECT "public"."is_platform_administrator"('aal2'::"text") AS "is_platform_administrator") AND (EXISTS ( SELECT 1
   FROM "public"."owner_applications"
  WHERE ("owner_applications"."id" = "owner_verification_documents"."application_id"))))));

CREATE POLICY "Applicant reads in-product notices" ON "public"."owner_application_notices" FOR SELECT TO "authenticated" USING (("owner_user_id" = ( SELECT "auth"."uid"() AS "uid")));

CREATE POLICY "Cottage Owner reads own servicing scope" ON "public"."cottage_ownership" FOR SELECT TO "authenticated" USING ((("owner_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."account_contexts"
  WHERE (("account_contexts"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("account_contexts"."role" = 'cottage_owner'::"public"."account_role") AND ("account_contexts"."owner_approval_state" = ANY (ARRAY['approved'::"public"."owner_approval_state", 'expired'::"public"."owner_approval_state", 'suspended'::"public"."owner_approval_state"])))))));

CREATE POLICY "MFA administrator reads Cottage Profile edit audit" ON "public"."cottage_profile_administrator_audit" FOR SELECT TO "authenticated" USING (( SELECT "public"."is_platform_administrator"('aal2'::"text") AS "is_platform_administrator"));

CREATE POLICY "MFA administrator reads Cottage translation quality reports" ON "public"."cottage_translation_quality_reports" FOR SELECT TO "authenticated" USING (( SELECT "public"."is_platform_administrator"('aal2'::"text") AS "is_platform_administrator"));

CREATE POLICY "MFA administrator reads account contexts" ON "public"."account_contexts" FOR SELECT TO "authenticated" USING (( SELECT "public"."is_platform_administrator"('aal2'::"text") AS "is_platform_administrator"));

CREATE POLICY "MFA administrator reads cottage scopes" ON "public"."cottage_ownership" FOR SELECT TO "authenticated" USING (( SELECT "public"."is_platform_administrator"('aal2'::"text") AS "is_platform_administrator"));

CREATE POLICY "MFA administrator reads evidence versions" ON "public"."owner_verification_document_versions" FOR SELECT TO "authenticated" USING (( SELECT "public"."is_platform_administrator"('aal2'::"text") AS "is_platform_administrator"));

CREATE POLICY "MFA administrator reads information requests" ON "public"."owner_application_information_requests" FOR SELECT TO "authenticated" USING (( SELECT "public"."is_platform_administrator"('aal2'::"text") AS "is_platform_administrator"));

CREATE POLICY "MFA administrator reads transition history" ON "public"."owner_application_transitions" FOR SELECT TO "authenticated" USING (( SELECT "public"."is_platform_administrator"('aal2'::"text") AS "is_platform_administrator"));

CREATE POLICY "MFA administrator reads verification audit" ON "public"."owner_verification_document_audit" FOR SELECT TO "authenticated" USING (( SELECT "public"."is_platform_administrator"('aal2'::"text") AS "is_platform_administrator"));

CREATE POLICY "MFA administrator reads verification records" ON "public"."owner_application_verification_records" FOR SELECT TO "authenticated" USING (( SELECT "public"."is_platform_administrator"('aal2'::"text") AS "is_platform_administrator"));

CREATE POLICY "Owner or MFA administrator reads Cottage Profile decisions" ON "public"."cottage_profile_localized_decisions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."cottage_profile_review_cycles" "cycles"
  WHERE (("cycles"."id" = "cottage_profile_localized_decisions"."review_cycle_id") AND (("cycles"."owner_user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_platform_administrator"('aal2'::"text") AS "is_platform_administrator"))))));

CREATE POLICY "Owner or MFA administrator reads Cottage Profile localized head" ON "public"."cottage_profile_localized_heads" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."cottage_profile_review_cycles" "cycles"
  WHERE (("cycles"."id" = "cottage_profile_localized_heads"."review_cycle_id") AND (("cycles"."owner_user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_platform_administrator"('aal2'::"text") AS "is_platform_administrator"))))));

CREATE POLICY "Owner or MFA administrator reads Cottage Profile localized hist" ON "public"."cottage_profile_localized_revisions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."cottage_profile_review_cycles" "cycles"
  WHERE (("cycles"."id" = "cottage_profile_localized_revisions"."review_cycle_id") AND (("cycles"."owner_user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_platform_administrator"('aal2'::"text") AS "is_platform_administrator"))))));

CREATE POLICY "Owner or MFA administrator reads Cottage Profile publication de" ON "public"."cottage_profile_publication_decisions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."cottage_profile_review_cycles" "cycles"
  WHERE (("cycles"."id" = "cottage_profile_publication_decisions"."review_cycle_id") AND (("cycles"."owner_user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_platform_administrator"('aal2'::"text") AS "is_platform_administrator"))))));

CREATE POLICY "Owner or MFA administrator reads Cottage Profile review cycles" ON "public"."cottage_profile_review_cycles" FOR SELECT TO "authenticated" USING ((("owner_user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_platform_administrator"('aal2'::"text") AS "is_platform_administrator")));

CREATE POLICY "Owner or MFA administrator reads Cottage Profile review photos" ON "public"."cottage_profile_review_photos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."cottage_profile_review_cycles" "cycles"
  WHERE (("cycles"."id" = "cottage_profile_review_photos"."review_cycle_id") AND (("cycles"."owner_user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_platform_administrator"('aal2'::"text") AS "is_platform_administrator"))))));

CREATE POLICY "Owner or MFA administrator reads Cottage Profile source" ON "public"."cottage_profile_source_revisions" FOR SELECT TO "authenticated" USING ((("owner_user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_platform_administrator"('aal2'::"text") AS "is_platform_administrator")));

CREATE POLICY "Owner or MFA administrator reads Cottage Shifts" ON "public"."cottage_shifts" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."cottage_shift_schedule_revisions" "revisions"
     JOIN "public"."owner_application_cottage_profiles" "profiles" ON (("profiles"."id" = "revisions"."profile_id")))
  WHERE (("revisions"."id" = "cottage_shifts"."schedule_revision_id") AND (("profiles"."owner_user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_platform_administrator"('aal2'::"text") AS "is_platform_administrator"))))));

CREATE POLICY "Owner or MFA administrator reads Cottage translation human revi" ON "public"."cottage_profile_translation_human_reviews" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."cottage_profile_review_cycles" "cycles"
  WHERE (("cycles"."id" = "cottage_profile_translation_human_reviews"."review_cycle_id") AND (("cycles"."owner_user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_platform_administrator"('aal2'::"text") AS "is_platform_administrator"))))));

CREATE POLICY "Owner or MFA administrator reads Shift Schedule revisions" ON "public"."cottage_shift_schedule_revisions" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."owner_application_cottage_profiles" "profiles"
  WHERE (("profiles"."id" = "cottage_shift_schedule_revisions"."profile_id") AND (("profiles"."owner_user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_platform_administrator"('aal2'::"text") AS "is_platform_administrator"))))));

CREATE POLICY "Owner or MFA administrator reads private Cottage Profile photos" ON "public"."cottage_profile_photos" FOR SELECT TO "authenticated" USING ((("owner_user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_platform_administrator"('aal2'::"text") AS "is_platform_administrator")));

CREATE POLICY "Owner or MFA administrator reads private Cottage Profiles" ON "public"."owner_application_cottage_profiles" FOR SELECT TO "authenticated" USING ((("owner_user_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_platform_administrator"('aal2'::"text") AS "is_platform_administrator")));

CREATE POLICY "Owner reads own Cottage translation quality reports" ON "public"."cottage_translation_quality_reports" FOR SELECT TO "authenticated" USING (("reporter_user_id" = ( SELECT "auth"."uid"() AS "uid")));

ALTER TABLE "public"."account_contexts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."booking_confirmations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."booking_receipts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."booking_request_authorization_claim_items" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."booking_request_authorization_claim_occupancies" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."booking_request_authorization_claims" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."booking_request_authorization_reconciliation_outbox" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."booking_request_capture_work" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."booking_request_confirmation_invalidations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."booking_request_payment_correction_observations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."booking_request_payment_history" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."booking_request_payment_recovery_attempts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."booking_request_payment_recovery_operations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."booking_request_payment_required_expiry_operations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."booking_request_payment_required_expiry_work" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."booking_request_provider_operation_identities" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."booking_request_release_operations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."booking_request_release_work" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."booking_request_status_notifications" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."booking_request_submission_attempts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."booking_requests" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."booking_snapshots" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."booking_confirmation_notification_work" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."booking_confirmation_notification_attempts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."fictional_booking_confirmation_notification_effects" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_booking_period_commitments" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_booking_period_occupancies" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_inventory_availability" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_inventory_commitments" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_inventory_date_price_overrides" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_inventory_standard_prices" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_inventory_weekday_price_overrides" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_marketplace_listings" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_ownership" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_profile_administrator_audit" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_profile_localized_decisions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_profile_localized_heads" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_profile_localized_revisions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_profile_photos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_profile_publication_decisions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_profile_review_cycles" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_profile_review_photos" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_profile_source_revisions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_profile_translation_attempts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_profile_translation_human_reviews" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_publication_localizations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_publication_media" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_publication_snapshots" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_shift_schedule_revisions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_shifts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_translation_cache" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_translation_quality_reports" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_translation_runtime_control" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_translation_usage_reservations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cottage_translation_usage_results" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."owner_application_cottage_profiles" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."owner_application_information_requests" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."owner_application_lifecycle_control" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."owner_application_notices" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."owner_application_renewal_work" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."owner_application_transitions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."owner_application_verification_records" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."owner_applications" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."owner_request_notifications" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."owner_verification_document_access_grants" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."owner_verification_document_audit" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."owner_verification_document_cleanup" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."owner_verification_document_versions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."owner_verification_documents" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."privileged_sign_in_attempts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."payment_provider_operations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."payment_provider_observations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."simulated_payment_effects" ENABLE ROW LEVEL SECURITY;
