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

-- Tables whose default REFERENCES/TRIGGER/TRUNCATE/MAINTAIN privileges the migrations revoked.

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_confirmations" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_confirmations" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_confirmations" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_receipts" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_receipts" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_receipts" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_authorization_claim_items" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_authorization_claim_items" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_authorization_claim_items" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_authorization_claim_occupancies" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_authorization_claim_occupancies" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_authorization_claim_occupancies" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_authorization_claims" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_authorization_claims" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_authorization_claims" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_authorization_reconciliation_outbox" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_authorization_reconciliation_outbox" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_authorization_reconciliation_outbox" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_capture_work" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_capture_work" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_capture_work" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_confirmation_invalidations" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_confirmation_invalidations" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_confirmation_invalidations" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_payment_correction_observations" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_payment_correction_observations" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_payment_correction_observations" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_payment_history" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_payment_history" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_payment_history" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_payment_recovery_attempts" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_payment_recovery_attempts" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_payment_recovery_attempts" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_payment_recovery_operations" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_payment_recovery_operations" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_payment_recovery_operations" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_payment_required_expiry_operations" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_payment_required_expiry_operations" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_payment_required_expiry_operations" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_payment_required_expiry_work" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_payment_required_expiry_work" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_payment_required_expiry_work" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_provider_operation_identities" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_provider_operation_identities" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_provider_operation_identities" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_release_operations" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_release_operations" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_release_operations" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_release_work" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_release_work" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_release_work" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_status_notifications" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_status_notifications" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_status_notifications" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_submission_attempts" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_submission_attempts" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_request_submission_attempts" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_requests" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_requests" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_requests" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_snapshots" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_snapshots" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."booking_snapshots" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_booking_period_commitments" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_booking_period_commitments" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_booking_period_commitments" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_booking_period_occupancies" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_booking_period_occupancies" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_booking_period_occupancies" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_inventory_availability" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_inventory_availability" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_inventory_commitments" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_inventory_commitments" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_inventory_commitments" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_inventory_date_price_overrides" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_inventory_date_price_overrides" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_inventory_standard_prices" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_inventory_standard_prices" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_inventory_weekday_price_overrides" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_inventory_weekday_price_overrides" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_marketplace_listings" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_marketplace_listings" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_shift_schedule_revisions" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_shift_schedule_revisions" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_shifts" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_shifts" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_request_notifications" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_request_notifications" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_request_notifications" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."privileged_sign_in_attempts" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."privileged_sign_in_attempts" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payment_provider_operations" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payment_provider_operations" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payment_provider_operations" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."account_contexts" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."account_contexts" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."account_contexts" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_ownership" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_ownership" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_ownership" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_administrator_audit" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_administrator_audit" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_administrator_audit" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_localized_decisions" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_localized_decisions" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_localized_decisions" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_localized_heads" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_localized_heads" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_localized_heads" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_localized_revisions" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_localized_revisions" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_localized_revisions" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_photos" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_photos" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_photos" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_publication_decisions" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_publication_decisions" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_publication_decisions" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_review_cycles" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_review_cycles" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_review_cycles" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_review_photos" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_review_photos" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_review_photos" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_source_revisions" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_source_revisions" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_source_revisions" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_translation_attempts" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_translation_attempts" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_translation_attempts" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_translation_human_reviews" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_translation_human_reviews" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_profile_translation_human_reviews" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_publication_localizations" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_publication_localizations" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_publication_localizations" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_publication_media" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_publication_media" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_publication_media" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_publication_snapshots" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_publication_snapshots" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_publication_snapshots" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_translation_cache" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_translation_cache" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_translation_cache" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_translation_quality_reports" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_translation_quality_reports" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_translation_quality_reports" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_translation_runtime_control" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_translation_runtime_control" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_translation_runtime_control" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_translation_usage_reservations" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_translation_usage_reservations" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_translation_usage_reservations" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_translation_usage_results" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_translation_usage_results" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_translation_usage_results" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_application_cottage_profiles" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_application_cottage_profiles" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_application_cottage_profiles" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_application_information_requests" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_application_information_requests" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_application_information_requests" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_application_lifecycle_control" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_application_lifecycle_control" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_application_lifecycle_control" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_application_notices" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_application_notices" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_application_notices" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_application_renewal_work" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_application_renewal_work" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_application_renewal_work" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_application_transitions" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_application_transitions" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_application_transitions" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_application_verification_records" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_application_verification_records" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_application_verification_records" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_applications" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_applications" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_applications" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_verification_document_access_grants" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_verification_document_access_grants" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_verification_document_access_grants" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_verification_document_audit" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_verification_document_audit" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_verification_document_audit" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_verification_document_cleanup" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_verification_document_cleanup" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_verification_document_cleanup" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_verification_document_versions" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_verification_document_versions" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_verification_document_versions" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_verification_documents" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_verification_documents" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."owner_verification_documents" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_inventory_availability" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_inventory_date_price_overrides" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_inventory_standard_prices" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_inventory_weekday_price_overrides" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_marketplace_listings" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_shift_schedule_revisions" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."cottage_shifts" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."privileged_sign_in_attempts" FROM "service_role";

GRANT USAGE ON SCHEMA "public" TO "postgres";

GRANT USAGE ON SCHEMA "public" TO "anon";

GRANT USAGE ON SCHEMA "public" TO "authenticated";

GRANT USAGE ON SCHEMA "public" TO "service_role";

GRANT USAGE ON SCHEMA "public" TO "supabase_auth_admin";

GRANT SELECT ON TABLE "public"."owner_application_cottage_profiles" TO "authenticated";

REVOKE ALL ON FUNCTION "public"."abandon_administrator_cottage_profile_draft"("target_profile_id" "uuid", "target_expected_version" bigint, "requested_reason" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."abandon_administrator_cottage_profile_draft"("target_profile_id" "uuid", "target_expected_version" bigint, "requested_reason" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."abandon_owner_cottage_profile_draft"("target_profile_id" "uuid", "target_expected_version" bigint) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."abandon_owner_cottage_profile_draft"("target_profile_id" "uuid", "target_expected_version" bigint) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."activate_owner_application_lifecycle"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."activate_owner_application_lifecycle"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."append_booking_request_payment_history"("target_payment_lifecycle_id" "uuid", "target_booking_request_id" "uuid", "target_kind" "text", "target_source" "text", "target_provenance" "text", "target_operation_kind" "text", "target_logical_operation_id" "text", "target_physical_attempt_id" "text", "target_operation_generation" bigint, "target_recovery_generation" bigint, "target_from_state" "text", "target_to_state" "text", "target_outcome" "text", "target_reason_code" "text", "target_provider_operation_id" "uuid", "target_provider_request_id" "text", "target_provider_reference" "text", "target_movement_reference" "text", "target_amount_fils" bigint, "target_provider_occurred_at" timestamp with time zone, "target_received_at" timestamp with time zone, "target_source_recorded_at" timestamp with time zone) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."apply_cottage_profile_working_copy"("target_profile_id" "uuid", "requested_name" "text", "requested_governorate" "text", "requested_approximate_location" "text", "requested_exact_address" "text", "requested_exact_latitude" numeric, "requested_exact_longitude" numeric, "requested_private_directions" "text", "requested_capacity" integer, "requested_bedrooms" integer, "requested_bathrooms" integer, "requested_amenities" "text"[], "requested_source_language" "public"."cottage_profile_source_language", "requested_description" "text", "requested_house_rules" "text") FROM PUBLIC;

GRANT SELECT ON TABLE "public"."cottage_publication_snapshots" TO "service_role";

REVOKE ALL ON FUNCTION "public"."approve_cottage_profile_publication"("target_review_cycle_id" "uuid", "target_reason" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."approve_cottage_profile_publication"("target_review_cycle_id" "uuid", "target_reason" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."assert_cottage_inventory_commitment_unit"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."assert_cottage_inventory_unit"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."assign_owner_application_cottage_profile_owner"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."begin_booking_request_authorization_claim"("target_attempt_id" "uuid", "target_payment_snapshot" "jsonb", "target_provider_identity" "jsonb") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."begin_booking_request_authorization_claim"("target_attempt_id" "uuid", "target_payment_snapshot" "jsonb", "target_provider_identity" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."begin_booking_request_submission_cleanup_release"("target_attempt_id" "uuid", "target_payment_snapshot" "jsonb", "target_provider_identity" "jsonb") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."begin_booking_request_submission_cleanup_release"("target_attempt_id" "uuid", "target_payment_snapshot" "jsonb", "target_provider_identity" "jsonb") TO "service_role";

GRANT SELECT ON TABLE "public"."cottage_profile_translation_attempts" TO "service_role";

REVOKE ALL ON FUNCTION "public"."begin_cottage_profile_translation"("target_review_cycle_id" "uuid", "target_language" "public"."cottage_profile_source_language") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."begin_cottage_profile_translation_execution"("target_review_cycle_id" "uuid", "target_language" "public"."cottage_profile_source_language", "target_route" "text", "target_lease_milliseconds" integer) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."begin_cottage_profile_translation_execution"("target_review_cycle_id" "uuid", "target_language" "public"."cottage_profile_source_language", "target_route" "text", "target_lease_milliseconds" integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."block_published_cottage_photo_deletion"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."booking_request_acceptance_evidence"("target_locale" "public"."cottage_profile_source_language", "target_terms_version" "text", "requires_inside_48" boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."booking_request_active_claim_conflicts_unit"("target_schedule_revision_id" "uuid", "target_unit_kind" "public"."cottage_inventory_unit_kind", "target_unit_id" "uuid", "target_service_day" "date") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."booking_request_claim_state_after_payment"("current_state" "public"."booking_request_authorization_claim_state", "next_attempt_state" "text", "authorization_has_provider_request" boolean, "release_status" "text") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."booking_request_claim_state_allows_authorization"("target_state" "public"."booking_request_authorization_claim_state") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."booking_request_claim_state_is_active"("target_state" "public"."booking_request_authorization_claim_state") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."booking_request_claim_state_is_reconcilable"("target_state" "public"."booking_request_authorization_claim_state") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."booking_request_claim_state_is_terminal"("target_state" "public"."booking_request_authorization_claim_state") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."booking_request_content_is_safe"("target_value" "text") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."booking_request_marketplace_terms"("target_locale" "public"."cottage_profile_source_language") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."booking_request_payment_quarantined"("target_booking_request_id" "uuid") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."booking_request_payment_recovery_status"("target_request" "public"."booking_requests") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."booking_request_payment_required_expiry_completed"("target_booking_request_id" "uuid") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."booking_request_payment_required_expiry_permit"("target" "public"."booking_request_payment_required_expiry_operations", "deadline" timestamp with time zone) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."booking_request_payment_required_expiry_provider_matches"("target_work" "public"."booking_request_capture_work", "target_provider_identity" "jsonb") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."booking_request_payment_required_expiry_status"("target_request" "public"."booking_requests") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."booking_request_payment_required_window"("target_request" "public"."booking_requests") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."booking_request_payment_status"("target_request" "public"."booking_requests") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."booking_request_policy_at"("first_starts_at" timestamp with time zone, "evaluated_at" timestamp with time zone) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."booking_request_recovery_execution_permit"("target_attempt" "public"."booking_request_payment_recovery_attempts", "target_work" "public"."booking_request_capture_work", "target_payment_snapshot" "jsonb", "target_step" "text") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."booking_request_release_fingerprint"("target_provider" "text", "target_environment" "text", "target_merchant_id" "text", "target_terminal_id" "text", "target_payment_lifecycle_id" "uuid", "target_logical_operation_id" "text", "target_physical_attempt_id" "text", "target_amount_fils" bigint, "target_currency" "text") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."booking_request_submission_cleanup_fingerprint"("target_attempt_id" "uuid", "target_claim_id" "uuid", "target_claim_generation" integer, "target_state_revision" bigint, "target_provider" "text", "target_environment" "text", "target_merchant_id" "text", "target_terminal_id" "text", "target_payment_lifecycle_id" "uuid", "target_logical_operation_id" "text", "target_physical_attempt_id" "text", "target_amount_fils" bigint, "target_currency" "text") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."change_administrator_cottage_profile_draft_lifecycle"("target_profile_id" "uuid", "target_expected_version" bigint, "requested_reason" "text", "requested_status" "public"."cottage_profile_status") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."claim_booking_request_action"("target_actor_user_id" "uuid", "target_booking_request_id" "uuid", "target_action" "text", "target_decline_reason" "text", "target_decline_note" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."claim_booking_request_action"("target_actor_user_id" "uuid", "target_booking_request_id" "uuid", "target_action" "text", "target_decline_reason" "text", "target_decline_note" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."claim_booking_request_expiry"("target_booking_request_id" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."claim_booking_request_expiry"("target_booking_request_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."claim_customer_booking_request_payment_recovery"("target_booking_request_id" "uuid", "target_command_key" "uuid", "target_replacement_method" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."claim_customer_booking_request_payment_recovery"("target_booking_request_id" "uuid", "target_command_key" "uuid", "target_replacement_method" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."claim_due_booking_request_captures"("target_limit" integer, "target_provider_identity" "jsonb") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."claim_due_booking_request_captures"("target_limit" integer, "target_provider_identity" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."claim_due_booking_request_payment_required_expiries"("target_limit" integer, "target_provider_identity" "jsonb") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."claim_due_booking_request_payment_required_expiries"("target_limit" integer, "target_provider_identity" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."claim_due_booking_request_releases"("target_limit" integer) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."claim_due_booking_request_releases"("target_limit" integer) TO "service_role";

GRANT SELECT ON TABLE "public"."account_contexts" TO "authenticated";

REVOKE ALL ON FUNCTION "public"."claim_marketplace_role"("requested_role" "public"."account_role") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."claim_marketplace_role"("requested_role" "public"."account_role") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."classify_booking_request_authorization_claim_persistence"("target_attempt_id" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."classify_booking_request_authorization_claim_persistence"("target_attempt_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."complete_booking_request_authorization_reconciliation"("target_claim_id" "uuid", "target_generation" integer, "target_state_revision" bigint, "target_lease_token" "uuid", "target_payment_snapshot" "jsonb", "target_provider_identity" "jsonb") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."complete_booking_request_authorization_reconciliation"("target_claim_id" "uuid", "target_generation" integer, "target_state_revision" bigint, "target_lease_token" "uuid", "target_payment_snapshot" "jsonb", "target_provider_identity" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."complete_booking_request_capture"("target_booking_request_id" "uuid", "target_lease_generation" bigint, "target_lease_token" "uuid", "target_provider_result" "jsonb") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."complete_booking_request_capture"("target_booking_request_id" "uuid", "target_lease_generation" bigint, "target_lease_token" "uuid", "target_provider_result" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."complete_cottage_profile_photo_deletion"("target_photo_id" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."complete_cottage_profile_photo_deletion"("target_photo_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."complete_cottage_profile_translation"("target_attempt_id" "uuid", "translated_description" "text", "translated_house_rules" "text", "returned_provider" "text", "returned_model" "text", "returned_effort" "text", "returned_prompt_version" "text") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."complete_cottage_profile_translation_execution"("target_attempt_id" "uuid", "target_lease_token" "uuid", "translated_description" "text", "translated_house_rules" "text", "returned_provider" "text", "returned_model" "text", "returned_effort" "text", "returned_prompt_version" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."complete_cottage_profile_translation_execution"("target_attempt_id" "uuid", "target_lease_token" "uuid", "translated_description" "text", "translated_house_rules" "text", "returned_provider" "text", "returned_model" "text", "returned_effort" "text", "returned_prompt_version" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."complete_owner_verification_document_access"("target_access_grant_id" "uuid", "requested_expires_in_seconds" integer) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."complete_owner_verification_document_access"("target_access_grant_id" "uuid", "requested_expires_in_seconds" integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."complete_owner_verification_document_cleanup"("target_cleanup_id" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."complete_owner_verification_document_cleanup"("target_cleanup_id" "uuid") TO "service_role";

GRANT SELECT("id") ON TABLE "public"."cottage_profile_localized_revisions" TO "authenticated";

GRANT SELECT("review_cycle_id") ON TABLE "public"."cottage_profile_localized_revisions" TO "authenticated";

GRANT SELECT("locale") ON TABLE "public"."cottage_profile_localized_revisions" TO "authenticated";

GRANT SELECT("revision") ON TABLE "public"."cottage_profile_localized_revisions" TO "authenticated";

GRANT SELECT("origin") ON TABLE "public"."cottage_profile_localized_revisions" TO "authenticated";

GRANT SELECT("description") ON TABLE "public"."cottage_profile_localized_revisions" TO "authenticated";

GRANT SELECT("house_rules") ON TABLE "public"."cottage_profile_localized_revisions" TO "authenticated";

GRANT SELECT("provider") ON TABLE "public"."cottage_profile_localized_revisions" TO "authenticated";

GRANT SELECT("model") ON TABLE "public"."cottage_profile_localized_revisions" TO "authenticated";

GRANT SELECT("effort") ON TABLE "public"."cottage_profile_localized_revisions" TO "authenticated";

GRANT SELECT("prompt_version") ON TABLE "public"."cottage_profile_localized_revisions" TO "authenticated";

GRANT SELECT("correction_reason") ON TABLE "public"."cottage_profile_localized_revisions" TO "authenticated";

GRANT SELECT("created_at") ON TABLE "public"."cottage_profile_localized_revisions" TO "authenticated";

REVOKE ALL ON FUNCTION "public"."correct_cottage_profile_localization"("target_review_cycle_id" "uuid", "target_locale" "public"."cottage_profile_source_language", "corrected_description" "text", "corrected_house_rules" "text", "target_reason" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."correct_cottage_profile_localization"("target_review_cycle_id" "uuid", "target_locale" "public"."cottage_profile_source_language", "corrected_description" "text", "corrected_house_rules" "text", "target_reason" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."cottage_inventory_commitment_end_at"("target_schedule_revision_id" "uuid", "target_unit_kind" "public"."cottage_inventory_unit_kind", "target_unit_id" "uuid", "target_service_day" "date") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."cottage_inventory_component_available_without_auth_claim"("target_schedule_revision_id" "uuid", "target_shift_id" "uuid", "target_service_day" "date") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."cottage_inventory_component_is_effectively_available"("target_schedule_revision_id" "uuid", "target_shift_id" "uuid", "target_service_day" "date") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."cottage_profile_photo_bucket_name"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."cottage_profile_photo_bucket_name"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."cottage_profile_photo_bucket_name"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."cottage_profile_ready_photo_count"("target_profile_id" "uuid") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."cottage_profile_required_data_is_complete"("target_profile_id" "uuid") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."create_cottage_profile_review_cycle"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."create_owner_cottage_profile_draft"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."create_owner_cottage_profile_draft"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."create_pending_booking_period_hold"("target_customer_user_id" "uuid", "target_profile_id" "uuid", "target_commitment_reference" "text", "requested_search" "jsonb") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."create_pending_booking_period_hold"("target_customer_user_id" "uuid", "target_profile_id" "uuid", "target_commitment_reference" "text", "requested_search" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."create_pending_booking_period_hold_without_authorization_claim"("target_customer_user_id" "uuid", "target_profile_id" "uuid", "target_commitment_reference" "text", "requested_search" "jsonb") FROM PUBLIC;

GRANT SELECT("id") ON TABLE "public"."cottage_profile_localized_decisions" TO "authenticated";

GRANT SELECT("review_cycle_id") ON TABLE "public"."cottage_profile_localized_decisions" TO "authenticated";

GRANT SELECT("locale") ON TABLE "public"."cottage_profile_localized_decisions" TO "authenticated";

GRANT SELECT("localized_revision_id") ON TABLE "public"."cottage_profile_localized_decisions" TO "authenticated";

GRANT SELECT("approved") ON TABLE "public"."cottage_profile_localized_decisions" TO "authenticated";

GRANT SELECT("reason") ON TABLE "public"."cottage_profile_localized_decisions" TO "authenticated";

GRANT SELECT("decided_at") ON TABLE "public"."cottage_profile_localized_decisions" TO "authenticated";

REVOKE ALL ON FUNCTION "public"."decide_cottage_profile_localization"("target_review_cycle_id" "uuid", "target_locale" "public"."cottage_profile_source_language", "target_approved" boolean, "target_reason" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."decide_cottage_profile_localization"("target_review_cycle_id" "uuid", "target_locale" "public"."cottage_profile_source_language", "target_approved" boolean, "target_reason" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."dequeue_booking_request_authorization_reconciliation"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."dequeue_booking_request_authorization_reconciliation"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."due_booking_request_payment_recoveries"("target_limit" integer) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."due_booking_request_payment_recoveries"("target_limit" integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."enforce_booking_request_capture_work"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."enforce_booking_request_payment_required"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."enforce_cottage_booking_period_commitment_transition"() FROM PUBLIC;











REVOKE ALL ON FUNCTION "public"."expire_booking_request_authorization_claims"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."expire_booking_request_authorization_claims"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."fail_cottage_profile_translation"("target_attempt_id" "uuid", "target_failure_code" "text") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."fail_cottage_profile_translation_execution"("target_attempt_id" "uuid", "target_lease_token" "uuid", "target_failure_code" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."fail_cottage_profile_translation_execution"("target_attempt_id" "uuid", "target_lease_token" "uuid", "target_failure_code" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."finalize_booking_request_confirmation"("target_booking_request_id" "uuid", "target_capture_snapshot" "jsonb") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."finalize_booking_request_confirmation"("target_booking_request_id" "uuid", "target_capture_snapshot" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."finalize_booking_request_payment_required_expiry"("target_booking_request_id" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."finalize_booking_request_payment_required_expiry"("target_booking_request_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."finalize_booking_request_release"("target_work_id" "uuid", "target_lease_generation" bigint, "target_lease_token" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."finalize_booking_request_release"("target_work_id" "uuid", "target_lease_generation" bigint, "target_lease_token" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."finalize_booking_request_submission"("target_attempt_id" "uuid", "target_payment_snapshot" "jsonb") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."finalize_booking_request_submission"("target_attempt_id" "uuid", "target_payment_snapshot" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_administrator_booking_request_payment_history"("target_reference" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."get_administrator_booking_request_payment_history"("target_reference" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_booking_request_payment_recovery_confirmation_evidence"("target_attempt_id" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."get_booking_request_payment_recovery_confirmation_evidence"("target_attempt_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_confirmed_booking_access"("target_reference" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."get_confirmed_booking_access"("target_reference" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_cottage_translation_administration"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."get_cottage_translation_administration"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_current_cottage_publication"("target_profile_id" "uuid", "target_locale" "public"."cottage_profile_source_language") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."get_current_cottage_publication"("target_profile_id" "uuid", "target_locale" "public"."cottage_profile_source_language") TO "anon";

GRANT ALL ON FUNCTION "public"."get_current_cottage_publication"("target_profile_id" "uuid", "target_locale" "public"."cottage_profile_source_language") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_customer_booking_request"("target_reference" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."get_customer_booking_request"("target_reference" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_default_public_cottage_search"("target_slug" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."get_default_public_cottage_search"("target_slug" "text") TO "anon";

GRANT ALL ON FUNCTION "public"."get_default_public_cottage_search"("target_slug" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_public_booking_quote"("target_locale" "public"."cottage_profile_source_language", "target_slug" "text", "requested_search" "jsonb") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."get_public_booking_quote"("target_locale" "public"."cottage_profile_source_language", "target_slug" "text", "requested_search" "jsonb") TO "anon";

GRANT ALL ON FUNCTION "public"."get_public_booking_quote"("target_locale" "public"."cottage_profile_source_language", "target_slug" "text", "requested_search" "jsonb") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_public_booking_quote_with_fingerprint"("target_locale" "public"."cottage_profile_source_language", "target_slug" "text", "requested_search" "jsonb") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."get_public_booking_quote_with_fingerprint"("target_locale" "public"."cottage_profile_source_language", "target_slug" "text", "requested_search" "jsonb") TO "anon";

GRANT ALL ON FUNCTION "public"."get_public_booking_quote_with_fingerprint"("target_locale" "public"."cottage_profile_source_language", "target_slug" "text", "requested_search" "jsonb") TO "authenticated";

GRANT ALL ON FUNCTION "public"."get_public_booking_quote_with_fingerprint"("target_locale" "public"."cottage_profile_source_language", "target_slug" "text", "requested_search" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_public_cottage_facets"("target_locale" "public"."cottage_profile_source_language") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."get_public_cottage_facets"("target_locale" "public"."cottage_profile_source_language") TO "anon";

GRANT ALL ON FUNCTION "public"."get_public_cottage_facets"("target_locale" "public"."cottage_profile_source_language") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."get_public_cottage_profile"("target_locale" "public"."cottage_profile_source_language", "target_slug" "text", "requested_search" "jsonb") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."get_public_cottage_profile"("target_locale" "public"."cottage_profile_source_language", "target_slug" "text", "requested_search" "jsonb") TO "anon";

GRANT ALL ON FUNCTION "public"."get_public_cottage_profile"("target_locale" "public"."cottage_profile_source_language", "target_slug" "text", "requested_search" "jsonb") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."install_owner_application_expiry_cron"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."install_owner_application_expiry_cron"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."invalidate_booking_request_payment_confirmation"("target_booking_request_id" "uuid", "target_provider_operation_id" "uuid", "target_reason" "text") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."is_cottage_publicly_discoverable"("target_profile_id" "uuid") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."is_current_prospective_owner"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."is_current_prospective_owner"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."is_platform_administrator"("required_assurance" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."is_platform_administrator"("required_assurance" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."lease_booking_request_capture_work"("target_booking_request_id" "uuid", "target_provider_identity" "jsonb") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."lease_booking_request_capture_work"("target_booking_request_id" "uuid", "target_provider_identity" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."lease_booking_request_payment_recovery_step"("target_attempt_id" "uuid", "target_step" "text", "target_expected_state" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."lease_booking_request_payment_recovery_step"("target_attempt_id" "uuid", "target_step" "text", "target_expected_state" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."lease_booking_request_release_work"("target_work_id" "uuid") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."list_due_booking_request_capture_intents"("target_limit" integer, "target_provider_identity" "jsonb") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."list_due_booking_request_capture_intents"("target_limit" integer, "target_provider_identity" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."list_owner_booking_request_notifications"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."list_owner_booking_request_notifications"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."list_owner_cottage_profiles"("target_after_updated_at" timestamp with time zone, "target_after_id" "uuid", "target_limit" integer) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."list_owner_cottage_profiles"("target_after_updated_at" timestamp with time zone, "target_after_id" "uuid", "target_limit" integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."load_cottage_inventory_owner_editor_state"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."load_cottage_inventory_owner_editor_state"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."lock_booking_request_capture_source"("target_booking_request_id" "uuid") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."lock_booking_request_payment_recovery_source"("target_attempt_id" "uuid") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."lock_booking_request_payment_required_expiry_source"("target_booking_request_id" "uuid") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."lock_cottage_inventory_profiles"("target_profile_ids" "uuid"[]) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."lookup_booking_request_submission"("target_attempt_id" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."lookup_booking_request_submission"("target_attempt_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."mark_booking_request_reconciliation_required"("target_attempt_id" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."mark_booking_request_reconciliation_required"("target_attempt_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."observe_booking_request_payment_correction"("target_booking_request_id" "uuid", "target_provider_operation_id" "uuid", "target_receipt" "jsonb", "target_command" "jsonb") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."observe_booking_request_payment_correction"("target_booking_request_id" "uuid", "target_provider_operation_id" "uuid", "target_receipt" "jsonb", "target_command" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."observe_booking_request_payment_history"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."owner_application_active_information_request"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."owner_application_active_information_request"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."owner_application_missing_items"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."owner_application_missing_items"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."owner_application_parse_expiry_date"("value" "text") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."owner_can_start_new_business"("target_owner_user_id" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."owner_can_start_new_business"("target_owner_user_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."owner_verification_bucket_name"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."owner_verification_bucket_name"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."owner_verification_kind_is_required"("applicant_kind" "public"."owner_applicant_kind", "licensing_basis" "public"."owner_licensing_basis", "document_kind" "public"."owner_verification_document_kind") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."prepare_booking_request_corrective_refund"("target_booking_request_id" "uuid", "target_capture_id" "uuid") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."prepare_booking_request_payment_required_expiry"("target_booking_request_id" "uuid", "target_provider_identity" "jsonb", "target_command" "jsonb") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."prepare_booking_request_payment_required_expiry"("target_booking_request_id" "uuid", "target_provider_identity" "jsonb", "target_command" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."prepare_booking_request_submission"("target_customer_user_id" "uuid", "target_idempotency_key" "uuid", "target_submission" "jsonb") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."prepare_booking_request_submission"("target_customer_user_id" "uuid", "target_idempotency_key" "uuid", "target_submission" "jsonb") TO "service_role";

GRANT SELECT ON TABLE "public"."cottage_profile_photos" TO "authenticated";

GRANT SELECT ON TABLE "public"."cottage_profile_photos" TO "service_role";

REVOKE ALL ON FUNCTION "public"."prepare_cottage_profile_photo_deletion"("target_photo_id" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."prepare_cottage_profile_photo_deletion"("target_photo_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."prepare_cottage_profile_photo_preview"("target_photo_id" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."prepare_cottage_profile_photo_preview"("target_photo_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."prepare_cottage_profile_photo_upload"("target_profile_id" "uuid", "requested_original_filename" "text", "requested_media_type" "text", "requested_size_bytes" integer) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."prepare_cottage_profile_photo_upload"("target_profile_id" "uuid", "requested_original_filename" "text", "requested_media_type" "text", "requested_size_bytes" integer) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."prepare_owner_verification_document_access"("target_document_id" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."prepare_owner_verification_document_access"("target_document_id" "uuid") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."prepare_owner_verification_document_upload"("requested_owner_user_id" "uuid", "requested_application_id" "uuid", "requested_kind" "public"."owner_verification_document_kind", "requested_object_path" "text", "requested_original_filename" "text", "requested_media_type" "text", "requested_size_bytes" integer) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."prepare_owner_verification_document_upload"("requested_owner_user_id" "uuid", "requested_application_id" "uuid", "requested_kind" "public"."owner_verification_document_kind", "requested_object_path" "text", "requested_original_filename" "text", "requested_media_type" "text", "requested_size_bytes" integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."prepare_owner_verification_document_upload_v2"("requested_owner_user_id" "uuid", "requested_application_id" "uuid", "requested_kind" "public"."owner_verification_document_kind", "requested_object_path" "text", "requested_original_filename" "text", "requested_media_type" "text", "requested_size_bytes" integer, "requested_content_digest" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."prepare_owner_verification_document_upload_v2"("requested_owner_user_id" "uuid", "requested_application_id" "uuid", "requested_kind" "public"."owner_verification_document_kind", "requested_object_path" "text", "requested_original_filename" "text", "requested_media_type" "text", "requested_size_bytes" integer, "requested_content_digest" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."preserve_committed_cottage_shift_schedule_pointer"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."process_expired_owner_applications"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."process_expired_owner_applications"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."project_booking_request_release_work"("target_work" "public"."booking_request_release_work") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."project_existing_booking_request_submission_attempt"("target_attempt" "public"."booking_request_submission_attempts", "expected_intent_fingerprint" "text", "expected_intent_payload" "jsonb", "null_snapshot_is_ready" boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."protect_abandoned_cottage_profile"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."protect_cottage_profile_source_during_review"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."protect_cottage_translation_human_review"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."provision_platform_administrator"("target_user_id" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."provision_platform_administrator"("target_user_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."public_cottage_effective_price"("target_schedule_revision_id" "uuid", "target_unit_kind" "public"."cottage_inventory_unit_kind", "target_unit_id" "uuid", "target_service_day" "date") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."public_cottage_unit_is_available"("target_schedule_revision_id" "uuid", "target_unit_kind" "public"."cottage_inventory_unit_kind", "target_unit_id" "uuid", "target_service_day" "date") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."public_cottage_unit_is_available_without_authorization_claim"("target_schedule_revision_id" "uuid", "target_unit_kind" "public"."cottage_inventory_unit_kind", "target_unit_id" "uuid", "target_service_day" "date") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."quarantine_booking_request_payment"("target_booking_request_id" "uuid", "target_reason" "text") FROM PUBLIC;









REVOKE ALL ON FUNCTION "public"."reconcile_owner_verification_document_registration"("target_cleanup_id" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."reconcile_owner_verification_document_registration"("target_cleanup_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."record_booking_request_capture_failure"("target_booking_request_id" "uuid", "target_lease_generation" bigint, "target_lease_token" "uuid", "target_provider_result" "jsonb") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."record_booking_request_capture_failure"("target_booking_request_id" "uuid", "target_lease_generation" bigint, "target_lease_token" "uuid", "target_provider_result" "jsonb") TO "service_role";


REVOKE ALL ON FUNCTION "public"."record_cottage_translation_usage"("target_reservation_id" "uuid", "actual_input_tokens" bigint, "actual_output_tokens" bigint, "actual_total_tokens" bigint, "actual_microusd" bigint) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."record_cottage_translation_usage"("target_reservation_id" "uuid", "actual_input_tokens" bigint, "actual_output_tokens" bigint, "actual_total_tokens" bigint, "actual_microusd" bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."record_owner_verification_document_version"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."record_privileged_sign_in_attempt"("attempted_email" "text", "attempted_email_digest" "text", "attempt_stage" "text", "attempt_outcome" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."record_privileged_sign_in_attempt"("attempted_email" "text", "attempted_email_digest" "text", "attempt_stage" "text", "attempt_outcome" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."register_cottage_marketplace_listing"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."register_cottage_profile_photo"("target_photo_id" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."register_cottage_profile_photo"("target_photo_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."register_owner_verification_document"("target_cleanup_id" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."register_owner_verification_document"("target_cleanup_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."register_owner_verification_document_v2"("target_cleanup_id" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."register_owner_verification_document_v2"("target_cleanup_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."reject_abandoned_cottage_profile_child_mutation"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."reject_active_cottage_translation_human_review"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."reject_authorization_claim_inventory_mutation"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."reject_authorization_claim_profile_or_shift_mutation"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."reject_booking_confirmation_change"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."reject_booking_period_overlap_with_authorization_claim"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."reject_booking_request_payment_history_change"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."reject_booking_request_payment_recovery_history_change"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."reject_booking_request_payment_required_expiry_change"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."reject_booking_snapshot_change"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."reject_cottage_booking_period_occupancy_update"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."reject_cottage_inventory_commitment_snapshot_update"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."reject_cottage_profile_publication"("target_review_cycle_id" "uuid", "target_reason" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."reject_cottage_profile_publication"("target_review_cycle_id" "uuid", "target_reason" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."reject_cottage_profile_source_mutation"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."reject_cottage_publication_history_mutation"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."reject_cottage_shift_schedule_mutation"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."reject_owner_application_history_mutation"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."replace_cottage_shift_schedule"("target_profile_id" "uuid", "target_expected_revision" integer, "requested_shifts" "jsonb") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."replace_cottage_shift_schedule"("target_profile_id" "uuid", "target_expected_revision" integer, "requested_shifts" "jsonb") TO "authenticated";

GRANT SELECT ON TABLE "public"."cottage_translation_quality_reports" TO "service_role";

GRANT SELECT("id") ON TABLE "public"."cottage_translation_quality_reports" TO "authenticated";

GRANT SELECT("review_cycle_id") ON TABLE "public"."cottage_translation_quality_reports" TO "authenticated";

GRANT SELECT("remediation_review_cycle_id") ON TABLE "public"."cottage_translation_quality_reports" TO "authenticated";

GRANT SELECT("localized_revision_id") ON TABLE "public"."cottage_translation_quality_reports" TO "authenticated";

GRANT SELECT("locale") ON TABLE "public"."cottage_translation_quality_reports" TO "authenticated";

GRANT SELECT("reason") ON TABLE "public"."cottage_translation_quality_reports" TO "authenticated";

GRANT SELECT("reported_at") ON TABLE "public"."cottage_translation_quality_reports" TO "authenticated";

REVOKE ALL ON FUNCTION "public"."report_current_cottage_translation"("target_review_cycle_id" "uuid", "target_localized_revision_id" "uuid", "target_reason" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."report_current_cottage_translation"("target_review_cycle_id" "uuid", "target_localized_revision_id" "uuid", "target_reason" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."require_complete_cottage_shift_schedule"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."require_current_shift_schedule_for_publication"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."reserve_cottage_translation_usage"("target_cache_key" "text", "target_model" "text", "target_effort" "text", "target_prompt_version" "text", "target_reserved_tokens" bigint, "target_reserved_microusd" bigint, "expected_production_approval_digest" "text", "application_monthly_request_limit" bigint, "application_monthly_token_limit" bigint, "application_monthly_spend_microusd_limit" bigint) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."reserve_cottage_translation_usage"("target_cache_key" "text", "target_model" "text", "target_effort" "text", "target_prompt_version" "text", "target_reserved_tokens" bigint, "target_reserved_microusd" bigint, "expected_production_approval_digest" "text", "application_monthly_request_limit" bigint, "application_monthly_token_limit" bigint, "application_monthly_spend_microusd_limit" bigint) TO "service_role";

REVOKE ALL ON FUNCTION "public"."resolve_cottage_inventory"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."resolve_cottage_inventory"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date") TO "service_role";

REVOKE ALL ON FUNCTION "public"."resolve_cottage_inventory_owner_calendar"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."resolve_cottage_inventory_owner_calendar"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date") TO "authenticated";

GRANT ALL ON FUNCTION "public"."resolve_cottage_inventory_owner_calendar"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date") TO "service_role";

REVOKE ALL ON FUNCTION "public"."resolve_cottage_inventory_public_availability"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."resolve_cottage_inventory_public_availability"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date") TO "anon";

GRANT ALL ON FUNCTION "public"."resolve_cottage_inventory_public_availability"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date") TO "authenticated";

GRANT ALL ON FUNCTION "public"."resolve_cottage_inventory_public_availability"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date") TO "service_role";

REVOKE ALL ON FUNCTION "public"."resolve_cottage_translation_human_review"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."resolve_current_cottage_publication_media"("target_opaque_id" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."resolve_current_cottage_publication_media"("target_opaque_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."resolve_owner_calendar_without_auth_claim"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."resolve_public_cottage_selection"("target_schedule_revision_id" "uuid", "requested_search" "jsonb") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."respond_to_owner_application_request"("expected_version" bigint, "requested_field_values" "jsonb", "confirmed_document_kinds" "public"."owner_verification_document_kind"[]) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."respond_to_owner_application_request"("expected_version" bigint, "requested_field_values" "jsonb", "confirmed_document_kinds" "public"."owner_verification_document_kind"[]) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."restore_administrator_cottage_profile_draft"("target_profile_id" "uuid", "target_expected_version" bigint, "requested_reason" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."restore_administrator_cottage_profile_draft"("target_profile_id" "uuid", "target_expected_version" bigint, "requested_reason" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."review_owner_application"("target_application_id" "uuid", "expected_version" bigint, "requested_action" "text", "requested_reason" "text", "requested_fields" "text"[], "requested_document_kinds" "public"."owner_verification_document_kind"[], "requested_jurisdiction" "text", "requested_licensing_basis" "public"."owner_licensing_basis", "requested_licence_or_exemption_basis" "text", "requested_expiry_dates" "jsonb") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."review_owner_application"("target_application_id" "uuid", "expected_version" bigint, "requested_action" "text", "requested_reason" "text", "requested_fields" "text"[], "requested_document_kinds" "public"."owner_verification_document_kind"[], "requested_jurisdiction" "text", "requested_licensing_basis" "public"."owner_licensing_basis", "requested_licence_or_exemption_basis" "text", "requested_expiry_dates" "jsonb") TO "authenticated";

GRANT SELECT ON TABLE "public"."cottage_profile_translation_human_reviews" TO "service_role";

GRANT SELECT("id") ON TABLE "public"."cottage_profile_translation_human_reviews" TO "authenticated";

GRANT SELECT("review_cycle_id") ON TABLE "public"."cottage_profile_translation_human_reviews" TO "authenticated";

GRANT SELECT("locale") ON TABLE "public"."cottage_profile_translation_human_reviews" TO "authenticated";

GRANT SELECT("generated_revision_id") ON TABLE "public"."cottage_profile_translation_human_reviews" TO "authenticated";

GRANT SELECT("state") ON TABLE "public"."cottage_profile_translation_human_reviews" TO "authenticated";

GRANT SELECT("created_at") ON TABLE "public"."cottage_profile_translation_human_reviews" TO "authenticated";

GRANT SELECT("resolved_at") ON TABLE "public"."cottage_profile_translation_human_reviews" TO "authenticated";

REVOKE ALL ON FUNCTION "public"."route_current_cottage_translation_to_human_review"("target_review_cycle_id" "uuid", "target_locale" "public"."cottage_profile_source_language", "target_reason" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."route_current_cottage_translation_to_human_review"("target_review_cycle_id" "uuid", "target_locale" "public"."cottage_profile_source_language", "target_reason" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."save_booking_request_payment_snapshot"("target_attempt_id" "uuid", "target_payment_snapshot" "jsonb", "target_provider_identity" "jsonb") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."save_booking_request_payment_snapshot"("target_attempt_id" "uuid", "target_payment_snapshot" "jsonb", "target_provider_identity" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."save_booking_request_release_snapshot"("target_work_id" "uuid", "target_lease_generation" bigint, "target_lease_token" "uuid", "target_payment_snapshot" "jsonb", "target_provider_identity" "jsonb") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."save_booking_request_release_snapshot"("target_work_id" "uuid", "target_lease_generation" bigint, "target_lease_token" "uuid", "target_payment_snapshot" "jsonb", "target_provider_identity" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."save_cottage_inventory_pricing"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "requested_prices" "jsonb") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."save_cottage_inventory_pricing"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "requested_prices" "jsonb") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."save_cottage_inventory_pricing_active_profile"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "requested_prices" "jsonb") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."save_cottage_inventory_pricing_unchecked_dates"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "requested_prices" "jsonb") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."save_owner_application"("requested_applicant_kind" "public"."owner_applicant_kind", "requested_legal_name" "text", "requested_company_name" "text", "requested_licensing_basis" "public"."owner_licensing_basis", "requested_exemption_basis" "text", "requested_cottage_name" "text", "requested_governorate" "text", "requested_approximate_location" "text", "requested_exact_address" "text", "requested_capacity" integer, "requested_bedrooms" integer, "requested_bathrooms" integer, "requested_amenities" "text"[], "requested_description" "text", "requested_house_rules" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."save_owner_application"("requested_applicant_kind" "public"."owner_applicant_kind", "requested_legal_name" "text", "requested_company_name" "text", "requested_licensing_basis" "public"."owner_licensing_basis", "requested_exemption_basis" "text", "requested_cottage_name" "text", "requested_governorate" "text", "requested_approximate_location" "text", "requested_exact_address" "text", "requested_capacity" integer, "requested_bedrooms" integer, "requested_bathrooms" integer, "requested_amenities" "text"[], "requested_description" "text", "requested_house_rules" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."save_owner_application_draft_implementation"("requested_applicant_kind" "public"."owner_applicant_kind", "requested_legal_name" "text", "requested_company_name" "text", "requested_licensing_basis" "public"."owner_licensing_basis", "requested_exemption_basis" "text", "requested_cottage_name" "text", "requested_governorate" "text", "requested_approximate_location" "text", "requested_exact_address" "text", "requested_capacity" integer, "requested_bedrooms" integer, "requested_bathrooms" integer, "requested_amenities" "text"[], "requested_description" "text", "requested_house_rules" "text") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."search_public_cottages"("target_locale" "public"."cottage_profile_source_language", "requested_search" "jsonb") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."search_public_cottages"("target_locale" "public"."cottage_profile_source_language", "requested_search" "jsonb") TO "anon";

GRANT ALL ON FUNCTION "public"."search_public_cottages"("target_locale" "public"."cottage_profile_source_language", "requested_search" "jsonb") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."send_test_sms"("event" "jsonb") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."send_test_sms"("event" "jsonb") TO "supabase_auth_admin";

REVOKE ALL ON FUNCTION "public"."set_cottage_inventory_availability"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date", "requested_states" "jsonb") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."set_cottage_inventory_availability"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date", "requested_states" "jsonb") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."set_cottage_inventory_availability_active_profile"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date", "requested_states" "jsonb") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."set_cottage_inventory_availability_changed_units"("target_profile_id" "uuid", "target_schedule_revision_id" "uuid", "target_service_day" "date", "requested_states" "jsonb") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."submit_cottage_profile_for_content_approval"("target_profile_id" "uuid", "target_expected_version" bigint) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."submit_cottage_profile_for_content_approval"("target_profile_id" "uuid", "target_expected_version" bigint) TO "authenticated";

GRANT SELECT ON TABLE "public"."owner_applications" TO "authenticated";

REVOKE ALL ON FUNCTION "public"."submit_owner_application"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."submit_owner_application"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."submit_owner_application_renewal"("expected_version" bigint, "confirmed_document_kinds" "public"."owner_verification_document_kind"[]) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."submit_owner_application_renewal"("expected_version" bigint, "confirmed_document_kinds" "public"."owner_verification_document_kind"[]) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."supersede_human_review_after_publication_rejection"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."update_administrator_cottage_profile"("target_profile_id" "uuid", "target_expected_version" bigint, "requested_name" "text", "requested_governorate" "text", "requested_approximate_location" "text", "requested_exact_address" "text", "requested_exact_latitude" numeric, "requested_exact_longitude" numeric, "requested_private_directions" "text", "requested_capacity" integer, "requested_bedrooms" integer, "requested_bathrooms" integer, "requested_amenities" "text"[], "requested_source_language" "public"."cottage_profile_source_language", "requested_description" "text", "requested_house_rules" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."update_administrator_cottage_profile"("target_profile_id" "uuid", "target_expected_version" bigint, "requested_name" "text", "requested_governorate" "text", "requested_approximate_location" "text", "requested_exact_address" "text", "requested_exact_latitude" numeric, "requested_exact_longitude" numeric, "requested_private_directions" "text", "requested_capacity" integer, "requested_bedrooms" integer, "requested_bathrooms" integer, "requested_amenities" "text"[], "requested_source_language" "public"."cottage_profile_source_language", "requested_description" "text", "requested_house_rules" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."update_owner_cottage_profile_draft"("target_profile_id" "uuid", "target_expected_version" bigint, "requested_name" "text", "requested_governorate" "text", "requested_approximate_location" "text", "requested_exact_address" "text", "requested_exact_latitude" numeric, "requested_exact_longitude" numeric, "requested_private_directions" "text", "requested_capacity" integer, "requested_bedrooms" integer, "requested_bathrooms" integer, "requested_amenities" "text"[], "requested_source_language" "public"."cottage_profile_source_language", "requested_description" "text", "requested_house_rules" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."update_owner_cottage_profile_draft"("target_profile_id" "uuid", "target_expected_version" bigint, "requested_name" "text", "requested_governorate" "text", "requested_approximate_location" "text", "requested_exact_address" "text", "requested_exact_latitude" numeric, "requested_exact_longitude" numeric, "requested_private_directions" "text", "requested_capacity" integer, "requested_bedrooms" integer, "requested_bathrooms" integer, "requested_amenities" "text"[], "requested_source_language" "public"."cottage_profile_source_language", "requested_description" "text", "requested_house_rules" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."validate_booking_request_payment_recovery_confirmation"("target_booking_request_id" "uuid", "target_evidence" "jsonb") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."validate_booking_request_payment_required_expiry_target"("target" "public"."booking_request_payment_required_expiry_operations", "work" "public"."booking_request_capture_work", "payment_snapshot" "jsonb") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."validate_booking_request_recovery_operation"("target_operation" "public"."booking_request_payment_recovery_operations", "target_permit" "jsonb") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."validate_cottage_shift_insert"() FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."validate_public_cottage_search"("requested_search" "jsonb") FROM PUBLIC;

GRANT SELECT ON TABLE "public"."cottage_ownership" TO "authenticated";

GRANT SELECT ON TABLE "public"."cottage_profile_administrator_audit" TO "authenticated";

GRANT SELECT ON TABLE "public"."cottage_profile_localized_heads" TO "authenticated";

GRANT SELECT("id") ON TABLE "public"."cottage_profile_publication_decisions" TO "authenticated";

GRANT SELECT("review_cycle_id") ON TABLE "public"."cottage_profile_publication_decisions" TO "authenticated";

GRANT SELECT("approved") ON TABLE "public"."cottage_profile_publication_decisions" TO "authenticated";

GRANT SELECT("reason") ON TABLE "public"."cottage_profile_publication_decisions" TO "authenticated";

GRANT SELECT("decided_at") ON TABLE "public"."cottage_profile_publication_decisions" TO "authenticated";

GRANT SELECT ON TABLE "public"."cottage_profile_review_cycles" TO "authenticated";

GRANT SELECT ON TABLE "public"."cottage_profile_review_cycles" TO "service_role";

GRANT SELECT ON TABLE "public"."cottage_profile_review_photos" TO "authenticated";

GRANT SELECT ON TABLE "public"."cottage_profile_source_revisions" TO "authenticated";

GRANT SELECT ON TABLE "public"."cottage_profile_source_revisions" TO "service_role";

GRANT SELECT ON TABLE "public"."cottage_publication_localizations" TO "service_role";

GRANT SELECT ON TABLE "public"."cottage_publication_media" TO "service_role";

GRANT SELECT ON TABLE "public"."cottage_shift_schedule_revisions" TO "authenticated";

GRANT SELECT ON TABLE "public"."cottage_shifts" TO "authenticated";

GRANT SELECT,INSERT ON TABLE "public"."cottage_translation_cache" TO "service_role";

GRANT SELECT,UPDATE ON TABLE "public"."cottage_translation_runtime_control" TO "service_role";

GRANT SELECT ON TABLE "public"."cottage_translation_usage_reservations" TO "service_role";

GRANT SELECT ON TABLE "public"."cottage_translation_usage_results" TO "service_role";

GRANT SELECT ON TABLE "public"."owner_application_information_requests" TO "authenticated";

GRANT SELECT ON TABLE "public"."owner_application_lifecycle_control" TO "service_role";

GRANT SELECT ON TABLE "public"."owner_application_notices" TO "authenticated";

GRANT SELECT ON TABLE "public"."owner_application_renewal_work" TO "authenticated";

GRANT SELECT ON TABLE "public"."owner_application_transitions" TO "authenticated";

GRANT SELECT ON TABLE "public"."owner_application_verification_records" TO "authenticated";

GRANT SELECT ON TABLE "public"."owner_verification_document_access_grants" TO "service_role";

GRANT SELECT ON TABLE "public"."owner_verification_document_audit" TO "authenticated";

GRANT SELECT ON TABLE "public"."owner_verification_document_audit" TO "service_role";

GRANT SELECT ON TABLE "public"."owner_verification_document_cleanup" TO "service_role";

GRANT SELECT ON TABLE "public"."owner_verification_document_versions" TO "authenticated";

GRANT SELECT ON TABLE "public"."owner_verification_documents" TO "authenticated";

GRANT SELECT ON TABLE "public"."privileged_sign_in_attempts" TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES FROM "anon", "authenticated", "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payment_provider_observations" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payment_provider_observations" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."payment_provider_observations" FROM "service_role";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."simulated_payment_effects" FROM "anon";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."simulated_payment_effects" FROM "authenticated";

REVOKE REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."simulated_payment_effects" FROM "service_role";

REVOKE ALL ON FUNCTION public.payment_operation_admission(public.payment_provider_operations,boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.validate_payment_provider_observation(jsonb,uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.validate_simulated_payment_binding(jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.simulated_payment_absence_receipt(jsonb,timestamptz) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.persist_simulated_payment_effect(jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.persist_simulated_payment_effect(jsonb,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.seal_simulated_payment_absence(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seal_simulated_payment_absence(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.resolve_simulated_payment_effect(jsonb,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_simulated_payment_effect(jsonb,text,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.admit_booking_request_provider_operation(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admit_booking_request_provider_operation(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.admit_booking_request_capture(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admit_booking_request_capture(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.admit_booking_request_payment_recovery(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admit_booking_request_payment_recovery(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.admit_booking_request_payment_required_expiry(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admit_booking_request_payment_required_expiry(jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.reload_booking_request_payment_operation(jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reload_booking_request_payment_operation(jsonb,text,text) TO service_role;

REVOKE ALL ON FUNCTION public.accept_payment_provider_observation(uuid,jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.payment_provider_recorded_result(public.payment_provider_operations) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.lock_payment_observation_source(uuid,text[]) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.record_booking_request_provider_operation_observation(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_booking_request_provider_operation_observation(uuid,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.record_booking_request_capture_observation(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_booking_request_capture_observation(uuid,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.record_booking_request_payment_recovery_observation(uuid,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_booking_request_payment_recovery_observation(uuid,jsonb,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.record_booking_request_payment_required_expiry_observation(uuid,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_booking_request_payment_required_expiry_observation(uuid,jsonb,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.guard_payment_evidence() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.pending_booking_request_authorization_observations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pending_booking_request_authorization_observations() TO service_role;

REVOKE ALL ON FUNCTION public.get_booking_request_payment_facts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_booking_request_payment_facts(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.get_booking_request_payment_recovery_facts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_booking_request_payment_recovery_facts(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.get_booking_request_payment_observation_facts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_booking_request_payment_observation_facts(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.record_booking_request_payment_observation(uuid,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_booking_request_payment_observation(uuid,jsonb,jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.booking_request_payment_expiry_is_safe(jsonb) FROM PUBLIC;

REVOKE ALL ON TABLE public.booking_confirmation_notification_work FROM anon,authenticated,service_role;
REVOKE ALL ON TABLE public.booking_confirmation_notification_attempts FROM anon,authenticated,service_role;
REVOKE ALL ON TABLE public.fictional_booking_confirmation_notification_effects FROM anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.booking_confirmation_notification_binding(public.booking_confirmation_notification_work) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_due_booking_confirmation_notifications(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_booking_confirmation_notification_work(uuid,text,text,jsonb,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lease_booking_confirmation_notification_work(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.query_fictional_booking_confirmation_notification_effect(uuid,bigint,uuid,jsonb,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_fictional_booking_confirmation_notification_effect(uuid,bigint,uuid,jsonb,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_booking_confirmation_notification_delivery(uuid,bigint,uuid,jsonb,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_booking_confirmation_notification_failure(uuid,bigint,uuid,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_booking_confirmation_notification_status(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_confirmed_booking_history() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.retry_booking_confirmation_notification(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_booking_confirmation_notification_work() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_due_booking_confirmation_notifications(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_booking_confirmation_notification_work(uuid,text,text,jsonb,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.lease_booking_confirmation_notification_work(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.query_fictional_booking_confirmation_notification_effect(uuid,bigint,uuid,jsonb,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_fictional_booking_confirmation_notification_effect(uuid,bigint,uuid,jsonb,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_booking_confirmation_notification_delivery(uuid,bigint,uuid,jsonb,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_booking_confirmation_notification_failure(uuid,bigint,uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_booking_confirmation_notification_status(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_confirmed_booking_history() TO authenticated;
GRANT EXECUTE ON FUNCTION public.retry_booking_confirmation_notification(uuid,uuid) TO authenticated;

REVOKE ALL ON TABLE public.booking_cancellations FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.booking_cancellation_incidents FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.booking_cancellation_administrator_audit FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.booking_notification_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_booking_cancellation_facts(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.commit_booking_cancellation(uuid,uuid,text,text,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.booking_cancellation_result(public.booking_cancellations) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reject_booking_cancellation_fact_change() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_booking_cancellation_facts(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commit_booking_cancellation(uuid,uuid,text,text,text,jsonb) TO authenticated;

REVOKE ALL ON TABLE public.booking_lifecycle_outcomes FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.booking_incidents FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.booking_completion_maturity FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reject_booking_completion_fact_change() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.booking_completion_is_due(timestamptz,timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.booking_review_is_available(timestamptz,timestamptz,timestamptz) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.booking_completion_is_due(timestamptz,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.booking_review_is_available(timestamptz,timestamptz,timestamptz) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.booking_completion_source(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_due_booking_completions(integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.commit_booking_completion(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.commit_booking_completion_maturity(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_booking_no_show_facts(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.commit_booking_no_show(uuid,uuid,text,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_booking_incident(uuid,uuid,text,text,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_booking_lifecycle(text,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_booking_completion_eligibility(text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_due_booking_completions(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_booking_completion(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_booking_completion_maturity(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_booking_no_show_facts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commit_booking_no_show(uuid,uuid,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_booking_incident(uuid,uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_booking_lifecycle(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_booking_completion_eligibility(text,text) TO authenticated;

REVOKE ALL ON TABLE public.booking_refund_intents,public.booking_refund_attempts FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.lock_booking_refund_source(uuid),public.booking_refund_intent_state(uuid),public.booking_capture_refund_totals(uuid,jsonb),public.get_booking_refund_facts(uuid),public.record_booking_refund_notification(uuid,text),public.request_booking_refund_exception(uuid,uuid,text,jsonb),public.request_automatic_booking_refund(uuid,text,jsonb),public.booking_refund_execution_permit(public.booking_refund_attempts),public.claim_booking_refund(uuid),public.admit_booking_refund(jsonb),public.record_booking_refund_observation(uuid,jsonb),public.claim_due_booking_refunds(integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_booking_refund_facts(uuid) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.request_booking_refund_exception(uuid,uuid,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_automatic_booking_refund(uuid,text,jsonb),public.claim_booking_refund(uuid),public.admit_booking_refund(jsonb),public.record_booking_refund_observation(uuid,jsonb),public.claim_due_booking_refunds(integer) TO service_role;

REVOKE ALL ON FUNCTION public.booking_notification_event_binding(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.booking_notification_is_deliverable(public.booking_confirmation_notification_work) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.get_booking_financial_view(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_booking_financial_view(text,text) TO authenticated;
