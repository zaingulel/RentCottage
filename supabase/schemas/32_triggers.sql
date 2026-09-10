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

CREATE OR REPLACE TRIGGER "assert_cottage_inventory_availability_unit" BEFORE INSERT OR UPDATE ON "public"."cottage_inventory_availability" FOR EACH ROW EXECUTE FUNCTION "public"."assert_cottage_inventory_unit"();

CREATE OR REPLACE TRIGGER "assert_cottage_inventory_commitment_unit" BEFORE INSERT OR UPDATE ON "public"."cottage_inventory_commitments" FOR EACH ROW EXECUTE FUNCTION "public"."assert_cottage_inventory_commitment_unit"();

CREATE OR REPLACE TRIGGER "assert_cottage_inventory_date_price_unit" BEFORE INSERT OR UPDATE ON "public"."cottage_inventory_date_price_overrides" FOR EACH ROW EXECUTE FUNCTION "public"."assert_cottage_inventory_unit"();

CREATE OR REPLACE TRIGGER "assert_cottage_inventory_standard_price_unit" BEFORE INSERT OR UPDATE ON "public"."cottage_inventory_standard_prices" FOR EACH ROW EXECUTE FUNCTION "public"."assert_cottage_inventory_unit"();

CREATE OR REPLACE TRIGGER "assert_cottage_inventory_weekday_price_unit" BEFORE INSERT OR UPDATE ON "public"."cottage_inventory_weekday_price_overrides" FOR EACH ROW EXECUTE FUNCTION "public"."assert_cottage_inventory_unit"();

CREATE OR REPLACE TRIGGER "assign_owner_application_cottage_profile_owner" BEFORE INSERT ON "public"."owner_application_cottage_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."assign_owner_application_cottage_profile_owner"();

CREATE OR REPLACE TRIGGER "block_published_cottage_photo_deletion" BEFORE UPDATE OF "state", "is_active" ON "public"."cottage_profile_photos" FOR EACH ROW EXECUTE FUNCTION "public"."block_published_cottage_photo_deletion"();

CREATE OR REPLACE TRIGGER "create_cottage_profile_review_cycle" AFTER UPDATE OF "submitted_source_revision_id" ON "public"."owner_application_cottage_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."create_cottage_profile_review_cycle"();

CREATE OR REPLACE TRIGGER "enforce_booking_request_capture_work_insert" BEFORE INSERT ON "public"."booking_request_capture_work" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_booking_request_capture_work"();

CREATE OR REPLACE TRIGGER "enforce_booking_request_capture_work_update" BEFORE UPDATE ON "public"."booking_request_capture_work" FOR EACH ROW WHEN ((("old"."state" <> 'payment_required'::"text") AND ("new"."state" <> 'payment_required'::"text"))) EXECUTE FUNCTION "public"."enforce_booking_request_capture_work"();

CREATE OR REPLACE TRIGGER "enforce_booking_request_payment_recovery_history" BEFORE UPDATE ON "public"."booking_request_payment_recovery_attempts" FOR EACH ROW EXECUTE FUNCTION "public"."reject_booking_request_payment_recovery_history_change"();

CREATE OR REPLACE TRIGGER "enforce_booking_request_payment_required" BEFORE UPDATE ON "public"."booking_request_capture_work" FOR EACH ROW WHEN ((("old"."state" = 'payment_required'::"text") OR ("new"."state" = 'payment_required'::"text"))) EXECUTE FUNCTION "public"."enforce_booking_request_payment_required"();

CREATE OR REPLACE TRIGGER "enforce_booking_request_payment_required_expiry_operation" BEFORE UPDATE ON "public"."booking_request_payment_required_expiry_operations" FOR EACH ROW EXECUTE FUNCTION "public"."reject_booking_request_payment_required_expiry_change"();

CREATE OR REPLACE TRIGGER "enforce_booking_request_payment_required_expiry_work" BEFORE UPDATE ON "public"."booking_request_payment_required_expiry_work" FOR EACH ROW EXECUTE FUNCTION "public"."reject_booking_request_payment_required_expiry_change"();

CREATE OR REPLACE TRIGGER "enforce_booking_request_release_operation_transition" BEFORE INSERT OR UPDATE ON "public"."booking_request_release_operations" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_booking_request_release_operation_transition"();

CREATE OR REPLACE TRIGGER "enforce_cottage_booking_period_commitment_transition" BEFORE UPDATE ON "public"."cottage_booking_period_commitments" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_cottage_booking_period_commitment_transition"();

CREATE OR REPLACE TRIGGER "observe_payment_history_authorization_claim" AFTER INSERT OR UPDATE ON "public"."booking_request_authorization_claims" FOR EACH ROW EXECUTE FUNCTION "public"."observe_booking_request_payment_history"();

CREATE OR REPLACE TRIGGER "observe_payment_history_capture_work" AFTER INSERT OR UPDATE ON "public"."booking_request_capture_work" FOR EACH ROW EXECUTE FUNCTION "public"."observe_booking_request_payment_history"();

CREATE OR REPLACE TRIGGER "observe_payment_history_confirmation" AFTER INSERT ON "public"."booking_confirmations" FOR EACH ROW EXECUTE FUNCTION "public"."observe_booking_request_payment_history"();

CREATE OR REPLACE TRIGGER "observe_payment_history_expiry_operation" AFTER INSERT OR UPDATE ON "public"."booking_request_payment_required_expiry_operations" FOR EACH ROW EXECUTE FUNCTION "public"."observe_booking_request_payment_history"();

CREATE OR REPLACE TRIGGER "observe_payment_history_expiry_work" AFTER INSERT OR UPDATE ON "public"."booking_request_payment_required_expiry_work" FOR EACH ROW EXECUTE FUNCTION "public"."observe_booking_request_payment_history"();

CREATE OR REPLACE TRIGGER "observe_payment_history_invalidation" AFTER INSERT ON "public"."booking_request_confirmation_invalidations" FOR EACH ROW EXECUTE FUNCTION "public"."observe_booking_request_payment_history"();

CREATE OR REPLACE TRIGGER "observe_payment_history_provider_operation" AFTER INSERT OR UPDATE ON "public"."payment_provider_operations" FOR EACH ROW EXECUTE FUNCTION "public"."observe_booking_request_payment_history"();

CREATE OR REPLACE TRIGGER "observe_payment_history_provider_receipt" AFTER INSERT ON "public"."booking_request_payment_correction_observations" FOR EACH ROW EXECUTE FUNCTION "public"."observe_booking_request_payment_history"();

CREATE OR REPLACE TRIGGER "observe_payment_history_recovery_attempt" AFTER INSERT OR UPDATE ON "public"."booking_request_payment_recovery_attempts" FOR EACH ROW EXECUTE FUNCTION "public"."observe_booking_request_payment_history"();

CREATE OR REPLACE TRIGGER "observe_payment_history_recovery_operation" AFTER INSERT OR UPDATE ON "public"."booking_request_payment_recovery_operations" FOR EACH ROW EXECUTE FUNCTION "public"."observe_booking_request_payment_history"();

CREATE OR REPLACE TRIGGER "observe_payment_history_release_operation" AFTER INSERT OR UPDATE ON "public"."booking_request_release_operations" FOR EACH ROW EXECUTE FUNCTION "public"."observe_booking_request_payment_history"();

CREATE OR REPLACE TRIGGER "observe_payment_history_release_work" AFTER INSERT OR UPDATE ON "public"."booking_request_release_work" FOR EACH ROW EXECUTE FUNCTION "public"."observe_booking_request_payment_history"();

CREATE OR REPLACE TRIGGER "observe_payment_history_request" AFTER INSERT OR UPDATE ON "public"."booking_requests" FOR EACH ROW EXECUTE FUNCTION "public"."observe_booking_request_payment_history"();

CREATE OR REPLACE TRIGGER "owner_application_transitions_are_immutable" BEFORE DELETE OR UPDATE ON "public"."owner_application_transitions" FOR EACH ROW EXECUTE FUNCTION "public"."reject_owner_application_history_mutation"();

CREATE OR REPLACE TRIGGER "owner_verification_records_are_immutable" BEFORE DELETE OR UPDATE ON "public"."owner_application_verification_records" FOR EACH ROW EXECUTE FUNCTION "public"."reject_owner_application_history_mutation"();

CREATE OR REPLACE TRIGGER "owner_verification_versions_are_immutable" BEFORE DELETE OR UPDATE ON "public"."owner_verification_document_versions" FOR EACH ROW EXECUTE FUNCTION "public"."reject_owner_application_history_mutation"();

CREATE OR REPLACE TRIGGER "preserve_committed_cottage_shift_schedule_pointer" BEFORE UPDATE OF "current_shift_schedule_id" ON "public"."owner_application_cottage_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."preserve_committed_cottage_shift_schedule_pointer"();

CREATE OR REPLACE TRIGGER "protect_abandoned_cottage_profile" BEFORE UPDATE ON "public"."owner_application_cottage_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."protect_abandoned_cottage_profile"();

CREATE OR REPLACE TRIGGER "protect_cottage_profile_source_during_review" BEFORE UPDATE ON "public"."owner_application_cottage_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."protect_cottage_profile_source_during_review"();

CREATE OR REPLACE TRIGGER "protect_cottage_translation_human_review_delete" BEFORE DELETE ON "public"."cottage_profile_translation_human_reviews" FOR EACH ROW EXECUTE FUNCTION "public"."protect_cottage_translation_human_review"();

CREATE OR REPLACE TRIGGER "protect_cottage_translation_human_review_update" BEFORE UPDATE ON "public"."cottage_profile_translation_human_reviews" FOR EACH ROW EXECUTE FUNCTION "public"."protect_cottage_translation_human_review"();

CREATE OR REPLACE TRIGGER "record_owner_verification_document_version" AFTER INSERT OR UPDATE OF "object_path", "content_digest" ON "public"."owner_verification_documents" FOR EACH ROW EXECUTE FUNCTION "public"."record_owner_verification_document_version"();

CREATE OR REPLACE TRIGGER "register_cottage_marketplace_listing" AFTER UPDATE OF "current_publication_id" ON "public"."owner_application_cottage_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."register_cottage_marketplace_listing"();

CREATE OR REPLACE TRIGGER "reject_abandoned_cottage_availability_mutation" BEFORE INSERT OR DELETE OR UPDATE ON "public"."cottage_inventory_availability" FOR EACH ROW EXECUTE FUNCTION "public"."reject_abandoned_cottage_profile_child_mutation"();

CREATE OR REPLACE TRIGGER "reject_abandoned_cottage_date_price_mutation" BEFORE INSERT OR DELETE OR UPDATE ON "public"."cottage_inventory_date_price_overrides" FOR EACH ROW EXECUTE FUNCTION "public"."reject_abandoned_cottage_profile_child_mutation"();

CREATE OR REPLACE TRIGGER "reject_abandoned_cottage_profile_photo_mutation" BEFORE INSERT OR DELETE OR UPDATE ON "public"."cottage_profile_photos" FOR EACH ROW EXECUTE FUNCTION "public"."reject_abandoned_cottage_profile_child_mutation"();

CREATE OR REPLACE TRIGGER "reject_abandoned_cottage_shift_schedule_mutation" BEFORE INSERT ON "public"."cottage_shift_schedule_revisions" FOR EACH ROW EXECUTE FUNCTION "public"."reject_abandoned_cottage_profile_child_mutation"();

CREATE OR REPLACE TRIGGER "reject_abandoned_cottage_standard_price_mutation" BEFORE INSERT OR DELETE OR UPDATE ON "public"."cottage_inventory_standard_prices" FOR EACH ROW EXECUTE FUNCTION "public"."reject_abandoned_cottage_profile_child_mutation"();

CREATE OR REPLACE TRIGGER "reject_abandoned_cottage_weekday_price_mutation" BEFORE INSERT OR DELETE OR UPDATE ON "public"."cottage_inventory_weekday_price_overrides" FOR EACH ROW EXECUTE FUNCTION "public"."reject_abandoned_cottage_profile_child_mutation"();

CREATE OR REPLACE TRIGGER "reject_active_human_review_localization_decision" BEFORE INSERT ON "public"."cottage_profile_localized_decisions" FOR EACH ROW EXECUTE FUNCTION "public"."reject_active_cottage_translation_human_review"();

CREATE OR REPLACE TRIGGER "reject_active_human_review_publication" BEFORE INSERT ON "public"."cottage_publication_snapshots" FOR EACH ROW EXECUTE FUNCTION "public"."reject_active_cottage_translation_human_review"();

CREATE OR REPLACE TRIGGER "reject_authorization_claim_availability_mutation" BEFORE INSERT OR DELETE OR UPDATE ON "public"."cottage_inventory_availability" FOR EACH ROW EXECUTE FUNCTION "public"."reject_authorization_claim_inventory_mutation"();

CREATE OR REPLACE TRIGGER "reject_authorization_claim_date_price_mutation" BEFORE INSERT OR DELETE OR UPDATE ON "public"."cottage_inventory_date_price_overrides" FOR EACH ROW EXECUTE FUNCTION "public"."reject_authorization_claim_inventory_mutation"();

CREATE OR REPLACE TRIGGER "reject_authorization_claim_profile_pointer_mutation" BEFORE UPDATE OF "current_publication_id", "current_shift_schedule_id" ON "public"."owner_application_cottage_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."reject_authorization_claim_profile_or_shift_mutation"();

CREATE OR REPLACE TRIGGER "reject_authorization_claim_shift_mutation" BEFORE DELETE OR UPDATE ON "public"."cottage_shifts" FOR EACH ROW EXECUTE FUNCTION "public"."reject_authorization_claim_profile_or_shift_mutation"();

CREATE OR REPLACE TRIGGER "reject_authorization_claim_standard_price_mutation" BEFORE INSERT OR DELETE OR UPDATE ON "public"."cottage_inventory_standard_prices" FOR EACH ROW EXECUTE FUNCTION "public"."reject_authorization_claim_inventory_mutation"();

CREATE OR REPLACE TRIGGER "reject_authorization_claim_weekday_price_mutation" BEFORE INSERT OR DELETE OR UPDATE ON "public"."cottage_inventory_weekday_price_overrides" FOR EACH ROW EXECUTE FUNCTION "public"."reject_authorization_claim_inventory_mutation"();

CREATE OR REPLACE TRIGGER "reject_booking_confirmation_change" BEFORE DELETE OR UPDATE ON "public"."booking_confirmations" FOR EACH ROW EXECUTE FUNCTION "public"."reject_booking_confirmation_change"();

CREATE OR REPLACE TRIGGER "reject_booking_confirmation_invalidation_change" BEFORE DELETE OR UPDATE ON "public"."booking_request_confirmation_invalidations" FOR EACH ROW EXECUTE FUNCTION "public"."reject_booking_confirmation_change"();

CREATE OR REPLACE TRIGGER "reject_booking_period_overlap_with_authorization_claim" BEFORE INSERT ON "public"."cottage_booking_period_commitments" FOR EACH ROW EXECUTE FUNCTION "public"."reject_booking_period_overlap_with_authorization_claim"();

CREATE OR REPLACE TRIGGER "reject_booking_receipt_change" BEFORE DELETE OR UPDATE ON "public"."booking_receipts" FOR EACH ROW EXECUTE FUNCTION "public"."reject_booking_confirmation_change"();

CREATE OR REPLACE TRIGGER "guard_booking_confirmation_notification_work" BEFORE DELETE OR UPDATE ON "public"."booking_confirmation_notification_work" FOR EACH ROW EXECUTE FUNCTION "public"."guard_booking_confirmation_notification_work"();

CREATE OR REPLACE TRIGGER "reject_booking_confirmation_notification_attempt_change" BEFORE DELETE OR UPDATE ON "public"."booking_confirmation_notification_attempts" FOR EACH ROW EXECUTE FUNCTION "public"."reject_booking_confirmation_change"();

CREATE OR REPLACE TRIGGER "reject_fictional_booking_confirmation_notification_effect_change" BEFORE DELETE OR UPDATE ON "public"."fictional_booking_confirmation_notification_effects" FOR EACH ROW EXECUTE FUNCTION "public"."reject_booking_confirmation_change"();

CREATE OR REPLACE TRIGGER "reject_booking_request_payment_history_change" BEFORE DELETE OR UPDATE ON "public"."booking_request_payment_history" FOR EACH ROW EXECUTE FUNCTION "public"."reject_booking_request_payment_history_change"();

CREATE OR REPLACE TRIGGER "reject_booking_snapshot_update" BEFORE DELETE OR UPDATE ON "public"."booking_snapshots" FOR EACH ROW EXECUTE FUNCTION "public"."reject_booking_snapshot_change"();

CREATE OR REPLACE TRIGGER "reject_cottage_booking_period_occupancy_update" BEFORE UPDATE ON "public"."cottage_booking_period_occupancies" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_booking_period_occupancy_update"();

CREATE OR REPLACE TRIGGER "reject_cottage_inventory_commitment_snapshot_update" BEFORE UPDATE ON "public"."cottage_inventory_commitments" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_inventory_commitment_snapshot_update"();

CREATE OR REPLACE TRIGGER "reject_cottage_profile_localized_decisions_delete" BEFORE DELETE ON "public"."cottage_profile_localized_decisions" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_publication_history_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_profile_localized_decisions_update" BEFORE UPDATE ON "public"."cottage_profile_localized_decisions" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_publication_history_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_profile_localized_revisions_delete" BEFORE DELETE ON "public"."cottage_profile_localized_revisions" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_publication_history_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_profile_localized_revisions_update" BEFORE UPDATE ON "public"."cottage_profile_localized_revisions" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_publication_history_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_profile_publication_decisions_delete" BEFORE DELETE ON "public"."cottage_profile_publication_decisions" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_publication_history_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_profile_publication_decisions_update" BEFORE UPDATE ON "public"."cottage_profile_publication_decisions" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_publication_history_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_profile_review_cycles_delete" BEFORE DELETE ON "public"."cottage_profile_review_cycles" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_publication_history_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_profile_review_cycles_update" BEFORE UPDATE ON "public"."cottage_profile_review_cycles" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_publication_history_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_profile_review_photos_delete" BEFORE DELETE ON "public"."cottage_profile_review_photos" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_publication_history_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_profile_review_photos_update" BEFORE UPDATE ON "public"."cottage_profile_review_photos" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_publication_history_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_profile_source_delete" BEFORE DELETE ON "public"."cottage_profile_source_revisions" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_profile_source_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_profile_source_update" BEFORE UPDATE ON "public"."cottage_profile_source_revisions" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_profile_source_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_profile_translation_attempts_delete" BEFORE DELETE ON "public"."cottage_profile_translation_attempts" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_publication_history_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_profile_translation_attempts_update" BEFORE UPDATE ON "public"."cottage_profile_translation_attempts" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_publication_history_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_publication_localizations_delete" BEFORE DELETE ON "public"."cottage_publication_localizations" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_publication_history_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_publication_localizations_update" BEFORE UPDATE ON "public"."cottage_publication_localizations" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_publication_history_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_publication_media_delete" BEFORE DELETE ON "public"."cottage_publication_media" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_publication_history_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_publication_media_update" BEFORE UPDATE ON "public"."cottage_publication_media" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_publication_history_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_publication_snapshots_delete" BEFORE DELETE ON "public"."cottage_publication_snapshots" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_publication_history_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_publication_snapshots_update" BEFORE UPDATE ON "public"."cottage_publication_snapshots" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_publication_history_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_shift_delete" BEFORE DELETE ON "public"."cottage_shifts" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_shift_schedule_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_shift_schedule_revision_delete" BEFORE DELETE ON "public"."cottage_shift_schedule_revisions" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_shift_schedule_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_shift_schedule_revision_update" BEFORE UPDATE ON "public"."cottage_shift_schedule_revisions" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_shift_schedule_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_shift_update" BEFORE UPDATE ON "public"."cottage_shifts" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_shift_schedule_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_translation_cache_delete" BEFORE DELETE ON "public"."cottage_translation_cache" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_publication_history_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_translation_cache_update" BEFORE UPDATE ON "public"."cottage_translation_cache" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_publication_history_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_translation_quality_reports_delete" BEFORE DELETE ON "public"."cottage_translation_quality_reports" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_publication_history_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_translation_quality_reports_update" BEFORE UPDATE ON "public"."cottage_translation_quality_reports" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_publication_history_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_translation_usage_reservations_delete" BEFORE DELETE ON "public"."cottage_translation_usage_reservations" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_publication_history_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_translation_usage_reservations_update" BEFORE UPDATE ON "public"."cottage_translation_usage_reservations" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_publication_history_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_translation_usage_results_delete" BEFORE DELETE ON "public"."cottage_translation_usage_results" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_publication_history_mutation"();

CREATE OR REPLACE TRIGGER "reject_cottage_translation_usage_results_update" BEFORE UPDATE ON "public"."cottage_translation_usage_results" FOR EACH ROW EXECUTE FUNCTION "public"."reject_cottage_publication_history_mutation"();

CREATE OR REPLACE TRIGGER "reject_payment_correction_observation_change" BEFORE DELETE OR UPDATE ON "public"."booking_request_payment_correction_observations" FOR EACH ROW EXECUTE FUNCTION "public"."reject_booking_confirmation_change"();

CREATE CONSTRAINT TRIGGER "require_complete_cottage_shift_schedule" AFTER INSERT ON "public"."cottage_shift_schedule_revisions" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "public"."require_complete_cottage_shift_schedule"();

CREATE OR REPLACE TRIGGER "require_current_shift_schedule_for_publication" BEFORE UPDATE OF "current_publication_id" ON "public"."owner_application_cottage_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."require_current_shift_schedule_for_publication"();

CREATE OR REPLACE TRIGGER "resolve_cottage_translation_human_review" AFTER INSERT ON "public"."cottage_profile_localized_revisions" FOR EACH ROW EXECUTE FUNCTION "public"."resolve_cottage_translation_human_review"();

CREATE OR REPLACE TRIGGER "supersede_human_review_after_publication_rejection" AFTER UPDATE OF "state" ON "public"."cottage_profile_review_cycles" FOR EACH ROW EXECUTE FUNCTION "public"."supersede_human_review_after_publication_rejection"();

CREATE OR REPLACE TRIGGER "validate_cottage_shift_insert" BEFORE INSERT ON "public"."cottage_shifts" FOR EACH ROW EXECUTE FUNCTION "public"."validate_cottage_shift_insert"();

CREATE OR REPLACE TRIGGER guard_payment_provider_admission BEFORE UPDATE OR DELETE ON public.payment_provider_operations FOR EACH ROW EXECUTE FUNCTION public.guard_payment_evidence();
CREATE OR REPLACE TRIGGER guard_payment_provider_observation BEFORE UPDATE OR DELETE ON public.payment_provider_observations FOR EACH ROW EXECUTE FUNCTION public.guard_payment_evidence();
