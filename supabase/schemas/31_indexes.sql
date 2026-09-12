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

CREATE UNIQUE INDEX "booking_request_active_claim_occupancy_unique" ON "public"."booking_request_authorization_claim_occupancies" USING "btree" ("schedule_revision_id", "shift_id", "service_day") WHERE "active";

CREATE UNIQUE INDEX "booking_request_authorization_movement_unique" ON "public"."booking_request_submission_attempts" USING "btree" ("authorization_provider", "authorization_environment", "authorization_merchant_id", "authorization_terminal_id", "authorization_movement_reference") WHERE ("authorization_movement_reference" IS NOT NULL);

CREATE UNIQUE INDEX "booking_request_authorization_provider_reference_unique" ON "public"."booking_request_submission_attempts" USING "btree" ("authorization_provider", "authorization_environment", "authorization_merchant_id", "authorization_terminal_id", "authorization_provider_reference") WHERE ("authorization_provider_reference" IS NOT NULL);

CREATE UNIQUE INDEX "booking_request_authorization_provider_request_unique" ON "public"."booking_request_submission_attempts" USING "btree" ("authorization_provider", "authorization_environment", "authorization_merchant_id", "authorization_terminal_id", "authorization_provider_request_id") WHERE ("authorization_provider_request_id" IS NOT NULL);

CREATE INDEX "booking_request_payment_history_root_sequence_idx" ON "public"."booking_request_payment_history" USING "btree" ("payment_lifecycle_id", "sequence");

CREATE UNIQUE INDEX "booking_request_payment_recovery_one_active" ON "public"."booking_request_payment_recovery_attempts" USING "btree" ("booking_request_id") WHERE ("state" <> 'safely_failed'::"text");

CREATE INDEX "booking_request_payment_required_expiry_due" ON "public"."booking_request_payment_required_expiry_work" USING "btree" ("last_evaluated_at", "booking_request_id") WHERE ("state" <> 'complete'::"text");

CREATE UNIQUE INDEX "booking_request_release_movement_unique" ON "public"."booking_request_submission_attempts" USING "btree" ("authorization_provider", "authorization_environment", "authorization_merchant_id", "authorization_terminal_id", "release_movement_reference") WHERE ("release_movement_reference" IS NOT NULL);

CREATE UNIQUE INDEX "booking_request_release_provider_reference_unique" ON "public"."booking_request_submission_attempts" USING "btree" ("authorization_provider", "authorization_environment", "authorization_merchant_id", "authorization_terminal_id", "release_provider_reference") WHERE ("release_provider_reference" IS NOT NULL);

CREATE UNIQUE INDEX "booking_request_release_provider_request_unique" ON "public"."booking_request_submission_attempts" USING "btree" ("authorization_provider", "authorization_environment", "authorization_merchant_id", "authorization_terminal_id", "release_provider_request_id") WHERE ("release_provider_request_id" IS NOT NULL);

CREATE UNIQUE INDEX "booking_request_submission_active_intent_unique" ON "public"."booking_request_submission_attempts" USING "btree" ("customer_user_id", "intent_fingerprint") WHERE "intent_dedupe_active";

CREATE INDEX "booking_request_submission_customer_idx" ON "public"."booking_request_submission_attempts" USING "btree" ("customer_user_id", "created_at" DESC);

CREATE INDEX "booking_requests_customer_idx" ON "public"."booking_requests" USING "btree" ("customer_user_id", "created_at" DESC);

CREATE INDEX "booking_requests_owner_idx" ON "public"."booking_requests" USING "btree" ("owner_user_id", "response_deadline");

CREATE UNIQUE INDEX "cottage_booking_period_active_occupancy_unique" ON "public"."cottage_booking_period_occupancies" USING "btree" ("schedule_revision_id", "shift_id", "service_day") WHERE "active";

CREATE INDEX "cottage_ownership_owner_user_id_idx" ON "public"."cottage_ownership" USING "btree" ("owner_user_id");

CREATE INDEX "cottage_profile_additional_creation_rate_idx" ON "public"."owner_application_cottage_profiles" USING "btree" ("owner_user_id", "created_at") WHERE ("application_id" IS NULL);

CREATE INDEX "cottage_profile_administrator_audit_profile_id_idx" ON "public"."cottage_profile_administrator_audit" USING "btree" ("profile_id", "occurred_at" DESC);

CREATE UNIQUE INDEX "cottage_profile_one_active_human_review" ON "public"."cottage_profile_translation_human_reviews" USING "btree" ("review_cycle_id", "locale") WHERE ("state" = 'active'::"text");

CREATE UNIQUE INDEX "cottage_profile_one_active_publication_remediation" ON "public"."cottage_profile_review_cycles" USING "btree" ("remediation_publication_id") WHERE (("remediation_publication_id" IS NOT NULL) AND ("state" = 'in_review'::"text"));

CREATE UNIQUE INDEX "cottage_profile_one_active_review_cycle" ON "public"."cottage_profile_review_cycles" USING "btree" ("profile_id") WHERE ("state" = 'in_review'::"text");

CREATE UNIQUE INDEX "cottage_profile_one_pending_translation" ON "public"."cottage_profile_translation_attempts" USING "btree" ("review_cycle_id", "target_language") WHERE ("state" = 'pending'::"text");

CREATE INDEX "cottage_profile_open_capacity_idx" ON "public"."owner_application_cottage_profiles" USING "btree" ("owner_user_id", "status") WHERE (("current_publication_id" IS NULL) AND ("status" <> 'abandoned'::"public"."cottage_profile_status"));

CREATE INDEX "cottage_profile_photos_active_profile_idx" ON "public"."cottage_profile_photos" USING "btree" ("profile_id", "created_at", "id") WHERE "is_active";

CREATE INDEX "cottage_profile_photos_profile_id_idx" ON "public"."cottage_profile_photos" USING "btree" ("profile_id", "created_at", "id");

CREATE INDEX "cottage_translation_usage_reservation_month_idx" ON "public"."cottage_translation_usage_reservations" USING "btree" ("billing_month", "reserved_at");

CREATE INDEX "owner_application_cottage_profiles_owner_user_id_idx" ON "public"."owner_application_cottage_profiles" USING "btree" ("owner_user_id", "created_at", "id");

CREATE INDEX "owner_application_notices_owner_idx" ON "public"."owner_application_notices" USING "btree" ("owner_user_id", "created_at" DESC);

CREATE UNIQUE INDEX "owner_application_one_open_information_request_idx" ON "public"."owner_application_information_requests" USING "btree" ("application_id") WHERE ("responded_at" IS NULL);

CREATE UNIQUE INDEX "owner_application_one_open_renewal_idx" ON "public"."owner_application_renewal_work" USING "btree" ("application_id") WHERE ("status" = ANY (ARRAY['open'::"text", 'submitted'::"text"]));

CREATE INDEX "owner_application_transitions_history_idx" ON "public"."owner_application_transitions" USING "btree" ("application_id", "occurred_at", "id");

CREATE INDEX "owner_request_notifications_owner_idx" ON "public"."owner_request_notifications" USING "btree" ("owner_user_id", "created_at" DESC);

CREATE INDEX "owner_verification_document_access_grants_document_id_idx" ON "public"."owner_verification_document_access_grants" USING "btree" ("document_id");

CREATE INDEX "owner_verification_document_access_grants_pending_idx" ON "public"."owner_verification_document_access_grants" USING "btree" ("status", "complete_before");

CREATE INDEX "owner_verification_document_audit_document_id_idx" ON "public"."owner_verification_document_audit" USING "btree" ("document_id", "occurred_at" DESC);

CREATE INDEX "owner_verification_document_cleanup_application_id_idx" ON "public"."owner_verification_document_cleanup" USING "btree" ("application_id");

CREATE INDEX "owner_verification_document_cleanup_document_id_idx" ON "public"."owner_verification_document_cleanup" USING "btree" ("document_id");

CREATE INDEX "owner_verification_document_cleanup_pending_idx" ON "public"."owner_verification_document_cleanup" USING "btree" ("status", "requested_at");

CREATE INDEX "owner_verification_documents_application_id_idx" ON "public"."owner_verification_documents" USING "btree" ("application_id");

CREATE INDEX "privileged_sign_in_attempts_actor_user_id_idx" ON "public"."privileged_sign_in_attempts" USING "btree" ("actor_user_id", "attempted_at" DESC);

CREATE INDEX "privileged_sign_in_attempts_attempted_at_idx" ON "public"."privileged_sign_in_attempts" USING "btree" ("attempted_at");

CREATE INDEX payment_provider_observations_operation_idx ON public.payment_provider_observations USING btree (operation_id,received_at,id);
CREATE INDEX "booking_confirmation_notification_work_due_idx" ON "public"."booking_confirmation_notification_work" USING "btree" ("updated_at", "receipt_id") WHERE ("state" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'uncertain'::"text"]));

CREATE INDEX "booking_confirmation_notification_attempts_receipt_idx" ON "public"."booking_confirmation_notification_attempts" USING "btree" ("receipt_id", "recorded_at", "id");

CREATE UNIQUE INDEX booking_notification_events_preparation_receipt_idx ON public.booking_notification_events(receipt_id) WHERE event_kind='preparation_reminder';

CREATE INDEX booking_incidents_booking_request_recorded_idx ON public.booking_incidents (booking_request_id,recorded_at,id);
CREATE INDEX booking_lifecycle_outcomes_period_end_idx ON public.booking_lifecycle_outcomes (effective_period_end,booking_request_id);
