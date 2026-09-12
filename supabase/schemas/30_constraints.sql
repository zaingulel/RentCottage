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

ALTER TABLE ONLY "public"."booking_requests"
    ADD CONSTRAINT "booking_requests_decline_note_check" CHECK ((("decline_note" IS NULL) OR (("decline_note" = "btrim"("decline_note")) AND (("char_length"("decline_note") >= 1) AND ("char_length"("decline_note") <= 500)) AND "public"."booking_request_content_is_safe"("decline_note"))));

ALTER TABLE ONLY "public"."booking_request_release_work"
    ADD CONSTRAINT "booking_request_release_work_decline_note_check" CHECK ((("decline_note" IS NULL) OR (("decline_note" = "btrim"("decline_note")) AND (("char_length"("decline_note") >= 1) AND ("char_length"("decline_note") <= 500)) AND "public"."booking_request_content_is_safe"("decline_note"))));

ALTER TABLE ONLY "public"."account_contexts"
    ADD CONSTRAINT "account_contexts_pkey" PRIMARY KEY ("user_id");

ALTER TABLE ONLY "public"."booking_confirmations"
    ADD CONSTRAINT "booking_confirmations_booking_period_commitment_id_key" UNIQUE ("booking_period_commitment_id");

ALTER TABLE ONLY "public"."booking_confirmations"
    ADD CONSTRAINT "booking_confirmations_booking_request_id_key" UNIQUE ("booking_request_id");

ALTER TABLE ONLY "public"."booking_confirmations"
    ADD CONSTRAINT "booking_confirmations_booking_snapshot_id_key" UNIQUE ("booking_snapshot_id");

ALTER TABLE ONLY "public"."booking_confirmations"
    ADD CONSTRAINT "booking_confirmations_capture_operation_id_key" UNIQUE ("capture_operation_id");

ALTER TABLE ONLY "public"."booking_confirmations"
    ADD CONSTRAINT "booking_confirmations_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."booking_receipts"
    ADD CONSTRAINT "booking_receipts_booking_confirmation_id_recipient_role_key" UNIQUE ("booking_confirmation_id", "recipient_role");

ALTER TABLE ONLY "public"."booking_receipts"
    ADD CONSTRAINT "booking_receipts_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."booking_confirmation_notification_work"
    ADD CONSTRAINT "booking_confirmation_notification_work_pkey" PRIMARY KEY (notification_id);

ALTER TABLE ONLY "public"."booking_confirmation_notification_work"
    ADD CONSTRAINT "booking_confirmation_notification_work_logical_id_key" UNIQUE ("logical_id");

ALTER TABLE ONLY "public"."booking_confirmation_notification_attempts"
    ADD CONSTRAINT "booking_confirmation_notification_attempts_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."fictional_booking_confirmation_notification_effects"
    ADD CONSTRAINT "fictional_booking_confirmation_notification_effects_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."fictional_booking_confirmation_notification_effects"
    ADD CONSTRAINT "fictional_booking_confirmation_notification_effects_identity_key" UNIQUE ("supplier", "environment", "logical_id");

ALTER TABLE ONLY "public"."fictional_booking_confirmation_notification_effects"
    ADD CONSTRAINT "fictional_booking_confirmation_notification_effects_reference_key" UNIQUE ("supplier_delivery_reference");

ALTER TABLE ONLY "public"."booking_request_authorization_claim_items"
    ADD CONSTRAINT "booking_request_authorization_claim_items_pkey" PRIMARY KEY ("claim_id", "service_day", "unit_kind", "unit_id");

ALTER TABLE ONLY "public"."booking_request_authorization_claim_occupancies"
    ADD CONSTRAINT "booking_request_authorization_claim_occupancies_pkey" PRIMARY KEY ("claim_id", "schedule_revision_id", "shift_id", "service_day");

ALTER TABLE ONLY "public"."booking_request_authorization_claims"
    ADD CONSTRAINT "booking_request_authorization_claims_attempt_id_key" UNIQUE ("attempt_id");

ALTER TABLE ONLY "public"."booking_request_authorization_claims"
    ADD CONSTRAINT "booking_request_authorization_claims_id_generation_key" UNIQUE ("id", "generation");

ALTER TABLE ONLY "public"."booking_request_authorization_claims"
    ADD CONSTRAINT "booking_request_authorization_claims_payment_lifecycle_id_key" UNIQUE ("payment_lifecycle_id");

ALTER TABLE ONLY "public"."booking_request_authorization_claims"
    ADD CONSTRAINT "booking_request_authorization_claims_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."booking_request_authorization_claims"
    ADD CONSTRAINT "booking_request_authorization_customer_access_excl" EXCLUDE USING "gist" ("customer_user_id" WITH =, "access_ranges" WITH &&) WHERE ("public"."booking_request_claim_state_is_active"("state"));

ALTER TABLE ONLY "public"."booking_request_authorization_claims"
    ADD CONSTRAINT "booking_request_authorization_provider_environment_merchant_key" UNIQUE ("provider", "environment", "merchant_id", "terminal_id", "provider_idempotency_key");

ALTER TABLE ONLY "public"."booking_request_authorization_reconciliation_outbox"
    ADD CONSTRAINT "booking_request_authorization_reconciliation_outbox_pkey" PRIMARY KEY ("claim_id");

ALTER TABLE ONLY "public"."booking_request_capture_work"
    ADD CONSTRAINT "booking_request_capture_work_pkey" PRIMARY KEY ("booking_request_id");

ALTER TABLE ONLY "public"."booking_request_confirmation_invalidations"
    ADD CONSTRAINT "booking_request_confirmation_invalidations_confirmation_id_key" UNIQUE ("confirmation_id");

ALTER TABLE ONLY "public"."booking_request_confirmation_invalidations"
    ADD CONSTRAINT "booking_request_confirmation_invalidations_pkey" PRIMARY KEY ("booking_request_id");

ALTER TABLE ONLY "public"."booking_request_payment_correction_observations"
    ADD CONSTRAINT "booking_request_payment_corre_provider_operation_id_receipt_key" UNIQUE ("provider_operation_id", "receipt_identity", "payload");

ALTER TABLE ONLY "public"."booking_request_payment_correction_observations"
    ADD CONSTRAINT "booking_request_payment_correction_observations_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."booking_request_payment_history"
    ADD CONSTRAINT "booking_request_payment_history_id_key" UNIQUE ("id");

ALTER TABLE ONLY "public"."booking_request_payment_history"
    ADD CONSTRAINT "booking_request_payment_history_pkey" PRIMARY KEY ("sequence");

ALTER TABLE ONLY "public"."booking_request_payment_recovery_attempts"
    ADD CONSTRAINT "booking_request_payment_recov_booking_request_id_command_ke_key" UNIQUE ("booking_request_id", "command_key");

ALTER TABLE ONLY "public"."booking_request_payment_recovery_attempts"
    ADD CONSTRAINT "booking_request_payment_recov_booking_request_id_generation_key" UNIQUE ("booking_request_id", "generation");

ALTER TABLE ONLY "public"."booking_request_payment_recovery_attempts"
    ADD CONSTRAINT "booking_request_payment_recovery_attempts_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."booking_request_payment_recovery_operations"
    ADD CONSTRAINT "booking_request_payment_recovery_oper_provider_operation_id_key" UNIQUE ("provider_operation_id");

ALTER TABLE ONLY "public"."booking_request_payment_recovery_operations"
    ADD CONSTRAINT "booking_request_payment_recovery_operations_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."booking_request_payment_required_expiry_operations"
    ADD CONSTRAINT "booking_request_payment_requi_booking_request_id_authorizat_key" UNIQUE ("booking_request_id", "authorization_payment_lifecycle_id", "authorization_logical_operation_id", "authorization_physical_attempt_id");

ALTER TABLE ONLY "public"."booking_request_payment_required_expiry_operations"
    ADD CONSTRAINT "booking_request_payment_requi_capture_provider_operation_id_key" UNIQUE ("capture_provider_operation_id");

ALTER TABLE ONLY "public"."booking_request_payment_required_expiry_operations"
    ADD CONSTRAINT "booking_request_payment_requi_provider_environment_merchant_key" UNIQUE ("provider", "environment", "merchant_id", "terminal_id", "provider_idempotency_key");

ALTER TABLE ONLY "public"."booking_request_payment_required_expiry_operations"
    ADD CONSTRAINT "booking_request_payment_required_expi_provider_operation_id_key" UNIQUE ("provider_operation_id");

ALTER TABLE ONLY "public"."booking_request_payment_required_expiry_operations"
    ADD CONSTRAINT "booking_request_payment_required_expi_recovery_operation_id_key" UNIQUE ("recovery_operation_id");

ALTER TABLE ONLY "public"."booking_request_payment_required_expiry_work"
    ADD CONSTRAINT "booking_request_payment_required_expiry__booking_request_id_key" UNIQUE ("booking_request_id");

ALTER TABLE ONLY "public"."booking_request_payment_required_expiry_operations"
    ADD CONSTRAINT "booking_request_payment_required_expiry_o_expiry_work_id_id_key" UNIQUE ("expiry_work_id", "id");

ALTER TABLE ONLY "public"."booking_request_payment_required_expiry_operations"
    ADD CONSTRAINT "booking_request_payment_required_expiry_operations_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."booking_request_payment_required_expiry_work"
    ADD CONSTRAINT "booking_request_payment_required_expiry_work_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."booking_request_provider_operation_identities"
    ADD CONSTRAINT "booking_request_provider_oper_provider_environment_merchan_key1" UNIQUE ("provider", "environment", "merchant_id", "terminal_id", "provider_reference");

ALTER TABLE ONLY "public"."booking_request_provider_operation_identities"
    ADD CONSTRAINT "booking_request_provider_oper_provider_environment_merchan_key2" UNIQUE ("provider", "environment", "merchant_id", "terminal_id", "movement_reference");

ALTER TABLE ONLY "public"."booking_request_provider_operation_identities"
    ADD CONSTRAINT "booking_request_provider_oper_provider_environment_merchant_key" UNIQUE ("provider", "environment", "merchant_id", "terminal_id", "provider_request_id");

ALTER TABLE ONLY "public"."booking_request_provider_operation_identities"
    ADD CONSTRAINT "booking_request_provider_operation_identities_pkey" PRIMARY KEY ("attempt_id", "operation_kind");

ALTER TABLE ONLY "public"."booking_request_release_operations"
    ADD CONSTRAINT "booking_request_release_opera_provider_environment_merchan_key1" UNIQUE ("provider", "environment", "merchant_id", "terminal_id", "provider_request_id");

ALTER TABLE ONLY "public"."booking_request_release_operations"
    ADD CONSTRAINT "booking_request_release_opera_provider_environment_merchan_key2" UNIQUE ("provider", "environment", "merchant_id", "terminal_id", "provider_reference");

ALTER TABLE ONLY "public"."booking_request_release_operations"
    ADD CONSTRAINT "booking_request_release_opera_provider_environment_merchan_key3" UNIQUE ("provider", "environment", "merchant_id", "terminal_id", "movement_reference");

ALTER TABLE ONLY "public"."booking_request_release_operations"
    ADD CONSTRAINT "booking_request_release_opera_provider_environment_merchant_key" UNIQUE ("provider", "environment", "merchant_id", "terminal_id", "provider_idempotency_key");

ALTER TABLE ONLY "public"."booking_request_release_operations"
    ADD CONSTRAINT "booking_request_release_operat_work_id_operation_generation_key" UNIQUE ("work_id", "operation_generation");

ALTER TABLE ONLY "public"."booking_request_release_operations"
    ADD CONSTRAINT "booking_request_release_operati_work_id_physical_attempt_id_key" UNIQUE ("work_id", "physical_attempt_id");

ALTER TABLE ONLY "public"."booking_request_release_operations"
    ADD CONSTRAINT "booking_request_release_operations_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."booking_request_release_operations"
    ADD CONSTRAINT "booking_request_release_operations_work_id_id_key" UNIQUE ("work_id", "id");

ALTER TABLE ONLY "public"."booking_request_release_work"
    ADD CONSTRAINT "booking_request_release_work_attempt_id_key" UNIQUE ("attempt_id");

ALTER TABLE ONLY "public"."booking_request_release_work"
    ADD CONSTRAINT "booking_request_release_work_booking_request_id_key" UNIQUE ("booking_request_id");

ALTER TABLE ONLY "public"."booking_request_release_work"
    ADD CONSTRAINT "booking_request_release_work_id_attempt_id_key" UNIQUE ("id", "attempt_id");

ALTER TABLE ONLY "public"."booking_request_release_work"
    ADD CONSTRAINT "booking_request_release_work_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."booking_request_status_notifications"
    ADD CONSTRAINT "booking_request_status_notifi_booking_request_id_recipient__key" UNIQUE ("booking_request_id", "recipient_user_id", "status");

ALTER TABLE ONLY "public"."booking_request_status_notifications"
    ADD CONSTRAINT "booking_request_status_notifications_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."booking_request_submission_attempts"
    ADD CONSTRAINT "booking_request_submission_at_customer_user_id_idempotency__key" UNIQUE ("customer_user_id", "idempotency_key");

ALTER TABLE ONLY "public"."booking_request_submission_attempts"
    ADD CONSTRAINT "booking_request_submission_attempt_lifecycle_unique" UNIQUE ("id", "payment_lifecycle_id");

ALTER TABLE ONLY "public"."booking_request_submission_attempts"
    ADD CONSTRAINT "booking_request_submission_attempts_booking_request_id_key" UNIQUE ("booking_request_id");

ALTER TABLE ONLY "public"."booking_request_submission_attempts"
    ADD CONSTRAINT "booking_request_submission_attempts_payment_lifecycle_id_key" UNIQUE ("payment_lifecycle_id");

ALTER TABLE ONLY "public"."booking_request_submission_attempts"
    ADD CONSTRAINT "booking_request_submission_attempts_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."booking_requests"
    ADD CONSTRAINT "booking_requests_booking_period_commitment_id_key" UNIQUE ("booking_period_commitment_id");

ALTER TABLE ONLY "public"."booking_requests"
    ADD CONSTRAINT "booking_requests_booking_request_reference_key" UNIQUE ("booking_request_reference");

ALTER TABLE ONLY "public"."booking_requests"
    ADD CONSTRAINT "booking_requests_booking_snapshot_id_key" UNIQUE ("booking_snapshot_id");

ALTER TABLE ONLY "public"."booking_requests"
    ADD CONSTRAINT "booking_requests_payment_lifecycle_id_key" UNIQUE ("payment_lifecycle_id");

ALTER TABLE ONLY "public"."booking_requests"
    ADD CONSTRAINT "booking_requests_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."booking_snapshots"
    ADD CONSTRAINT "booking_snapshots_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."cottage_booking_period_commitments"
    ADD CONSTRAINT "cottage_booking_period_commitments_commitment_reference_key" UNIQUE ("commitment_reference");

ALTER TABLE ONLY "public"."cottage_booking_period_commitments"
    ADD CONSTRAINT "cottage_booking_period_commitments_id_schedule_revision_id_key" UNIQUE ("id", "schedule_revision_id");

ALTER TABLE ONLY "public"."cottage_booking_period_commitments"
    ADD CONSTRAINT "cottage_booking_period_commitments_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."cottage_booking_period_commitments"
    ADD CONSTRAINT "cottage_booking_period_customer_access_excl" EXCLUDE USING "gist" ("customer_user_id" WITH =, "access_ranges" WITH &&) WHERE (("status" = ANY (ARRAY['pending_hold'::"public"."cottage_inventory_commitment_status", 'confirmed_booking'::"public"."cottage_inventory_commitment_status"])));

ALTER TABLE ONLY "public"."cottage_booking_period_occupancies"
    ADD CONSTRAINT "cottage_booking_period_occupancies_pkey" PRIMARY KEY ("booking_period_commitment_id", "shift_id", "service_day");

ALTER TABLE ONLY "public"."cottage_inventory_availability"
    ADD CONSTRAINT "cottage_inventory_availability_pkey" PRIMARY KEY ("schedule_revision_id", "unit_kind", "unit_id", "service_day");

ALTER TABLE ONLY "public"."cottage_inventory_commitments"
    ADD CONSTRAINT "cottage_inventory_commitments_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."cottage_inventory_commitments"
    ADD CONSTRAINT "cottage_inventory_commitments_selected_unit_key" UNIQUE ("booking_period_commitment_id", "service_day", "unit_kind", "unit_id");

ALTER TABLE ONLY "public"."cottage_inventory_date_price_overrides"
    ADD CONSTRAINT "cottage_inventory_date_price_overrides_pkey" PRIMARY KEY ("schedule_revision_id", "unit_kind", "unit_id", "service_day");

ALTER TABLE ONLY "public"."cottage_inventory_standard_prices"
    ADD CONSTRAINT "cottage_inventory_standard_prices_pkey" PRIMARY KEY ("schedule_revision_id", "unit_kind", "unit_id");

ALTER TABLE ONLY "public"."cottage_inventory_weekday_price_overrides"
    ADD CONSTRAINT "cottage_inventory_weekday_price_overrides_pkey" PRIMARY KEY ("schedule_revision_id", "unit_kind", "unit_id", "weekday");

ALTER TABLE ONLY "public"."cottage_marketplace_listings"
    ADD CONSTRAINT "cottage_marketplace_listings_pkey" PRIMARY KEY ("profile_id");

ALTER TABLE ONLY "public"."cottage_marketplace_listings"
    ADD CONSTRAINT "cottage_marketplace_listings_public_slug_key" UNIQUE ("public_slug");

ALTER TABLE ONLY "public"."cottage_ownership"
    ADD CONSTRAINT "cottage_ownership_pkey" PRIMARY KEY ("cottage_id");

ALTER TABLE ONLY "public"."cottage_profile_administrator_audit"
    ADD CONSTRAINT "cottage_profile_administrator_audit_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."cottage_profile_localized_decisions"
    ADD CONSTRAINT "cottage_profile_localized_decisions_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."cottage_profile_localized_heads"
    ADD CONSTRAINT "cottage_profile_localized_heads_pkey" PRIMARY KEY ("review_cycle_id", "locale");

ALTER TABLE ONLY "public"."cottage_profile_localized_revisions"
    ADD CONSTRAINT "cottage_profile_localized_rev_review_cycle_id_locale_revisi_key" UNIQUE ("review_cycle_id", "locale", "revision");

ALTER TABLE ONLY "public"."cottage_profile_localized_revisions"
    ADD CONSTRAINT "cottage_profile_localized_revisions_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."cottage_profile_photos"
    ADD CONSTRAINT "cottage_profile_photos_object_path_key" UNIQUE ("object_path");

ALTER TABLE ONLY "public"."cottage_profile_photos"
    ADD CONSTRAINT "cottage_profile_photos_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."cottage_profile_publication_decisions"
    ADD CONSTRAINT "cottage_profile_publication_decisions_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."cottage_profile_review_cycles"
    ADD CONSTRAINT "cottage_profile_review_cycles_id_source_revision_id_key" UNIQUE ("id", "source_revision_id");

ALTER TABLE ONLY "public"."cottage_profile_review_cycles"
    ADD CONSTRAINT "cottage_profile_review_cycles_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."cottage_profile_review_cycles"
    ADD CONSTRAINT "cottage_profile_review_cycles_profile_id_cycle_number_key" UNIQUE ("profile_id", "cycle_number");

ALTER TABLE ONLY "public"."cottage_profile_review_photos"
    ADD CONSTRAINT "cottage_profile_review_photos_pkey" PRIMARY KEY ("review_cycle_id", "photo_id");

ALTER TABLE ONLY "public"."cottage_profile_review_photos"
    ADD CONSTRAINT "cottage_profile_review_photos_review_cycle_id_position_key" UNIQUE ("review_cycle_id", "position");

ALTER TABLE ONLY "public"."cottage_profile_source_revisions"
    ADD CONSTRAINT "cottage_profile_source_revisions_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."cottage_profile_source_revisions"
    ADD CONSTRAINT "cottage_profile_source_revisions_profile_id_revision_key" UNIQUE ("profile_id", "revision");

ALTER TABLE ONLY "public"."cottage_profile_translation_attempts"
    ADD CONSTRAINT "cottage_profile_translation_a_review_cycle_id_target_langua_key" UNIQUE ("review_cycle_id", "target_language", "attempt_number");

ALTER TABLE ONLY "public"."cottage_profile_translation_attempts"
    ADD CONSTRAINT "cottage_profile_translation_attempts_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."cottage_profile_translation_human_reviews"
    ADD CONSTRAINT "cottage_profile_translation_human_reviews_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."owner_application_cottage_profiles"
    ADD CONSTRAINT "cottage_profiles_id_owner_user_id_key" UNIQUE ("id", "owner_user_id");

ALTER TABLE ONLY "public"."cottage_publication_localizations"
    ADD CONSTRAINT "cottage_publication_localizations_pkey" PRIMARY KEY ("publication_id", "locale");

ALTER TABLE ONLY "public"."cottage_publication_media"
    ADD CONSTRAINT "cottage_publication_media_opaque_id_key" UNIQUE ("opaque_id");

ALTER TABLE ONLY "public"."cottage_publication_media"
    ADD CONSTRAINT "cottage_publication_media_pkey" PRIMARY KEY ("publication_id", "photo_id");

ALTER TABLE ONLY "public"."cottage_publication_media"
    ADD CONSTRAINT "cottage_publication_media_publication_id_position_key" UNIQUE ("publication_id", "position");

ALTER TABLE ONLY "public"."cottage_publication_snapshots"
    ADD CONSTRAINT "cottage_publication_snapshots_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."cottage_publication_snapshots"
    ADD CONSTRAINT "cottage_publication_snapshots_profile_id_publication_number_key" UNIQUE ("profile_id", "publication_number");

ALTER TABLE ONLY "public"."cottage_publication_snapshots"
    ADD CONSTRAINT "cottage_publication_snapshots_review_cycle_id_key" UNIQUE ("review_cycle_id");

ALTER TABLE ONLY "public"."cottage_shift_schedule_revisions"
    ADD CONSTRAINT "cottage_shift_schedule_revisions_full_day_bundle_id_key" UNIQUE ("full_day_bundle_id");

ALTER TABLE ONLY "public"."cottage_shift_schedule_revisions"
    ADD CONSTRAINT "cottage_shift_schedule_revisions_id_bundle_key" UNIQUE ("id", "full_day_bundle_id");

ALTER TABLE ONLY "public"."cottage_shift_schedule_revisions"
    ADD CONSTRAINT "cottage_shift_schedule_revisions_id_profile_id_key" UNIQUE ("id", "profile_id");

ALTER TABLE ONLY "public"."cottage_shift_schedule_revisions"
    ADD CONSTRAINT "cottage_shift_schedule_revisions_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."cottage_shift_schedule_revisions"
    ADD CONSTRAINT "cottage_shift_schedule_revisions_profile_id_revision_key" UNIQUE ("profile_id", "revision");

ALTER TABLE ONLY "public"."cottage_shifts"
    ADD CONSTRAINT "cottage_shifts_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."cottage_shifts"
    ADD CONSTRAINT "cottage_shifts_revision_id_id_key" UNIQUE ("schedule_revision_id", "id");

ALTER TABLE ONLY "public"."cottage_shifts"
    ADD CONSTRAINT "cottage_shifts_schedule_revision_id_position_key" UNIQUE ("schedule_revision_id", "position");

ALTER TABLE ONLY "public"."cottage_translation_cache"
    ADD CONSTRAINT "cottage_translation_cache_pkey" PRIMARY KEY ("cache_key");

ALTER TABLE ONLY "public"."cottage_translation_quality_reports"
    ADD CONSTRAINT "cottage_translation_quality_r_localized_revision_id_reporte_key" UNIQUE ("localized_revision_id", "reporter_user_id");

ALTER TABLE ONLY "public"."cottage_translation_quality_reports"
    ADD CONSTRAINT "cottage_translation_quality_reports_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."cottage_translation_runtime_control"
    ADD CONSTRAINT "cottage_translation_runtime_control_pkey" PRIMARY KEY ("singleton");

ALTER TABLE ONLY "public"."cottage_translation_usage_reservations"
    ADD CONSTRAINT "cottage_translation_usage_reservations_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."cottage_translation_usage_results"
    ADD CONSTRAINT "cottage_translation_usage_results_pkey" PRIMARY KEY ("reservation_id");

ALTER TABLE ONLY "public"."owner_application_cottage_profiles"
    ADD CONSTRAINT "owner_application_cottage_profiles_application_id_key" UNIQUE ("application_id");

ALTER TABLE ONLY "public"."owner_application_cottage_profiles"
    ADD CONSTRAINT "owner_application_cottage_profiles_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."owner_application_information_requests"
    ADD CONSTRAINT "owner_application_information_requests_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."owner_application_lifecycle_control"
    ADD CONSTRAINT "owner_application_lifecycle_control_pkey" PRIMARY KEY ("singleton");

ALTER TABLE ONLY "public"."owner_application_notices"
    ADD CONSTRAINT "owner_application_notices_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."owner_application_renewal_work"
    ADD CONSTRAINT "owner_application_renewal_work_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."owner_application_transitions"
    ADD CONSTRAINT "owner_application_transitions_application_id_application_ve_key" UNIQUE ("application_id", "application_version");

ALTER TABLE ONLY "public"."owner_application_transitions"
    ADD CONSTRAINT "owner_application_transitions_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."owner_application_verification_records"
    ADD CONSTRAINT "owner_application_verification_recor_application_id_version_key" UNIQUE ("application_id", "version");

ALTER TABLE ONLY "public"."owner_application_verification_records"
    ADD CONSTRAINT "owner_application_verification_records_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."owner_applications"
    ADD CONSTRAINT "owner_applications_id_owner_user_id_key" UNIQUE ("id", "owner_user_id");

ALTER TABLE ONLY "public"."owner_applications"
    ADD CONSTRAINT "owner_applications_owner_user_id_key" UNIQUE ("owner_user_id");

ALTER TABLE ONLY "public"."owner_applications"
    ADD CONSTRAINT "owner_applications_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."owner_request_notifications"
    ADD CONSTRAINT "owner_request_notifications_booking_request_id_key" UNIQUE ("booking_request_id");

ALTER TABLE ONLY "public"."owner_request_notifications"
    ADD CONSTRAINT "owner_request_notifications_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."owner_verification_document_access_grants"
    ADD CONSTRAINT "owner_verification_document_access_grants_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."owner_verification_document_audit"
    ADD CONSTRAINT "owner_verification_document_audit_access_grant_id_key" UNIQUE ("access_grant_id");

ALTER TABLE ONLY "public"."owner_verification_document_audit"
    ADD CONSTRAINT "owner_verification_document_audit_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."owner_verification_document_cleanup"
    ADD CONSTRAINT "owner_verification_document_cleanup_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."owner_verification_document_versions"
    ADD CONSTRAINT "owner_verification_document_versions_document_id_version_key" UNIQUE ("document_id", "version");

ALTER TABLE ONLY "public"."owner_verification_document_versions"
    ADD CONSTRAINT "owner_verification_document_versions_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."owner_verification_documents"
    ADD CONSTRAINT "owner_verification_documents_application_id_kind_key" UNIQUE ("application_id", "kind");

ALTER TABLE ONLY "public"."owner_verification_documents"
    ADD CONSTRAINT "owner_verification_documents_object_path_key" UNIQUE ("object_path");

ALTER TABLE ONLY "public"."owner_verification_documents"
    ADD CONSTRAINT "owner_verification_documents_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."privileged_sign_in_attempts"
    ADD CONSTRAINT "privileged_sign_in_attempts_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."booking_request_payment_recovery_operations"
    ADD CONSTRAINT "recovery_operation_identity_unique" UNIQUE ("recovery_attempt_id", "step", "operation_generation");

ALTER TABLE ONLY "public"."payment_provider_operations"
    ADD CONSTRAINT "simulated_payment_provider_op_provider_environment_merchan_key1" UNIQUE ("provider", "environment", "merchant_id", "terminal_id", "provider_request_id");

ALTER TABLE ONLY "public"."payment_provider_operations"
    ADD CONSTRAINT "simulated_payment_provider_op_provider_environment_merchan_key2" UNIQUE ("provider", "environment", "merchant_id", "terminal_id", "provider_reference");

ALTER TABLE ONLY "public"."payment_provider_operations"
    ADD CONSTRAINT "simulated_payment_provider_op_provider_environment_merchan_key3" UNIQUE ("provider", "environment", "merchant_id", "terminal_id", "movement_reference");

ALTER TABLE ONLY "public"."payment_provider_operations"
    ADD CONSTRAINT "simulated_payment_provider_op_provider_environment_merchant_key" UNIQUE ("provider", "environment", "merchant_id", "terminal_id", "provider_idempotency_key");

ALTER TABLE ONLY "public"."payment_provider_operations"
    ADD CONSTRAINT "simulated_payment_provider_operations_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."account_contexts"
    ADD CONSTRAINT "account_contexts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."booking_confirmations"
    ADD CONSTRAINT "booking_confirmations_booking_period_commitment_id_fkey" FOREIGN KEY ("booking_period_commitment_id") REFERENCES "public"."cottage_booking_period_commitments"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_confirmations"
    ADD CONSTRAINT "booking_confirmations_booking_request_id_fkey" FOREIGN KEY ("booking_request_id") REFERENCES "public"."booking_requests"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_confirmations"
    ADD CONSTRAINT "booking_confirmations_booking_snapshot_id_fkey" FOREIGN KEY ("booking_snapshot_id") REFERENCES "public"."booking_snapshots"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_confirmations"
    ADD CONSTRAINT "booking_confirmations_capture_operation_id_fkey" FOREIGN KEY ("capture_operation_id") REFERENCES "public"."payment_provider_operations"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_receipts"
    ADD CONSTRAINT "booking_receipts_booking_confirmation_id_fkey" FOREIGN KEY ("booking_confirmation_id") REFERENCES "public"."booking_confirmations"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_receipts"
    ADD CONSTRAINT "booking_receipts_booking_snapshot_id_fkey" FOREIGN KEY ("booking_snapshot_id") REFERENCES "public"."booking_snapshots"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_receipts"
    ADD CONSTRAINT "booking_receipts_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."account_contexts"("user_id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_confirmation_notification_work"
    ADD CONSTRAINT "booking_confirmation_notification_work_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "public"."booking_receipts"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_confirmation_notification_work"
    ADD CONSTRAINT "booking_confirmation_notification_work_booking_request_id_fkey" FOREIGN KEY ("booking_request_id") REFERENCES "public"."booking_requests"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_confirmation_notification_work"
    ADD CONSTRAINT "booking_confirmation_notification_work_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."account_contexts"("user_id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_confirmation_notification_attempts"
    ADD CONSTRAINT "booking_confirmation_notification_attempts_receipt_id_fkey" FOREIGN KEY (notification_id) REFERENCES "public"."booking_confirmation_notification_work"(notification_id) ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."fictional_booking_confirmation_notification_effects"
    ADD CONSTRAINT "fictional_booking_confirmation_notification_effects_receipt_id_fkey" FOREIGN KEY (notification_id) REFERENCES "public"."booking_confirmation_notification_work"(notification_id) ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."fictional_booking_confirmation_notification_effects"
    ADD CONSTRAINT "fictional_booking_confirmation_notification_effects_booking_request_id_fkey" FOREIGN KEY ("booking_request_id") REFERENCES "public"."booking_requests"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."fictional_booking_confirmation_notification_effects"
    ADD CONSTRAINT "fictional_booking_confirmation_notification_effects_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."account_contexts"("user_id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_confirmation_notification_attempts"
    ADD CONSTRAINT "booking_confirmation_notification_attempts_effect_id_fkey" FOREIGN KEY ("effect_id") REFERENCES "public"."fictional_booking_confirmation_notification_effects"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_authorization_claim_items"
    ADD CONSTRAINT "booking_request_authorization_claim_items_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "public"."booking_request_authorization_claims"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_authorization_claim_occupancies"
    ADD CONSTRAINT "booking_request_authorization_claim_occupancies_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "public"."booking_request_authorization_claims"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_authorization_claims"
    ADD CONSTRAINT "booking_request_authorization_claims_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "public"."booking_request_submission_attempts"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_authorization_claims"
    ADD CONSTRAINT "booking_request_authorization_claims_customer_user_id_fkey" FOREIGN KEY ("customer_user_id") REFERENCES "public"."account_contexts"("user_id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_authorization_claims"
    ADD CONSTRAINT "booking_request_authorization_claims_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."owner_application_cottage_profiles"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_authorization_reconciliation_outbox"
    ADD CONSTRAINT "booking_request_authorization_re_claim_id_claim_generation_fkey" FOREIGN KEY ("claim_id", "claim_generation") REFERENCES "public"."booking_request_authorization_claims"("id", "generation") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_authorization_reconciliation_outbox"
    ADD CONSTRAINT "booking_request_authorization_reconciliation_outb_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "public"."booking_request_authorization_claims"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_authorization_claims"
    ADD CONSTRAINT "booking_request_authorization_schedule_revision_id_profile_fkey" FOREIGN KEY ("schedule_revision_id", "profile_id") REFERENCES "public"."cottage_shift_schedule_revisions"("id", "profile_id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_authorization_claim_occupancies"
    ADD CONSTRAINT "booking_request_authorization_schedule_revision_id_shift_i_fkey" FOREIGN KEY ("schedule_revision_id", "shift_id") REFERENCES "public"."cottage_shifts"("schedule_revision_id", "id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_capture_work"
    ADD CONSTRAINT "booking_request_capture_work_attempt_id_payment_lifecycle__fkey" FOREIGN KEY ("attempt_id", "payment_lifecycle_id") REFERENCES "public"."booking_request_submission_attempts"("id", "payment_lifecycle_id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_capture_work"
    ADD CONSTRAINT "booking_request_capture_work_authorization_claim_id_author_fkey" FOREIGN KEY ("authorization_claim_id", "authorization_claim_generation") REFERENCES "public"."booking_request_authorization_claims"("id", "generation") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_capture_work"
    ADD CONSTRAINT "booking_request_capture_work_booking_request_id_fkey" FOREIGN KEY ("booking_request_id") REFERENCES "public"."booking_requests"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_capture_work"
    ADD CONSTRAINT "booking_request_capture_work_recovery_operation_id_fkey" FOREIGN KEY ("recovery_operation_id") REFERENCES "public"."payment_provider_operations"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_confirmation_invalidations"
    ADD CONSTRAINT "booking_request_confirmation_invalid_provider_operation_id_fkey" FOREIGN KEY ("provider_operation_id") REFERENCES "public"."payment_provider_operations"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_confirmation_invalidations"
    ADD CONSTRAINT "booking_request_confirmation_invalidati_booking_request_id_fkey" FOREIGN KEY ("booking_request_id") REFERENCES "public"."booking_requests"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_confirmation_invalidations"
    ADD CONSTRAINT "booking_request_confirmation_invalidations_confirmation_id_fkey" FOREIGN KEY ("confirmation_id") REFERENCES "public"."booking_confirmations"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_confirmation_invalidations"
    ADD CONSTRAINT "booking_request_confirmation_invalidations_expiry_work_id_fkey" FOREIGN KEY ("expiry_work_id") REFERENCES "public"."booking_request_payment_required_expiry_work"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_payment_correction_observations"
    ADD CONSTRAINT "booking_request_payment_correction_o_provider_operation_id_fkey" FOREIGN KEY ("provider_operation_id") REFERENCES "public"."payment_provider_operations"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_payment_correction_observations"
    ADD CONSTRAINT "booking_request_payment_correction_obse_booking_request_id_fkey" FOREIGN KEY ("booking_request_id") REFERENCES "public"."booking_requests"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_payment_recovery_attempts"
    ADD CONSTRAINT "booking_request_payment_recovery_attemp_booking_request_id_fkey" FOREIGN KEY ("booking_request_id") REFERENCES "public"."booking_requests"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_payment_recovery_operations"
    ADD CONSTRAINT "booking_request_payment_recovery_ope_provider_operation_id_fkey" FOREIGN KEY ("provider_operation_id") REFERENCES "public"."payment_provider_operations"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_payment_recovery_operations"
    ADD CONSTRAINT "booking_request_payment_recovery_opera_recovery_attempt_id_fkey" FOREIGN KEY ("recovery_attempt_id") REFERENCES "public"."booking_request_payment_recovery_attempts"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_payment_required_expiry_operations"
    ADD CONSTRAINT "booking_request_payment_requi_capture_provider_operation_i_fkey" FOREIGN KEY ("capture_provider_operation_id") REFERENCES "public"."payment_provider_operations"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_payment_required_expiry_operations"
    ADD CONSTRAINT "booking_request_payment_required_exp_provider_operation_id_fkey" FOREIGN KEY ("provider_operation_id") REFERENCES "public"."payment_provider_operations"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_payment_required_expiry_operations"
    ADD CONSTRAINT "booking_request_payment_required_exp_recovery_operation_id_fkey" FOREIGN KEY ("recovery_operation_id") REFERENCES "public"."booking_request_payment_recovery_operations"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_payment_required_expiry_operations"
    ADD CONSTRAINT "booking_request_payment_required_expir_booking_request_id_fkey1" FOREIGN KEY ("booking_request_id") REFERENCES "public"."booking_requests"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_payment_required_expiry_work"
    ADD CONSTRAINT "booking_request_payment_required_expiry_booking_request_id_fkey" FOREIGN KEY ("booking_request_id") REFERENCES "public"."booking_requests"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_payment_required_expiry_operations"
    ADD CONSTRAINT "booking_request_payment_required_expiry_ope_expiry_work_id_fkey" FOREIGN KEY ("expiry_work_id") REFERENCES "public"."booking_request_payment_required_expiry_work"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_provider_operation_identities"
    ADD CONSTRAINT "booking_request_provider_operation_identities_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "public"."booking_request_submission_attempts"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_release_operations"
    ADD CONSTRAINT "booking_request_release_opera_attempt_id_payment_lifecycle_fkey" FOREIGN KEY ("attempt_id", "payment_lifecycle_id") REFERENCES "public"."booking_request_submission_attempts"("id", "payment_lifecycle_id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_release_operations"
    ADD CONSTRAINT "booking_request_release_operations_work_id_attempt_id_fkey" FOREIGN KEY ("work_id", "attempt_id") REFERENCES "public"."booking_request_release_work"("id", "attempt_id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_release_work"
    ADD CONSTRAINT "booking_request_release_work_active_operation_fkey" FOREIGN KEY ("id", "active_operation_id") REFERENCES "public"."booking_request_release_operations"("work_id", "id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_release_work"
    ADD CONSTRAINT "booking_request_release_work_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "public"."account_contexts"("user_id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_release_work"
    ADD CONSTRAINT "booking_request_release_work_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "public"."booking_request_submission_attempts"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_release_work"
    ADD CONSTRAINT "booking_request_release_work_booking_request_id_fkey" FOREIGN KEY ("booking_request_id") REFERENCES "public"."booking_requests"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_status_notifications"
    ADD CONSTRAINT "booking_request_status_notifications_booking_request_id_fkey" FOREIGN KEY ("booking_request_id") REFERENCES "public"."booking_requests"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_status_notifications"
    ADD CONSTRAINT "booking_request_status_notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."account_contexts"("user_id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_submission_attempts"
    ADD CONSTRAINT "booking_request_submission_attempt_request_fkey" FOREIGN KEY ("booking_request_id") REFERENCES "public"."booking_requests"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_submission_attempts"
    ADD CONSTRAINT "booking_request_submission_attempts_customer_user_id_fkey" FOREIGN KEY ("customer_user_id") REFERENCES "public"."account_contexts"("user_id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_request_submission_attempts"
    ADD CONSTRAINT "booking_request_submission_attempts_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."owner_application_cottage_profiles"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_requests"
    ADD CONSTRAINT "booking_requests_booking_period_commitment_id_fkey" FOREIGN KEY ("booking_period_commitment_id") REFERENCES "public"."cottage_booking_period_commitments"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_requests"
    ADD CONSTRAINT "booking_requests_booking_snapshot_id_fkey" FOREIGN KEY ("booking_snapshot_id") REFERENCES "public"."booking_snapshots"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_requests"
    ADD CONSTRAINT "booking_requests_customer_user_id_fkey" FOREIGN KEY ("customer_user_id") REFERENCES "public"."account_contexts"("user_id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_requests"
    ADD CONSTRAINT "booking_requests_outcome_actor_user_id_fkey" FOREIGN KEY ("outcome_actor_user_id") REFERENCES "public"."account_contexts"("user_id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_requests"
    ADD CONSTRAINT "booking_requests_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "public"."account_contexts"("user_id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_requests"
    ADD CONSTRAINT "booking_requests_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."owner_application_cottage_profiles"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_snapshots"
    ADD CONSTRAINT "booking_snapshots_customer_user_id_fkey" FOREIGN KEY ("customer_user_id") REFERENCES "public"."account_contexts"("user_id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."booking_snapshots"
    ADD CONSTRAINT "booking_snapshots_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."owner_application_cottage_profiles"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_booking_period_commitments"
    ADD CONSTRAINT "cottage_booking_period_commit_schedule_revision_id_profile_fkey" FOREIGN KEY ("schedule_revision_id", "profile_id") REFERENCES "public"."cottage_shift_schedule_revisions"("id", "profile_id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_booking_period_commitments"
    ADD CONSTRAINT "cottage_booking_period_commitments_customer_user_id_fkey" FOREIGN KEY ("customer_user_id") REFERENCES "public"."account_contexts"("user_id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_booking_period_commitments"
    ADD CONSTRAINT "cottage_booking_period_commitments_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."owner_application_cottage_profiles"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_booking_period_occupancies"
    ADD CONSTRAINT "cottage_booking_period_occupa_booking_period_commitment_id_fkey" FOREIGN KEY ("booking_period_commitment_id", "schedule_revision_id") REFERENCES "public"."cottage_booking_period_commitments"("id", "schedule_revision_id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."cottage_booking_period_occupancies"
    ADD CONSTRAINT "cottage_booking_period_occupa_schedule_revision_id_shift_i_fkey" FOREIGN KEY ("schedule_revision_id", "shift_id") REFERENCES "public"."cottage_shifts"("schedule_revision_id", "id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_inventory_availability"
    ADD CONSTRAINT "cottage_inventory_availability_schedule_revision_id_fkey" FOREIGN KEY ("schedule_revision_id") REFERENCES "public"."cottage_shift_schedule_revisions"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_inventory_commitments"
    ADD CONSTRAINT "cottage_inventory_commitments_booking_period_fkey" FOREIGN KEY ("booking_period_commitment_id") REFERENCES "public"."cottage_booking_period_commitments"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."cottage_inventory_date_price_overrides"
    ADD CONSTRAINT "cottage_inventory_date_price_override_schedule_revision_id_fkey" FOREIGN KEY ("schedule_revision_id") REFERENCES "public"."cottage_shift_schedule_revisions"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_inventory_standard_prices"
    ADD CONSTRAINT "cottage_inventory_standard_prices_schedule_revision_id_fkey" FOREIGN KEY ("schedule_revision_id") REFERENCES "public"."cottage_shift_schedule_revisions"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_inventory_weekday_price_overrides"
    ADD CONSTRAINT "cottage_inventory_weekday_price_overr_schedule_revision_id_fkey" FOREIGN KEY ("schedule_revision_id") REFERENCES "public"."cottage_shift_schedule_revisions"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_marketplace_listings"
    ADD CONSTRAINT "cottage_marketplace_listings_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."owner_application_cottage_profiles"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."cottage_ownership"
    ADD CONSTRAINT "cottage_ownership_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "public"."account_contexts"("user_id");

ALTER TABLE ONLY "public"."cottage_profile_administrator_audit"
    ADD CONSTRAINT "cottage_profile_administrator_audit_administrator_user_id_fkey" FOREIGN KEY ("administrator_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_profile_administrator_audit"
    ADD CONSTRAINT "cottage_profile_administrator_audit_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."owner_application_cottage_profiles"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."owner_application_cottage_profiles"
    ADD CONSTRAINT "cottage_profile_current_shift_schedule_fkey" FOREIGN KEY ("current_shift_schedule_id", "id") REFERENCES "public"."cottage_shift_schedule_revisions"("id", "profile_id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_profile_localized_decisions"
    ADD CONSTRAINT "cottage_profile_localized_decisions_administrator_user_id_fkey" FOREIGN KEY ("administrator_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_profile_localized_decisions"
    ADD CONSTRAINT "cottage_profile_localized_decisions_localized_revision_id_fkey" FOREIGN KEY ("localized_revision_id") REFERENCES "public"."cottage_profile_localized_revisions"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_profile_localized_decisions"
    ADD CONSTRAINT "cottage_profile_localized_decisions_review_cycle_id_fkey" FOREIGN KEY ("review_cycle_id") REFERENCES "public"."cottage_profile_review_cycles"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_profile_localized_heads"
    ADD CONSTRAINT "cottage_profile_localized_heads_localized_revision_id_fkey" FOREIGN KEY ("localized_revision_id") REFERENCES "public"."cottage_profile_localized_revisions"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_profile_localized_heads"
    ADD CONSTRAINT "cottage_profile_localized_heads_review_cycle_id_fkey" FOREIGN KEY ("review_cycle_id") REFERENCES "public"."cottage_profile_review_cycles"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_profile_localized_revisions"
    ADD CONSTRAINT "cottage_profile_localized_revisions_administrator_user_id_fkey" FOREIGN KEY ("administrator_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_profile_localized_revisions"
    ADD CONSTRAINT "cottage_profile_localized_revisions_review_cycle_id_fkey" FOREIGN KEY ("review_cycle_id") REFERENCES "public"."cottage_profile_review_cycles"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_profile_photos"
    ADD CONSTRAINT "cottage_profile_photo_profile_owner_fkey" FOREIGN KEY ("profile_id", "owner_user_id") REFERENCES "public"."owner_application_cottage_profiles"("id", "owner_user_id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_profile_photos"
    ADD CONSTRAINT "cottage_profile_photos_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_profile_publication_decisions"
    ADD CONSTRAINT "cottage_profile_publication_decision_administrator_user_id_fkey" FOREIGN KEY ("administrator_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_profile_publication_decisions"
    ADD CONSTRAINT "cottage_profile_publication_decisions_review_cycle_id_fkey" FOREIGN KEY ("review_cycle_id") REFERENCES "public"."cottage_profile_review_cycles"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_profile_review_cycles"
    ADD CONSTRAINT "cottage_profile_review_cycles_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "public"."account_contexts"("user_id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_profile_review_cycles"
    ADD CONSTRAINT "cottage_profile_review_cycles_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."owner_application_cottage_profiles"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_profile_review_cycles"
    ADD CONSTRAINT "cottage_profile_review_cycles_remediation_publication_id_fkey" FOREIGN KEY ("remediation_publication_id") REFERENCES "public"."cottage_publication_snapshots"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_profile_review_cycles"
    ADD CONSTRAINT "cottage_profile_review_cycles_source_revision_id_fkey" FOREIGN KEY ("source_revision_id") REFERENCES "public"."cottage_profile_source_revisions"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_profile_review_photos"
    ADD CONSTRAINT "cottage_profile_review_photos_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "public"."cottage_profile_photos"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_profile_review_photos"
    ADD CONSTRAINT "cottage_profile_review_photos_review_cycle_id_fkey" FOREIGN KEY ("review_cycle_id") REFERENCES "public"."cottage_profile_review_cycles"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_profile_source_revisions"
    ADD CONSTRAINT "cottage_profile_source_revisions_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "public"."account_contexts"("user_id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_profile_source_revisions"
    ADD CONSTRAINT "cottage_profile_source_revisions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."owner_application_cottage_profiles"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_profile_translation_attempts"
    ADD CONSTRAINT "cottage_profile_translation_a_expected_localized_revision__fkey" FOREIGN KEY ("expected_localized_revision_id") REFERENCES "public"."cottage_profile_localized_revisions"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_profile_translation_attempts"
    ADD CONSTRAINT "cottage_profile_translation_a_review_cycle_id_source_revis_fkey" FOREIGN KEY ("review_cycle_id", "source_revision_id") REFERENCES "public"."cottage_profile_review_cycles"("id", "source_revision_id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_profile_translation_human_reviews"
    ADD CONSTRAINT "cottage_profile_translation_human_re_administrator_user_id_fkey" FOREIGN KEY ("administrator_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_profile_translation_human_reviews"
    ADD CONSTRAINT "cottage_profile_translation_human_re_generated_revision_id_fkey" FOREIGN KEY ("generated_revision_id") REFERENCES "public"."cottage_profile_localized_revisions"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_profile_translation_human_reviews"
    ADD CONSTRAINT "cottage_profile_translation_human_reviews_review_cycle_id_fkey" FOREIGN KEY ("review_cycle_id") REFERENCES "public"."cottage_profile_review_cycles"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_publication_localizations"
    ADD CONSTRAINT "cottage_publication_localizations_localized_revision_id_fkey" FOREIGN KEY ("localized_revision_id") REFERENCES "public"."cottage_profile_localized_revisions"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_publication_localizations"
    ADD CONSTRAINT "cottage_publication_localizations_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "public"."cottage_publication_snapshots"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_publication_media"
    ADD CONSTRAINT "cottage_publication_media_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "public"."cottage_profile_photos"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_publication_media"
    ADD CONSTRAINT "cottage_publication_media_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "public"."cottage_publication_snapshots"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_publication_snapshots"
    ADD CONSTRAINT "cottage_publication_snapshots_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."owner_application_cottage_profiles"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_publication_snapshots"
    ADD CONSTRAINT "cottage_publication_snapshots_review_cycle_id_fkey" FOREIGN KEY ("review_cycle_id") REFERENCES "public"."cottage_profile_review_cycles"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_shift_schedule_revisions"
    ADD CONSTRAINT "cottage_shift_schedule_revisions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."owner_application_cottage_profiles"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_shifts"
    ADD CONSTRAINT "cottage_shifts_schedule_revision_id_fkey" FOREIGN KEY ("schedule_revision_id") REFERENCES "public"."cottage_shift_schedule_revisions"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_translation_quality_reports"
    ADD CONSTRAINT "cottage_translation_quality_re_remediation_review_cycle_id_fkey" FOREIGN KEY ("remediation_review_cycle_id") REFERENCES "public"."cottage_profile_review_cycles"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_translation_quality_reports"
    ADD CONSTRAINT "cottage_translation_quality_reports_localized_revision_id_fkey" FOREIGN KEY ("localized_revision_id") REFERENCES "public"."cottage_profile_localized_revisions"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_translation_quality_reports"
    ADD CONSTRAINT "cottage_translation_quality_reports_reporter_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_translation_quality_reports"
    ADD CONSTRAINT "cottage_translation_quality_reports_review_cycle_id_fkey" FOREIGN KEY ("review_cycle_id") REFERENCES "public"."cottage_profile_review_cycles"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."cottage_translation_usage_results"
    ADD CONSTRAINT "cottage_translation_usage_results_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "public"."cottage_translation_usage_reservations"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."owner_application_cottage_profiles"
    ADD CONSTRAINT "owner_application_cottage_pro_submitted_source_revision_id_fkey" FOREIGN KEY ("submitted_source_revision_id") REFERENCES "public"."cottage_profile_source_revisions"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."owner_application_cottage_profiles"
    ADD CONSTRAINT "owner_application_cottage_profiles_application_owner_fkey" FOREIGN KEY ("application_id", "owner_user_id") REFERENCES "public"."owner_applications"("id", "owner_user_id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."owner_application_cottage_profiles"
    ADD CONSTRAINT "owner_application_cottage_profiles_current_publication_id_fkey" FOREIGN KEY ("current_publication_id") REFERENCES "public"."cottage_publication_snapshots"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."owner_application_cottage_profiles"
    ADD CONSTRAINT "owner_application_cottage_profiles_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "public"."account_contexts"("user_id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."owner_application_information_requests"
    ADD CONSTRAINT "owner_application_information_request_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."owner_application_information_requests"
    ADD CONSTRAINT "owner_application_information_requests_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."owner_applications"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."owner_application_notices"
    ADD CONSTRAINT "owner_application_notices_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."owner_applications"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."owner_application_notices"
    ADD CONSTRAINT "owner_application_notices_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "public"."account_contexts"("user_id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."owner_application_renewal_work"
    ADD CONSTRAINT "owner_application_renewal_work_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."owner_applications"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."owner_application_renewal_work"
    ADD CONSTRAINT "owner_application_renewal_work_verification_record_id_fkey" FOREIGN KEY ("verification_record_id") REFERENCES "public"."owner_application_verification_records"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."owner_application_transitions"
    ADD CONSTRAINT "owner_application_transitions_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."owner_application_transitions"
    ADD CONSTRAINT "owner_application_transitions_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."owner_applications"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."owner_application_verification_records"
    ADD CONSTRAINT "owner_application_verification_records_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."owner_applications"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."owner_application_verification_records"
    ADD CONSTRAINT "owner_application_verification_records_reviewer_user_id_fkey" FOREIGN KEY ("reviewer_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."owner_applications"
    ADD CONSTRAINT "owner_applications_current_verification_record_id_fkey" FOREIGN KEY ("current_verification_record_id") REFERENCES "public"."owner_application_verification_records"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."owner_applications"
    ADD CONSTRAINT "owner_applications_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "public"."account_contexts"("user_id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."owner_request_notifications"
    ADD CONSTRAINT "owner_request_notifications_booking_request_id_fkey" FOREIGN KEY ("booking_request_id") REFERENCES "public"."booking_requests"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."owner_request_notifications"
    ADD CONSTRAINT "owner_request_notifications_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "public"."account_contexts"("user_id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."owner_verification_document_access_grants"
    ADD CONSTRAINT "owner_verification_document_access_grants_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY "public"."owner_verification_document_access_grants"
    ADD CONSTRAINT "owner_verification_document_access_grants_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."owner_verification_documents"("id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY "public"."owner_verification_document_audit"
    ADD CONSTRAINT "owner_verification_document_audit_access_grant_id_fkey" FOREIGN KEY ("access_grant_id") REFERENCES "public"."owner_verification_document_access_grants"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."owner_verification_document_audit"
    ADD CONSTRAINT "owner_verification_document_audit_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY "public"."owner_verification_document_audit"
    ADD CONSTRAINT "owner_verification_document_audit_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."owner_verification_documents"("id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY "public"."owner_verification_document_cleanup"
    ADD CONSTRAINT "owner_verification_document_cleanup_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY "public"."owner_verification_document_cleanup"
    ADD CONSTRAINT "owner_verification_document_cleanup_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."owner_applications"("id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY "public"."owner_verification_document_cleanup"
    ADD CONSTRAINT "owner_verification_document_cleanup_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."owner_verification_documents"("id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY "public"."owner_verification_document_cleanup"
    ADD CONSTRAINT "owner_verification_document_cleanup_replacement_cleanup_id_fkey" FOREIGN KEY ("replacement_cleanup_id") REFERENCES "public"."owner_verification_document_cleanup"("id") ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ONLY "public"."owner_verification_document_versions"
    ADD CONSTRAINT "owner_verification_document_versions_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."owner_applications"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."owner_verification_documents"
    ADD CONSTRAINT "owner_verification_documents_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "public"."owner_applications"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."privileged_sign_in_attempts"
    ADD CONSTRAINT "privileged_sign_in_attempts_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;

ALTER TABLE ONLY "public"."payment_provider_operations"
    ADD CONSTRAINT "simulated_payment_provider_opera_claim_id_claim_generation_fkey" FOREIGN KEY ("claim_id", "claim_generation") REFERENCES "public"."booking_request_authorization_claims"("id", "generation") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."payment_provider_operations"
    ADD CONSTRAINT "simulated_payment_provider_operations_recovery_attempt_id_fkey" FOREIGN KEY ("recovery_attempt_id") REFERENCES "public"."booking_request_payment_recovery_attempts"("id") ON DELETE RESTRICT;

ALTER TABLE ONLY "public"."payment_provider_observations" ADD CONSTRAINT "payment_provider_observations_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY "public"."payment_provider_observations" ADD CONSTRAINT "payment_provider_observations_operation_fkey" FOREIGN KEY (operation_id) REFERENCES public.payment_provider_operations(id) ON DELETE RESTRICT;
ALTER TABLE ONLY "public"."payment_provider_observations" ADD CONSTRAINT "payment_provider_observations_event_key" UNIQUE (provider,environment,merchant_id,terminal_id,event_id);
ALTER TABLE ONLY "public"."simulated_payment_effects" ADD CONSTRAINT "simulated_payment_effects_pkey" PRIMARY KEY (operation_id);
ALTER TABLE ONLY "public"."simulated_payment_effects" ADD CONSTRAINT "simulated_payment_effects_idempotency_key" UNIQUE (provider,environment,merchant_id,terminal_id,idempotency_key);

ALTER TABLE ONLY "public"."booking_requests"
    ADD CONSTRAINT "booking_requests_distinct_participants" CHECK ((customer_user_id <> owner_user_id));

ALTER TABLE public.booking_cancellations ADD CONSTRAINT booking_cancellations_booking_request_id_fkey FOREIGN KEY (booking_request_id) REFERENCES public.booking_requests(id) ON DELETE RESTRICT;
ALTER TABLE public.booking_cancellations ADD CONSTRAINT booking_cancellations_booking_confirmation_id_fkey FOREIGN KEY (booking_confirmation_id) REFERENCES public.booking_confirmations(id) ON DELETE RESTRICT;
ALTER TABLE public.booking_cancellations ADD CONSTRAINT booking_cancellations_capture_operation_id_fkey FOREIGN KEY (capture_operation_id) REFERENCES public.payment_provider_operations(id) ON DELETE RESTRICT;
ALTER TABLE public.booking_cancellations ADD CONSTRAINT booking_cancellations_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.account_contexts(user_id) ON DELETE RESTRICT;
ALTER TABLE public.booking_cancellation_incidents ADD CONSTRAINT booking_cancellation_incidents_cancellation_id_fkey FOREIGN KEY (cancellation_id) REFERENCES public.booking_cancellations(id) ON DELETE RESTRICT;
ALTER TABLE public.booking_lifecycle_outcomes ADD CONSTRAINT booking_lifecycle_outcomes_pkey PRIMARY KEY (id);
ALTER TABLE public.booking_lifecycle_outcomes ADD CONSTRAINT booking_lifecycle_outcomes_booking_request_key UNIQUE (booking_request_id);
ALTER TABLE public.booking_lifecycle_outcomes ADD CONSTRAINT booking_lifecycle_outcomes_command_key UNIQUE (command_id);
ALTER TABLE public.booking_lifecycle_outcomes ADD CONSTRAINT booking_lifecycle_outcomes_request_fkey FOREIGN KEY (booking_request_id) REFERENCES public.booking_requests(id) ON DELETE RESTRICT;
ALTER TABLE public.booking_lifecycle_outcomes ADD CONSTRAINT booking_lifecycle_outcomes_confirmation_fkey FOREIGN KEY (booking_confirmation_id) REFERENCES public.booking_confirmations(id) ON DELETE RESTRICT;
ALTER TABLE public.booking_lifecycle_outcomes ADD CONSTRAINT booking_lifecycle_outcomes_commitment_fkey FOREIGN KEY (booking_period_commitment_id) REFERENCES public.cottage_booking_period_commitments(id) ON DELETE RESTRICT;
ALTER TABLE public.booking_lifecycle_outcomes ADD CONSTRAINT booking_lifecycle_outcomes_actor_fkey FOREIGN KEY (actor_user_id) REFERENCES public.account_contexts(user_id) ON DELETE RESTRICT;
ALTER TABLE public.booking_incidents ADD CONSTRAINT booking_incidents_pkey PRIMARY KEY (id);
ALTER TABLE public.booking_incidents ADD CONSTRAINT booking_incidents_command_key UNIQUE (command_id);
ALTER TABLE public.booking_incidents ADD CONSTRAINT booking_incidents_request_fkey FOREIGN KEY (booking_request_id) REFERENCES public.booking_requests(id) ON DELETE RESTRICT;
ALTER TABLE public.booking_incidents ADD CONSTRAINT booking_incidents_confirmation_fkey FOREIGN KEY (booking_confirmation_id) REFERENCES public.booking_confirmations(id) ON DELETE RESTRICT;
ALTER TABLE public.booking_incidents ADD CONSTRAINT booking_incidents_customer_fkey FOREIGN KEY (customer_user_id) REFERENCES public.account_contexts(user_id) ON DELETE RESTRICT;
ALTER TABLE public.booking_incidents ADD CONSTRAINT booking_incidents_owner_fkey FOREIGN KEY (owner_user_id) REFERENCES public.account_contexts(user_id) ON DELETE RESTRICT;
ALTER TABLE public.booking_incidents ADD CONSTRAINT booking_incidents_profile_fkey FOREIGN KEY (profile_id) REFERENCES public.owner_application_cottage_profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.booking_incidents ADD CONSTRAINT booking_incidents_actor_fkey FOREIGN KEY (actor_user_id) REFERENCES public.account_contexts(user_id) ON DELETE RESTRICT;
ALTER TABLE public.booking_completion_maturity ADD CONSTRAINT booking_completion_maturity_pkey PRIMARY KEY (booking_request_id);
ALTER TABLE public.booking_completion_maturity ADD CONSTRAINT booking_completion_maturity_request_fkey FOREIGN KEY (booking_request_id) REFERENCES public.booking_requests(id) ON DELETE RESTRICT;
ALTER TABLE public.booking_completion_maturity ADD CONSTRAINT booking_completion_maturity_lifecycle_fkey FOREIGN KEY (lifecycle_outcome_id) REFERENCES public.booking_lifecycle_outcomes(id) ON DELETE RESTRICT;
ALTER TABLE public.booking_completion_maturity ADD CONSTRAINT booking_completion_maturity_cancellation_fkey FOREIGN KEY (cancellation_id) REFERENCES public.booking_cancellations(id) ON DELETE RESTRICT;
ALTER TABLE public.booking_cancellation_administrator_audit ADD CONSTRAINT booking_cancellation_administrator_audit_cancellation_id_fkey FOREIGN KEY (cancellation_id) REFERENCES public.booking_cancellations(id) ON DELETE RESTRICT;
ALTER TABLE public.booking_cancellation_administrator_audit ADD CONSTRAINT booking_cancellation_administrator_audit_administrator_user_id_fkey FOREIGN KEY (administrator_user_id) REFERENCES public.account_contexts(user_id) ON DELETE RESTRICT;
ALTER TABLE public.booking_notification_events ADD CONSTRAINT booking_notification_events_booking_request_id_fkey FOREIGN KEY (booking_request_id) REFERENCES public.booking_requests(id) ON DELETE RESTRICT;
ALTER TABLE public.booking_notification_events ADD CONSTRAINT booking_notification_events_cancellation_id_fkey FOREIGN KEY (cancellation_id) REFERENCES public.booking_cancellations(id) ON DELETE RESTRICT;
ALTER TABLE public.booking_notification_events ADD CONSTRAINT booking_notification_events_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES public.booking_receipts(id) ON DELETE RESTRICT;
ALTER TABLE public.booking_notification_events ADD CONSTRAINT booking_notification_events_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES public.account_contexts(user_id) ON DELETE RESTRICT;

ALTER TABLE public.booking_refund_intents ADD CONSTRAINT booking_refund_intents_request_fkey FOREIGN KEY (booking_request_id) REFERENCES public.booking_requests(id);
ALTER TABLE public.booking_refund_intents ADD CONSTRAINT booking_refund_intents_capture_fkey FOREIGN KEY (capture_operation_id) REFERENCES public.payment_provider_operations(id);
ALTER TABLE public.booking_refund_intents ADD CONSTRAINT booking_refund_intents_cancellation_fkey FOREIGN KEY (cancellation_id) REFERENCES public.booking_cancellations(id);
ALTER TABLE public.booking_refund_intents ADD CONSTRAINT booking_refund_intents_actor_fkey FOREIGN KEY (actor_user_id) REFERENCES auth.users(id);
ALTER TABLE public.booking_refund_attempts ADD CONSTRAINT booking_refund_attempts_intent_fkey FOREIGN KEY (refund_intent_id) REFERENCES public.booking_refund_intents(id);
ALTER TABLE public.booking_notification_events ADD CONSTRAINT booking_notification_events_refund_fkey FOREIGN KEY (refund_intent_id) REFERENCES public.booking_refund_intents(id);

ALTER TABLE ONLY public.booking_confirmation_notification_work ADD CONSTRAINT booking_confirmation_notification_work_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.booking_notification_events(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.booking_confirmation_notification_attempts ADD CONSTRAINT booking_confirmation_notification_attempts_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.booking_notification_events(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.fictional_booking_confirmation_notification_effects ADD CONSTRAINT fictional_booking_confirmation_notification_effects_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.booking_notification_events(id) ON DELETE RESTRICT;

ALTER TABLE public.booking_payout_commands ADD CONSTRAINT booking_payout_commands_pkey PRIMARY KEY (id);
ALTER TABLE public.booking_payout_commands ADD CONSTRAINT booking_payout_commands_request_fkey FOREIGN KEY (booking_request_id) REFERENCES public.booking_requests(id) ON DELETE RESTRICT;
ALTER TABLE public.booking_payout_commands ADD CONSTRAINT booking_payout_commands_capture_fkey FOREIGN KEY (capture_operation_id) REFERENCES public.payment_provider_operations(id) ON DELETE RESTRICT;
ALTER TABLE public.booking_payout_commands ADD CONSTRAINT booking_payout_commands_subject_fkey FOREIGN KEY (subject_id) REFERENCES public.booking_payout_commands(id) ON DELETE RESTRICT;
ALTER TABLE public.booking_payout_commands ADD CONSTRAINT booking_payout_commands_actor_fkey FOREIGN KEY (actor_user_id) REFERENCES public.account_contexts(user_id) ON DELETE RESTRICT;
ALTER TABLE public.booking_refund_intents ADD CONSTRAINT booking_refund_intents_dispute_fkey FOREIGN KEY (dispute_resolution_id) REFERENCES public.booking_payout_commands(id) ON DELETE RESTRICT;
