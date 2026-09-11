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

CREATE TABLE IF NOT EXISTS "public"."booking_requests" (
    "id" "uuid" NOT NULL,
    "booking_request_reference" "text" NOT NULL,
    "customer_user_id" "uuid" NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "booking_snapshot_id" "uuid" NOT NULL,
    "booking_period_commitment_id" "uuid" NOT NULL,
    "payment_lifecycle_id" "uuid" NOT NULL,
    "customer_name" "text" NOT NULL,
    "party_size" smallint NOT NULL,
    "booking_note" "text",
    "status" "text" NOT NULL,
    "response_deadline" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "outcome_actor_user_id" "uuid",
    "decline_reason" "text",
    "decline_note" "text",
    "outcome_fingerprint" "text",
    "settled_at" timestamp with time zone,
    CONSTRAINT "booking_requests_booking_note_check" CHECK ((("booking_note" = "btrim"("booking_note")) AND (("char_length"("booking_note") >= 1) AND ("char_length"("booking_note") <= 500)))),
    CONSTRAINT "booking_requests_booking_request_reference_check" CHECK (("booking_request_reference" ~ '^RC-REQ-[A-F0-9]{16}$'::"text")),
    CONSTRAINT "booking_requests_check" CHECK (("response_deadline" = ("created_at" + '04:00:00'::interval))),
    CONSTRAINT "booking_requests_customer_name_check" CHECK ((("customer_name" = "btrim"("customer_name")) AND (("char_length"("customer_name") >= 2) AND ("char_length"("customer_name") <= 120)))),
    CONSTRAINT "booking_requests_decline_reason_check" CHECK (("decline_reason" = ANY (ARRAY['cottage_unavailable'::"text", 'cannot_accommodate_request'::"text", 'other'::"text"]))),
    CONSTRAINT "booking_requests_outcome_fingerprint_check" CHECK ((("outcome_fingerprint" IS NULL) OR ("outcome_fingerprint" ~ '^[0-9a-f]{64}$'::"text"))),
    CONSTRAINT "booking_requests_party_size_check" CHECK ((("party_size" >= 1) AND ("party_size" <= 1000))),
    CONSTRAINT "booking_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'accepted'::"text", 'declined'::"text", 'withdrawn'::"text", 'expired'::"text"])))
);

ALTER TABLE "public"."booking_requests" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."booking_request_payment_required_expiry_operations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "expiry_work_id" "uuid" NOT NULL,
    "booking_request_id" "uuid" NOT NULL,
    "owner" "text" NOT NULL,
    "recovery_operation_id" "uuid",
    "provider_operation_id" "uuid",
    "authorization_claim_id" "uuid" NOT NULL,
    "authorization_claim_generation" integer NOT NULL,
    "authorization_payment_lifecycle_id" "uuid" NOT NULL,
    "authorization_logical_operation_id" "text" NOT NULL,
    "authorization_physical_attempt_id" "text" NOT NULL,
    "predecessor_movement_reference" "text" NOT NULL,
    "predecessor_outcome_at" timestamp with time zone NOT NULL,
    "release_logical_operation_id" "text" NOT NULL,
    "release_physical_attempt_id" "text" NOT NULL,
    "provider_idempotency_key" "text" NOT NULL,
    "amount_fils" bigint NOT NULL,
    "currency" "text" NOT NULL,
    "provider" "text" NOT NULL,
    "environment" "text" NOT NULL,
    "merchant_id" "text" NOT NULL,
    "terminal_id" "text" NOT NULL,
    "request_fingerprint" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "operation_kind" "text" DEFAULT 'release'::"text" NOT NULL,
    "capture_provider_operation_id" "uuid",
    "capture_occurred_at" timestamp with time zone,
    CONSTRAINT "booking_request_payment_requ_authorization_claim_generati_check" CHECK (("authorization_claim_generation" > 0)),
    CONSTRAINT "booking_request_payment_required_expi_request_fingerprint_check" CHECK (("request_fingerprint" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "booking_request_payment_required_expiry_op_operation_kind_check" CHECK (("operation_kind" = ANY (ARRAY['release'::"text", 'refund'::"text"]))),
    CONSTRAINT "booking_request_payment_required_expiry_opera_amount_fils_check" CHECK (("amount_fils" > 0)),
    CONSTRAINT "booking_request_payment_required_expiry_operatio_currency_check" CHECK (("currency" = 'IQD'::"text")),
    CONSTRAINT "booking_request_payment_required_expiry_operations_check" CHECK (((("owner" = 'expiry'::"text") AND ("recovery_operation_id" IS NULL)) OR (("owner" = 'recovery'::"text") AND ("recovery_operation_id" IS NOT NULL) AND ("provider_operation_id" IS NOT NULL)))),
    CONSTRAINT "booking_request_payment_required_expiry_operations_owner_check" CHECK (("owner" = ANY (ARRAY['expiry'::"text", 'recovery'::"text"]))),
    CONSTRAINT "expiry_corrective_capture_binding" CHECK (((("operation_kind" = 'release'::"text") AND ("capture_provider_operation_id" IS NULL) AND ("capture_occurred_at" IS NULL)) OR (("operation_kind" = 'refund'::"text") AND ("capture_provider_operation_id" IS NOT NULL) AND ("capture_occurred_at" IS NOT NULL) AND ("owner" = 'expiry'::"text"))))
);

ALTER TABLE "public"."booking_request_payment_required_expiry_operations" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."booking_request_capture_work" (
    "booking_request_id" "uuid" NOT NULL,
    "attempt_id" "uuid" NOT NULL,
    "authorization_claim_id" "uuid" NOT NULL,
    "authorization_claim_generation" integer NOT NULL,
    "payment_lifecycle_id" "uuid" NOT NULL,
    "authorization_logical_operation_id" "text" NOT NULL,
    "authorization_physical_attempt_id" "text" NOT NULL,
    "capture_logical_operation_id" "text" NOT NULL,
    "capture_physical_attempt_id" "text" NOT NULL,
    "amount_fils" bigint NOT NULL,
    "currency" "text" NOT NULL,
    "provider" "text" NOT NULL,
    "environment" "text" NOT NULL,
    "merchant_id" "text" NOT NULL,
    "terminal_id" "text" NOT NULL,
    "provider_idempotency_key" "text" NOT NULL,
    "request_fingerprint" "text" NOT NULL,
    "state" "text" DEFAULT 'queued'::"text" NOT NULL,
    "lease_generation" bigint DEFAULT 0 NOT NULL,
    "lease_token" "uuid",
    "lease_expires_at" timestamp with time zone,
    "outcome" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "recovery_operation_id" "uuid",
    "payment_required_recorded_at" timestamp with time zone,
    "payment_required_deadline" timestamp with time zone,
    CONSTRAINT "booking_request_capture_work_amount_fils_check" CHECK (("amount_fils" > 0)),
    CONSTRAINT "booking_request_capture_work_authorization_claim_generati_check" CHECK (("authorization_claim_generation" > 0)),
    CONSTRAINT "booking_request_capture_work_currency_check" CHECK (("currency" = 'IQD'::"text")),
    CONSTRAINT "booking_request_capture_work_request_fingerprint_check" CHECK (("request_fingerprint" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "booking_request_capture_work_state_shape" CHECK (((("state" = 'queued'::"text") AND ("lease_generation" = 0) AND ("lease_token" IS NULL) AND ("lease_expires_at" IS NULL) AND ("outcome" IS NULL) AND ("completed_at" IS NULL) AND ("payment_required_recorded_at" IS NULL) AND ("payment_required_deadline" IS NULL)) OR (("state" = 'processing'::"text") AND ("lease_generation" > 0) AND ("lease_token" IS NOT NULL) AND ("lease_expires_at" IS NOT NULL) AND ("outcome" IS NULL) AND ("completed_at" IS NULL) AND ("payment_required_recorded_at" IS NULL) AND ("payment_required_deadline" IS NULL)) OR (("state" = 'complete'::"text") AND ("lease_generation" > 0) AND ("lease_token" IS NULL) AND ("lease_expires_at" IS NULL) AND ("outcome" IS NOT NULL) AND ("outcome" = 'succeeded'::"text") AND ("completed_at" IS NOT NULL) AND ("payment_required_recorded_at" IS NULL) AND ("payment_required_deadline" IS NULL)) OR (("state" = 'payment_required'::"text") AND ("lease_generation" > 0) AND ("lease_token" IS NOT NULL) AND ("lease_expires_at" IS NOT NULL) AND ("outcome" IS NOT NULL) AND ("outcome" = 'failed'::"text") AND ("completed_at" IS NOT NULL) AND ("payment_required_recorded_at" IS NOT NULL) AND ("payment_required_deadline" IS NOT NULL) AND ("payment_required_deadline" = ("payment_required_recorded_at" + '00:20:00'::interval)))))
);

ALTER TABLE "public"."booking_request_capture_work" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."booking_request_payment_recovery_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_request_id" "uuid" NOT NULL,
    "command_key" "uuid" NOT NULL,
    "generation" integer NOT NULL,
    "replacement_method" "text" NOT NULL,
    "state" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "booking_request_payment_recovery_attem_replacement_method_check" CHECK (("replacement_method" = 'simulated-replacement'::"text")),
    CONSTRAINT "booking_request_payment_recovery_attempts_generation_check" CHECK (("generation" > 0)),
    CONSTRAINT "booking_request_payment_recovery_attempts_state_check" CHECK (("state" = ANY (ARRAY['admitted'::"text", 'original_released'::"text", 'replacement_authorized'::"text", 'capture_failed'::"text", 'blocked'::"text", 'safely_failed'::"text", 'succeeded'::"text", 'late_succeeded'::"text"])))
);

ALTER TABLE "public"."booking_request_payment_recovery_attempts" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."payment_provider_operations" (
    "id" "uuid" NOT NULL,
    "claim_id" "uuid" NOT NULL,
    "claim_generation" integer NOT NULL,
    "operation_kind" "text" NOT NULL,
    "provider" "text" NOT NULL,
    "environment" "text" NOT NULL,
    "merchant_id" "text" NOT NULL,
    "terminal_id" "text" NOT NULL,
    "provider_idempotency_key" "text" NOT NULL,
    "request_fingerprint" "text" NOT NULL,
    "payment_lifecycle_id" "uuid" NOT NULL,
    "logical_operation_id" "text" NOT NULL,
    "physical_attempt_id" "text" NOT NULL,
    "amount_fils" bigint NOT NULL,
    "currency" "text" NOT NULL,
    "original_outcome" "text",
    "current_outcome" "text",
    "provider_request_id" "text",
    "provider_reference" "text",
    "movement_reference" "text",
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "capture_execution_permit" "jsonb",
    "admission" "jsonb" NOT NULL,
    "original_outcome_at" timestamp with time zone,
    "executed_at" timestamp with time zone,
    "recorded_at" timestamp with time zone,
    "evidence_provenance" "text" NOT NULL,
    "recovery_attempt_id" "uuid",
    "authoritative_outcome_at" timestamp with time zone,
    CONSTRAINT "payment_provider_admission_shape" CHECK ((jsonb_typeof(admission) = 'object' AND admission ?& array['purpose','permit','notBefore','notAfter'])),
    CONSTRAINT "payment_provider_evidence_provenance" CHECK ((evidence_provenance IN ('admitted','fictional-provider','provider-event','legacy-simulated'))),
    CONSTRAINT "payment_provider_pending_evidence" CHECK (((current_outcome IS NULL AND original_outcome IS NULL AND recorded_at IS NULL AND provider_request_id IS NULL AND provider_reference IS NULL AND movement_reference IS NULL AND authoritative_outcome_at IS NULL AND evidence_provenance='admitted') OR (current_outcome IS NOT NULL AND original_outcome IS NOT NULL AND recorded_at IS NOT NULL AND evidence_provenance<>'admitted'))),
    CONSTRAINT "payment_provider_result_references" CHECK (((current_outcome IS NULL OR (current_outcome='not-executed' AND provider_request_id IS NULL AND provider_reference IS NULL AND movement_reference IS NULL AND authoritative_outcome_at IS NULL) OR (current_outcome IN ('succeeded','failed','indeterminate') AND length(provider_request_id)>0 AND length(provider_reference)>0 AND ((current_outcome='failed' AND movement_reference IS NULL) OR (current_outcome<>'failed' AND length(movement_reference)>0))))) IS TRUE),
    CONSTRAINT "simulated_capture_execution_permit_check" CHECK (((("operation_kind" = 'capture'::"text") AND ("capture_execution_permit" IS NOT NULL) AND ("jsonb_typeof"("capture_execution_permit") = 'object'::"text") AND ((("capture_execution_permit" @> '{"purpose": "booking-request-capture"}'::"jsonb") AND ("capture_execution_permit" ?& ARRAY['purpose'::"text", 'bookingRequestId'::"text", 'submissionAttemptId'::"text", 'authorizationClaimId'::"text", 'authorizationClaimGeneration'::"text", 'paymentLifecycleId'::"text", 'authorizationLogicalOperationId'::"text", 'authorizationPhysicalAttemptId'::"text", 'captureLogicalOperationId'::"text", 'capturePhysicalAttemptId'::"text", 'amountFils'::"text", 'currency'::"text", 'providerIdentity'::"text", 'idempotencyKey'::"text", 'requestFingerprint'::"text", 'workId'::"text", 'leaseGeneration'::"text", 'leaseToken'::"text", 'notAfter'::"text"]) AND (("capture_execution_permit" - ARRAY['purpose'::"text", 'bookingRequestId'::"text", 'submissionAttemptId'::"text", 'authorizationClaimId'::"text", 'authorizationClaimGeneration'::"text", 'paymentLifecycleId'::"text", 'authorizationLogicalOperationId'::"text", 'authorizationPhysicalAttemptId'::"text", 'captureLogicalOperationId'::"text", 'capturePhysicalAttemptId'::"text", 'amountFils'::"text", 'currency'::"text", 'providerIdentity'::"text", 'idempotencyKey'::"text", 'requestFingerprint'::"text", 'workId'::"text", 'leaseGeneration'::"text", 'leaseToken'::"text", 'notAfter'::"text"]) = '{}'::"jsonb") AND ("jsonb_strip_nulls"("capture_execution_permit") = "capture_execution_permit") AND ("jsonb_typeof"(("capture_execution_permit" -> 'providerIdentity'::"text")) = 'object'::"text") AND (("capture_execution_permit" -> 'providerIdentity'::"text") ?& ARRAY['provider'::"text", 'environment'::"text", 'merchantId'::"text", 'terminalId'::"text"]) AND ((("capture_execution_permit" -> 'providerIdentity'::"text") - ARRAY['provider'::"text", 'environment'::"text", 'merchantId'::"text", 'terminalId'::"text"]) = '{}'::"jsonb")) OR (("capture_execution_permit" @> '{"step": "replacement-capture", "purpose": "booking-request-payment-recovery"}'::"jsonb") AND ("capture_execution_permit" ?& ARRAY['purpose'::"text", 'attemptId'::"text", 'generation'::"text", 'step'::"text", 'operationId'::"text", 'idempotencyKey'::"text", 'notAfter'::"text", 'binding'::"text"]) AND (("capture_execution_permit" - ARRAY['purpose'::"text", 'attemptId'::"text", 'generation'::"text", 'step'::"text", 'operationId'::"text", 'idempotencyKey'::"text", 'notAfter'::"text", 'binding'::"text"]) = '{}'::"jsonb") AND ("jsonb_strip_nulls"("capture_execution_permit") = "capture_execution_permit")))) OR (("operation_kind" <> 'capture'::"text") AND ("capture_execution_permit" IS NULL)))),
    CONSTRAINT "simulated_payment_provider_operations_amount_fils_check" CHECK (("amount_fils" > 0)),
    CONSTRAINT "simulated_payment_provider_operations_currency_check" CHECK (("currency" = 'IQD'::"text")),
    CONSTRAINT "simulated_payment_provider_operations_current_outcome_check" CHECK (("current_outcome" = ANY (ARRAY['succeeded'::"text", 'failed'::"text", 'indeterminate'::"text", 'not-executed'::"text"]))),
    CONSTRAINT "simulated_payment_provider_operations_environment_check" CHECK ((length(btrim("environment")) > 0)),
    CONSTRAINT "simulated_payment_provider_operations_operation_kind_check" CHECK (("operation_kind" = ANY (ARRAY['authorization'::"text", 'capture'::"text", 'release'::"text", 'refund'::"text"]))),
    CONSTRAINT "simulated_payment_provider_operations_original_outcome_check" CHECK (("original_outcome" = ANY (ARRAY['succeeded'::"text", 'failed'::"text", 'indeterminate'::"text", 'not-executed'::"text"]))),
    CONSTRAINT "simulated_payment_provider_operations_request_fingerprint_check" CHECK (("request_fingerprint" ~ '^[0-9a-f]{64}$'::"text"))
);

ALTER TABLE "public"."payment_provider_operations" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."booking_request_payment_required_expiry_work" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_request_id" "uuid" NOT NULL,
    "payment_required_deadline" timestamp with time zone NOT NULL,
    "state" "text" DEFAULT 'processing'::"text" NOT NULL,
    "diagnostic_reason" "text",
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "last_evaluated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "completed_at" timestamp with time zone,
    "quarantined_at" timestamp with time zone,
    "quarantine_reason" "text",
    CONSTRAINT "booking_request_payment_required_expiry_diagnostic_reason_check" CHECK ((("diagnostic_reason" IS NULL) OR (("diagnostic_reason" = "btrim"("diagnostic_reason")) AND (("char_length"("diagnostic_reason") >= 1) AND ("char_length"("diagnostic_reason") <= 120))))),
    CONSTRAINT "booking_request_payment_required_expiry_work_check" CHECK ((("state" = 'complete'::"text") = ("completed_at" IS NOT NULL))),
    CONSTRAINT "booking_request_payment_required_expiry_work_check1" CHECK ((("state" <> 'processing'::"text") OR ("diagnostic_reason" IS NULL))),
    CONSTRAINT "booking_request_payment_required_expiry_work_state_check" CHECK (("state" = ANY (ARRAY['processing'::"text", 'attention_required'::"text", 'quarantined'::"text", 'complete'::"text"]))),
    CONSTRAINT "payment_quarantine_shape" CHECK (((("state" = 'quarantined'::"text") AND ("quarantined_at" IS NOT NULL) AND ("quarantine_reason" IS NOT NULL) AND (("length"("btrim"("quarantine_reason")) >= 1) AND ("length"("btrim"("quarantine_reason")) <= 120))) OR (("state" <> 'quarantined'::"text") AND ("quarantined_at" IS NULL) AND ("quarantine_reason" IS NULL))))
);

ALTER TABLE "public"."booking_request_payment_required_expiry_work" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."booking_request_release_work" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_request_id" "uuid" NOT NULL,
    "attempt_id" "uuid" NOT NULL,
    "outcome" "text" NOT NULL,
    "actor_user_id" "uuid",
    "decline_reason" "text",
    "decline_note" "text",
    "outcome_fingerprint" "text" NOT NULL,
    "state" "text" DEFAULT 'processing'::"text" NOT NULL,
    "lease_generation" bigint DEFAULT 0 NOT NULL,
    "lease_token" "uuid",
    "lease_expires_at" timestamp with time zone,
    "active_operation_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "booking_request_release_work_check" CHECK ((("outcome" = 'declined'::"text") = ("decline_reason" IS NOT NULL))),
    CONSTRAINT "booking_request_release_work_check1" CHECK ((("state" = 'complete'::"text") = ("completed_at" IS NOT NULL))),
    CONSTRAINT "booking_request_release_work_check2" CHECK ((("lease_token" IS NULL) = ("lease_expires_at" IS NULL))),
    CONSTRAINT "booking_request_release_work_check3" CHECK ((("state" = 'processing'::"text") OR ("lease_token" IS NULL))),
    CONSTRAINT "booking_request_release_work_decline_reason_check" CHECK (("decline_reason" = ANY (ARRAY['cottage_unavailable'::"text", 'cannot_accommodate_request'::"text", 'other'::"text"]))),
    CONSTRAINT "booking_request_release_work_lease_generation_check" CHECK (("lease_generation" >= 0)),
    CONSTRAINT "booking_request_release_work_outcome_check" CHECK (("outcome" = ANY (ARRAY['declined'::"text", 'withdrawn'::"text", 'expired'::"text"]))),
    CONSTRAINT "booking_request_release_work_outcome_fingerprint_check" CHECK (("outcome_fingerprint" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "booking_request_release_work_state_check" CHECK (("state" = ANY (ARRAY['processing'::"text", 'complete'::"text"])))
);

ALTER TABLE "public"."booking_request_release_work" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."booking_request_submission_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_user_id" "uuid" NOT NULL,
    "idempotency_key" "uuid" NOT NULL,
    "payment_lifecycle_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "locale" "public"."cottage_profile_source_language" NOT NULL,
    "public_slug" "text" NOT NULL,
    "requested_search" "jsonb" NOT NULL,
    "quote_fingerprint" "text" NOT NULL,
    "quote_payload" "jsonb" NOT NULL,
    "intent_fingerprint" "text" NOT NULL,
    "intent_payload" "jsonb" NOT NULL,
    "payment_snapshot" "jsonb",
    "authorization_provider" "text",
    "authorization_environment" "text",
    "authorization_merchant_id" "text",
    "authorization_terminal_id" "text",
    "authorization_provider_request_id" "text",
    "authorization_provider_reference" "text",
    "authorization_movement_reference" "text",
    "release_provider_request_id" "text",
    "release_provider_reference" "text",
    "release_movement_reference" "text",
    "state" "text" NOT NULL,
    "booking_request_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "intent_dedupe_active" boolean DEFAULT true NOT NULL,
    CONSTRAINT "booking_request_submission_attempts_check" CHECK (("num_nulls"("authorization_provider", "authorization_environment", "authorization_merchant_id", "authorization_terminal_id") = ANY (ARRAY[0, 4]))),
    CONSTRAINT "booking_request_submission_attempts_check1" CHECK ((("authorization_provider_request_id" IS NULL) = ("authorization_provider_reference" IS NULL))),
    CONSTRAINT "booking_request_submission_attempts_check2" CHECK ((("authorization_movement_reference" IS NULL) OR ("authorization_provider_request_id" IS NOT NULL))),
    CONSTRAINT "booking_request_submission_attempts_check3" CHECK ((("release_provider_request_id" IS NULL) = ("release_provider_reference" IS NULL))),
    CONSTRAINT "booking_request_submission_attempts_check4" CHECK ((("release_movement_reference" IS NULL) OR ("release_provider_request_id" IS NOT NULL))),
    CONSTRAINT "booking_request_submission_attempts_intent_fingerprint_check" CHECK (("intent_fingerprint" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "booking_request_submission_attempts_quote_fingerprint_check" CHECK (("quote_fingerprint" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "booking_request_submission_attempts_state_check" CHECK (("state" = ANY (ARRAY['authorizing'::"text", 'authorized'::"text", 'authorization_failed'::"text", 'reconciliation_required'::"text", 'releasing'::"text", 'released'::"text", 'expired'::"text", 'finalized'::"text"])))
);

ALTER TABLE "public"."booking_request_submission_attempts" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."booking_request_payment_recovery_operations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "recovery_attempt_id" "uuid" NOT NULL,
    "step" "text" NOT NULL,
    "operation_generation" integer DEFAULT 1 NOT NULL,
    "provider_operation_id" "uuid" NOT NULL,
    "outcome" "text" NOT NULL,
    "authoritative_outcome_at" timestamp with time zone,
    "execution_permit" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "booking_request_payment_recovery_ope_operation_generation_check" CHECK (("operation_generation" = 1)),
    CONSTRAINT "booking_request_payment_recovery_operations_check" CHECK ((("outcome" = 'indeterminate'::"text") = ("authoritative_outcome_at" IS NULL))),
    CONSTRAINT "booking_request_payment_recovery_operations_outcome_check" CHECK (("outcome" = ANY (ARRAY['succeeded'::"text", 'failed'::"text", 'indeterminate'::"text"]))),
    CONSTRAINT "booking_request_payment_recovery_operations_step_check" CHECK (("step" = ANY (ARRAY['original-release'::"text", 'replacement-authorization'::"text", 'replacement-capture'::"text", 'replacement-release'::"text"])))
);

ALTER TABLE "public"."booking_request_payment_recovery_operations" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."booking_confirmations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_request_id" "uuid" NOT NULL,
    "booking_snapshot_id" "uuid" NOT NULL,
    "booking_period_commitment_id" "uuid" NOT NULL,
    "capture_operation_id" "uuid" NOT NULL,
    "confirmed_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL
);

ALTER TABLE "public"."booking_confirmations" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."booking_receipts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_confirmation_id" "uuid" NOT NULL,
    "booking_snapshot_id" "uuid" NOT NULL,
    "recipient_role" "text" NOT NULL,
    "recipient_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    CONSTRAINT "booking_receipts_recipient_role_check" CHECK (("recipient_role" = ANY (ARRAY['customer'::"text", 'cottage_owner'::"text"])))
);

ALTER TABLE "public"."booking_receipts" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."booking_confirmation_notification_work" (
    "receipt_id" "uuid" NOT NULL,
    event_id uuid,
    notification_id uuid GENERATED ALWAYS AS (coalesce(event_id, receipt_id)) STORED NOT NULL,
    "booking_request_id" "uuid" NOT NULL,
    "booking_request_reference" "text" NOT NULL,
    "booking_reference" "text" NOT NULL,
    "recipient_user_id" "uuid" NOT NULL,
    "recipient_role" "text" NOT NULL,
    "logical_id" "text" NOT NULL,
    "notice_locale" "public"."cottage_profile_source_language" NOT NULL,
    "template_version" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "payload_sha256" "text" NOT NULL,
    "state" "text" DEFAULT 'pending'::"text" NOT NULL,
    "lease_generation" bigint DEFAULT 0 NOT NULL,
    "lease_token" "uuid",
    "lease_expires_at" timestamp with time zone,
    "last_outcome" "text",
    "supplier_delivery_reference" "text",
    "delivered_at" timestamp with time zone,
    "suppressed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "booking_confirmation_notification_work_binding" CHECK (recipient_role IN ('customer','cottage_owner') AND payload_sha256 ~ '^[0-9a-f]{64}$' AND ((event_id IS NULL AND logical_id='paid-confirmation:'||receipt_id AND template_version='paid-confirmation-v1') OR (event_id IS NOT NULL AND logical_id='booking-event:'||event_id AND template_version='booking-event-v1'))),
    CONSTRAINT "booking_confirmation_notification_work_state" CHECK (("state" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'retryable'::"text", 'uncertain'::"text", 'delivered'::"text", 'suppressed'::"text"]))),
    CONSTRAINT "booking_confirmation_notification_work_state_shape" CHECK (((("state" = 'pending'::"text") AND ("lease_token" IS NULL) AND ("lease_expires_at" IS NULL) AND ("last_outcome" IS NULL) AND ("supplier_delivery_reference" IS NULL) AND ("delivered_at" IS NULL) AND ("suppressed_at" IS NULL)) OR (("state" = 'processing'::"text") AND ("lease_generation" > 0) AND ("lease_token" IS NOT NULL) AND ("lease_expires_at" IS NOT NULL) AND ("delivered_at" IS NULL) AND ("suppressed_at" IS NULL)) OR (("state" = 'retryable'::"text") AND ("lease_token" IS NULL) AND ("lease_expires_at" IS NULL) AND ("last_outcome" = 'failed'::"text") AND ("supplier_delivery_reference" IS NULL) AND ("delivered_at" IS NULL) AND ("suppressed_at" IS NULL)) OR (("state" = 'uncertain'::"text") AND ("lease_token" IS NULL) AND ("lease_expires_at" IS NULL) AND ("last_outcome" = 'unknown'::"text") AND ("delivered_at" IS NULL) AND ("suppressed_at" IS NULL)) OR (("state" = 'delivered'::"text") AND ("lease_token" IS NULL) AND ("lease_expires_at" IS NULL) AND ("last_outcome" = 'delivered'::"text") AND ("supplier_delivery_reference" IS NOT NULL) AND ("delivered_at" IS NOT NULL) AND ("suppressed_at" IS NULL)) OR (("state" = 'suppressed'::"text") AND ("lease_token" IS NULL) AND ("lease_expires_at" IS NULL) AND ("last_outcome" = 'suppressed'::"text") AND ("supplier_delivery_reference" IS NULL) AND ("delivered_at" IS NULL) AND ("suppressed_at" IS NOT NULL)))),
    CONSTRAINT "booking_confirmation_notification_work_payload" CHECK (jsonb_typeof(payload)='object' AND payload ?& array['kind','title','body','bookingReference','detailsPath','linkLabel','fictional'] AND payload->'fictional'='true'::jsonb AND ((event_id IS NULL AND payload->>'kind'='paid-confirmation' AND payload-array['kind','title','body','bookingReference','detailsPath','linkLabel','fictional']='{}'::jsonb) OR (event_id IS NOT NULL AND payload->>'kind' IN ('cancelled','refund_requested','refund_returned','refund_attention') AND payload ? 'allocation' AND payload-array['kind','title','body','bookingReference','detailsPath','linkLabel','fictional','allocation']='{}'::jsonb)))
);

ALTER TABLE "public"."booking_confirmation_notification_work" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."booking_confirmation_notification_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "receipt_id" "uuid" NOT NULL,
    event_id uuid,
    notification_id uuid GENERATED ALWAYS AS (coalesce(event_id, receipt_id)) STORED NOT NULL,
    "lease_generation" bigint,
    "lease_token" "uuid",
    "action" "text" NOT NULL,
    "outcome" "text" NOT NULL,
    "effect_id" "uuid",
    "recorded_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "booking_confirmation_notification_attempt_action" CHECK (("action" = ANY (ARRAY['query'::"text", 'execute'::"text", 'complete'::"text", 'failure'::"text", 'user-retry'::"text"]))),
    CONSTRAINT "booking_confirmation_notification_attempt_outcome" CHECK (("outcome" = ANY (ARRAY['not-found'::"text", 'delivered'::"text", 'failed'::"text", 'unknown'::"text", 'suppressed'::"text", 'queued'::"text"]))),
    CONSTRAINT "booking_confirmation_notification_attempt_lease" CHECK ((("lease_generation" IS NULL) = ("lease_token" IS NULL)))
);

ALTER TABLE "public"."booking_confirmation_notification_attempts" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."fictional_booking_confirmation_notification_effects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "supplier" "text" NOT NULL,
    "environment" "text" NOT NULL,
    "logical_id" "text" NOT NULL,
    "receipt_id" "uuid" NOT NULL,
    event_id uuid,
    notification_id uuid GENERATED ALWAYS AS (coalesce(event_id, receipt_id)) STORED NOT NULL,
    "booking_request_id" "uuid" NOT NULL,
    "booking_request_reference" "text" NOT NULL,
    "booking_reference" "text" NOT NULL,
    "recipient_user_id" "uuid" NOT NULL,
    "recipient_role" "text" NOT NULL,
    "notice_locale" "public"."cottage_profile_source_language" NOT NULL,
    "template_version" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "payload_sha256" "text" NOT NULL,
    "execution_lease_generation" bigint NOT NULL,
    "execution_lease_token" "uuid" NOT NULL,
    "supplier_delivery_reference" "text" NOT NULL,
    "executed_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "fictional_booking_confirmation_notification_effect_identity" CHECK (supplier='fictional-notifications' AND environment='local-test' AND recipient_role IN ('customer','cottage_owner') AND payload_sha256 ~ '^[0-9a-f]{64}$' AND execution_lease_generation>0 AND ((event_id IS NULL AND logical_id='paid-confirmation:'||receipt_id AND template_version='paid-confirmation-v1') OR (event_id IS NOT NULL AND logical_id='booking-event:'||event_id AND template_version='booking-event-v1')))
);

ALTER TABLE "public"."fictional_booking_confirmation_notification_effects" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."booking_request_authorization_claim_items" (
    "claim_id" "uuid" NOT NULL,
    "unit_kind" "public"."cottage_inventory_unit_kind" NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "service_day" "date" NOT NULL,
    "price_iqd" bigint NOT NULL,
    CONSTRAINT "booking_request_authorization_claim_items_price_iqd_check" CHECK (("price_iqd" > 0))
);

ALTER TABLE "public"."booking_request_authorization_claim_items" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."booking_request_authorization_claim_occupancies" (
    "claim_id" "uuid" NOT NULL,
    "schedule_revision_id" "uuid" NOT NULL,
    "shift_id" "uuid" NOT NULL,
    "service_day" "date" NOT NULL,
    "active" boolean DEFAULT true NOT NULL
);

ALTER TABLE "public"."booking_request_authorization_claim_occupancies" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."booking_request_authorization_claims" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "attempt_id" "uuid" NOT NULL,
    "generation" integer DEFAULT 1 NOT NULL,
    "state_revision" bigint DEFAULT 1 NOT NULL,
    "state" "public"."booking_request_authorization_claim_state" NOT NULL,
    "customer_user_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "schedule_revision_id" "uuid" NOT NULL,
    "payment_lifecycle_id" "uuid" NOT NULL,
    "logical_operation_id" "text" NOT NULL,
    "physical_attempt_id" "text" NOT NULL,
    "amount_fils" bigint NOT NULL,
    "currency" "text" NOT NULL,
    "provider" "text" NOT NULL,
    "environment" "text" NOT NULL,
    "merchant_id" "text" NOT NULL,
    "terminal_id" "text" NOT NULL,
    "provider_idempotency_key" "text" NOT NULL,
    "quote_fingerprint" "text" NOT NULL,
    "intent_fingerprint" "text" NOT NULL,
    "access_ranges" "tstzmultirange" NOT NULL,
    "not_after" timestamp with time zone NOT NULL,
    "reconciliation_expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "booking_request_authorization_claims_access_ranges_check" CHECK ((NOT "isempty"("access_ranges"))),
    CONSTRAINT "booking_request_authorization_claims_amount_fils_check" CHECK (("amount_fils" > 0)),
    CONSTRAINT "booking_request_authorization_claims_check" CHECK (("reconciliation_expires_at" <= "not_after")),
    CONSTRAINT "booking_request_authorization_claims_currency_check" CHECK (("currency" = 'IQD'::"text")),
    CONSTRAINT "booking_request_authorization_claims_generation_check" CHECK (("generation" > 0)),
    CONSTRAINT "booking_request_authorization_claims_intent_fingerprint_check" CHECK (("intent_fingerprint" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "booking_request_authorization_claims_quote_fingerprint_check" CHECK (("quote_fingerprint" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "booking_request_authorization_claims_state_revision_check" CHECK (("state_revision" > 0))
);

ALTER TABLE "public"."booking_request_authorization_claims" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."booking_request_authorization_reconciliation_outbox" (
    "claim_id" "uuid" NOT NULL,
    "claim_generation" integer NOT NULL,
    "observed_state_revision" bigint NOT NULL,
    "state" "text" NOT NULL,
    "lease_token" "uuid",
    "lease_expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "booking_request_authorization_reconciliation_outbox_check" CHECK ((("lease_token" IS NULL) = ("lease_expires_at" IS NULL))),
    CONSTRAINT "booking_request_authorization_reconciliation_outbox_check1" CHECK ((("state" = 'pending'::"text") OR ("lease_token" IS NULL))),
    CONSTRAINT "booking_request_authorization_reconciliation_outbox_state_check" CHECK (("state" = ANY (ARRAY['pending'::"text", 'complete'::"text"])))
);

ALTER TABLE "public"."booking_request_authorization_reconciliation_outbox" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."booking_request_confirmation_invalidations" (
    "booking_request_id" "uuid" NOT NULL,
    "confirmation_id" "uuid" NOT NULL,
    "expiry_work_id" "uuid" NOT NULL,
    "provider_operation_id" "uuid" NOT NULL,
    "reason" "text" NOT NULL,
    "invalidated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "booking_request_confirmation_invalidations_reason_check" CHECK (("reason" = ANY (ARRAY['late-capture'::"text", 'conflicting-evidence'::"text", 'unresolved-evidence'::"text"])))
);

ALTER TABLE "public"."booking_request_confirmation_invalidations" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."booking_request_payment_correction_observations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_request_id" "uuid" NOT NULL,
    "provider_operation_id" "uuid" NOT NULL,
    "receipt_identity" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "conflict" boolean NOT NULL,
    "received_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "booking_request_payment_correction_obser_receipt_identity_check" CHECK ((("length"("receipt_identity") >= 1) AND ("length"("receipt_identity") <= 200)))
);

ALTER TABLE "public"."booking_request_payment_correction_observations" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."booking_request_payment_history" (
    "sequence" bigint NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payment_lifecycle_id" "uuid" NOT NULL,
    "booking_request_id" "uuid",
    "kind" "text" NOT NULL,
    "source" "text" NOT NULL,
    "provenance" "text" NOT NULL,
    "operation_kind" "text",
    "logical_operation_id" "text",
    "physical_attempt_id" "text",
    "operation_generation" bigint,
    "recovery_generation" bigint,
    "from_state" "text",
    "to_state" "text",
    "outcome" "text",
    "reason_code" "text",
    "provider_operation_id" "uuid",
    "provider_request_id" "text",
    "provider_reference" "text",
    "movement_reference" "text",
    "amount_fils" bigint,
    "provider_occurred_at" timestamp with time zone,
    "received_at" timestamp with time zone,
    "source_recorded_at" timestamp with time zone,
    "recorded_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "booking_request_payment_history_amount_fils_check" CHECK ((("amount_fils" IS NULL) OR ("amount_fils" > 0))),
    CONSTRAINT "booking_request_payment_history_kind_check" CHECK (("kind" = ANY (ARRAY['logical-operation'::"text", 'physical-attempt'::"text", 'retry'::"text", 'receipt-observation'::"text", 'state-transition'::"text", 'terminal-outcome'::"text", 'quarantine'::"text"]))),
    CONSTRAINT "booking_request_payment_history_operation_kind_check" CHECK (("operation_kind" = ANY (ARRAY['authorization'::"text", 'capture'::"text", 'release'::"text", 'refund'::"text", 'original-release'::"text", 'replacement-authorization'::"text", 'replacement-capture'::"text", 'replacement-release'::"text", 'expiry'::"text", 'confirmation'::"text", 'invalidation'::"text"]))),
    CONSTRAINT "booking_request_payment_history_provenance_check" CHECK (("provenance" = ANY (ARRAY['observed'::"text", 'imported'::"text"]))),
    CONSTRAINT "booking_request_payment_history_source_check" CHECK (("source" = ANY (ARRAY['history-boundary'::"text", 'authorization-claim'::"text", 'provider-operation'::"text", 'release-work'::"text", 'release-operation'::"text", 'capture-work'::"text", 'recovery-attempt'::"text", 'recovery-operation'::"text", 'expiry-work'::"text", 'expiry-operation'::"text", 'booking-request'::"text", 'confirmation'::"text", 'confirmation-invalidation'::"text", 'provider-receipt'::"text"])))
);

ALTER TABLE "public"."booking_request_payment_history" OWNER TO "postgres";

ALTER TABLE "public"."booking_request_payment_history" ALTER COLUMN "sequence" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."booking_request_payment_history_sequence_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE IF NOT EXISTS "public"."booking_request_provider_operation_identities" (
    "attempt_id" "uuid" NOT NULL,
    "operation_kind" "text" NOT NULL,
    "provider" "text" NOT NULL,
    "environment" "text" NOT NULL,
    "merchant_id" "text" NOT NULL,
    "terminal_id" "text" NOT NULL,
    "provider_request_id" "text" NOT NULL,
    "provider_reference" "text" NOT NULL,
    "movement_reference" "text",
    CONSTRAINT "booking_request_provider_operation_identit_operation_kind_check" CHECK (("operation_kind" = ANY (ARRAY['authorization'::"text", 'release'::"text", 'capture'::"text"])))
);

ALTER TABLE "public"."booking_request_provider_operation_identities" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."booking_request_release_operations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "work_id" "uuid" NOT NULL,
    "attempt_id" "uuid" NOT NULL,
    "operation_generation" integer NOT NULL,
    "payment_lifecycle_id" "uuid" NOT NULL,
    "logical_operation_id" "text" NOT NULL,
    "physical_attempt_id" "text" NOT NULL,
    "amount_fils" bigint NOT NULL,
    "currency" "text" NOT NULL,
    "provider" "text" NOT NULL,
    "environment" "text" NOT NULL,
    "merchant_id" "text" NOT NULL,
    "terminal_id" "text" NOT NULL,
    "provider_idempotency_key" "text" NOT NULL,
    "request_fingerprint" "text" NOT NULL,
    "state" "text" NOT NULL,
    "provider_outcome" "text" NOT NULL,
    "provider_request_id" "text",
    "provider_reference" "text",
    "movement_reference" "text",
    "retry_safe" boolean DEFAULT false NOT NULL,
    "execution_started_at" timestamp with time zone NOT NULL,
    "result_recorded_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "booking_request_release_operations_amount_fils_check" CHECK (("amount_fils" > 0)),
    CONSTRAINT "booking_request_release_operations_currency_check" CHECK (("currency" = 'IQD'::"text")),
    CONSTRAINT "booking_request_release_operations_operation_generation_check" CHECK (("operation_generation" > 0)),
    CONSTRAINT "booking_request_release_operations_provider_outcome_check" CHECK (("provider_outcome" = ANY (ARRAY['unknown'::"text", 'not_executed'::"text", 'failed'::"text", 'indeterminate'::"text", 'succeeded'::"text"]))),
    CONSTRAINT "booking_request_release_operations_request_fingerprint_check" CHECK (("request_fingerprint" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "booking_request_release_operations_state_check" CHECK (("state" = ANY (ARRAY['executing'::"text", 'reconcile_required'::"text", 'retryable'::"text", 'succeeded'::"text"])))
);

ALTER TABLE "public"."booking_request_release_operations" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."booking_request_status_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_request_id" "uuid" NOT NULL,
    "recipient_user_id" "uuid" NOT NULL,
    "status" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "seen_at" timestamp with time zone,
    CONSTRAINT "booking_request_status_notifications_status_check" CHECK (("status" = ANY (ARRAY['accepted'::"text", 'declined'::"text", 'withdrawn'::"text", 'expired'::"text", 'payment-required'::"text"])))
);

ALTER TABLE "public"."booking_request_status_notifications" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."booking_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_user_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "quote_fingerprint" "text" NOT NULL,
    "intent_fingerprint" "text" NOT NULL,
    "quote_payload" "jsonb" NOT NULL,
    "intent_payload" "jsonb" NOT NULL,
    "booking_terms_version" "text" NOT NULL,
    "booking_terms_locale" "public"."cottage_profile_source_language" NOT NULL,
    "booking_terms_body" "text" NOT NULL,
    "booking_terms_sha256" "text" NOT NULL,
    "cancellation_policy_version" "text" NOT NULL,
    "acceptance_locale" "public"."cottage_profile_source_language" NOT NULL,
    "acceptance_evidence" "jsonb" NOT NULL,
    "acceptance_evidence_fingerprint" "text" NOT NULL,
    "marketplace_commission_rate_basis_points" smallint NOT NULL,
    "marketplace_commission_amount_fils" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "booking_snapshots_acceptance_evidence_fingerprint_check" CHECK (("acceptance_evidence_fingerprint" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "booking_snapshots_booking_terms_sha256_check" CHECK (("booking_terms_sha256" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "booking_snapshots_check" CHECK ((("marketplace_commission_amount_fils" > 0) AND ("marketplace_commission_amount_fils" = ((("quote_payload" ->> 'bookingPriceIqd'::"text"))::bigint * 100)))),
    CONSTRAINT "booking_snapshots_intent_fingerprint_check" CHECK (("intent_fingerprint" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "booking_snapshots_marketplace_commission_rate_basis_point_check" CHECK (("marketplace_commission_rate_basis_points" = 1000)),
    CONSTRAINT "booking_snapshots_quote_fingerprint_check" CHECK (("quote_fingerprint" ~ '^[0-9a-f]{64}$'::"text"))
);

ALTER TABLE "public"."booking_snapshots" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_booking_period_commitments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_user_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "schedule_revision_id" "uuid" NOT NULL,
    "commitment_reference" "text" NOT NULL,
    "status" "public"."cottage_inventory_commitment_status" NOT NULL,
    "access_ranges" "tstzmultirange" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cottage_booking_period_commitments_access_ranges_check" CHECK ((NOT "isempty"("access_ranges"))),
    CONSTRAINT "cottage_booking_period_commitments_commitment_reference_check" CHECK ((("commitment_reference" = "btrim"("commitment_reference")) AND ("commitment_reference" ~ '^[A-Z0-9][A-Z0-9-]{0,119}$'::"text")))
);

ALTER TABLE "public"."cottage_booking_period_commitments" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_booking_period_occupancies" (
    "booking_period_commitment_id" "uuid" NOT NULL,
    "schedule_revision_id" "uuid" NOT NULL,
    "shift_id" "uuid" NOT NULL,
    "service_day" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "active" boolean DEFAULT true NOT NULL
);

ALTER TABLE "public"."cottage_booking_period_occupancies" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."payment_provider_observations" (
    "id" uuid DEFAULT gen_random_uuid() NOT NULL,
    "operation_id" uuid NOT NULL,
    "provider" text NOT NULL,
    "environment" text NOT NULL,
    "merchant_id" text NOT NULL,
    "terminal_id" text NOT NULL,
    "event_id" text NOT NULL,
    "result" jsonb NOT NULL,
    "occurred_at" timestamp with time zone,
    "received_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    "provenance" text NOT NULL,
    CONSTRAINT "payment_provider_observation_identity" CHECK ((length(event_id) BETWEEN 1 AND 200 AND jsonb_typeof(result)='object' AND provenance IN ('fictional-provider','provider-event','legacy-simulated')))
);
ALTER TABLE "public"."payment_provider_observations" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."simulated_payment_effects" (
    "operation_id" uuid NOT NULL,
    "provider" text NOT NULL,
    "environment" text NOT NULL,
    "merchant_id" text NOT NULL,
    "terminal_id" text NOT NULL,
    "idempotency_key" text NOT NULL,
    "binding" jsonb NOT NULL,
    "state" text NOT NULL,
    "result" jsonb,
    "physical_execution_count" smallint NOT NULL,
    "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT "simulated_payment_effect_scope" CHECK ((length(provider)>0 AND environment='local-test' AND length(merchant_id)>0 AND length(terminal_id)>0)),
    CONSTRAINT "simulated_payment_effect_state" CHECK ((((state='reserved' AND result IS NULL AND physical_execution_count=0) OR (state='closed-not-executed' AND result->>'outcome'='not-executed' AND physical_execution_count=0) OR (state='executed' AND result->>'outcome' IN ('succeeded','failed','indeterminate') AND physical_execution_count=1))) IS TRUE)
);
ALTER TABLE "public"."simulated_payment_effects" OWNER TO "postgres";

CREATE TABLE public.booking_cancellations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_request_id uuid NOT NULL UNIQUE ,
  booking_confirmation_id uuid NOT NULL UNIQUE ,
  capture_operation_id uuid NOT NULL ,
  command_id uuid NOT NULL UNIQUE,
  command_fingerprint text NOT NULL CHECK (command_fingerprint ~ '^[0-9a-f]{64}$'),
  actor_user_id uuid NOT NULL ,
  actor_role text NOT NULL CHECK (actor_role IN ('customer','cottage_owner','platform_administrator')),
  reason text,
  category text,
  first_starts_at timestamptz NOT NULL,
  occurred_at timestamptz NOT NULL,
  refund_booking_price_fils bigint NOT NULL CHECK (refund_booking_price_fils >= 0 AND refund_booking_price_fils % 10 = 0),
  refund_booking_service_fee_fils bigint NOT NULL CHECK (refund_booking_service_fee_fils >= 0),
  CONSTRAINT booking_cancellation_reason CHECK (
    (actor_role='customer' AND reason IS NULL AND category IS NULL) OR
    (actor_role='cottage_owner' AND reason IS NOT NULL AND length(btrim(reason)) >= 1 AND length(btrim(reason)) <= 2000 AND category IS NULL) OR
    (actor_role='platform_administrator' AND reason IS NOT NULL AND length(btrim(reason)) >= 1 AND length(btrim(reason)) <= 2000 AND category IS NOT NULL AND category IN ('safety','fraud','legal','serious_operational'))
  )
);

CREATE TABLE public.booking_cancellation_incidents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  cancellation_id uuid NOT NULL UNIQUE ,
  recorded_at timestamptz NOT NULL
);

CREATE TABLE public.booking_cancellation_administrator_audit (
  cancellation_id uuid PRIMARY KEY ,
  administrator_user_id uuid NOT NULL ,
  recorded_at timestamptz NOT NULL
);

CREATE TABLE public.booking_notification_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_request_id uuid NOT NULL ,
  cancellation_id uuid,
  refund_intent_id uuid,
  receipt_id uuid NOT NULL ,
  event_kind text NOT NULL CHECK (event_kind IN ('cancelled','refund_requested','refund_returned','refund_attention')),
  recipient_user_id uuid NOT NULL ,
  recipient_role text NOT NULL CHECK (recipient_role IN ('customer','cottage_owner')),
  notice_locale public.cottage_profile_source_language NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE(cancellation_id,recipient_role),
  UNIQUE(refund_intent_id,event_kind,recipient_role),
  CHECK ((event_kind='cancelled' AND cancellation_id IS NOT NULL AND refund_intent_id IS NULL) OR
    (event_kind<>'cancelled' AND cancellation_id IS NULL AND refund_intent_id IS NOT NULL))
);

CREATE TABLE public.booking_refund_intents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_request_id uuid NOT NULL,
  capture_operation_id uuid NOT NULL,
  cancellation_id uuid,
  command_id uuid NOT NULL UNIQUE,
  command_fingerprint text NOT NULL CHECK (length(command_fingerprint)=64),
  source text NOT NULL CHECK (source IN ('cancellation','administrator')),
  actor_user_id uuid,
  reason text,
  booking_price_fils bigint NOT NULL CHECK (booking_price_fils>=0 AND booking_price_fils%10=0),
  booking_service_fee_fils bigint NOT NULL CHECK (booking_service_fee_fils>=0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (booking_price_fils+booking_service_fee_fils>0),
  CHECK ((source='cancellation' AND cancellation_id IS NOT NULL AND actor_user_id IS NULL AND reason IS NULL) OR
    (source='administrator' AND actor_user_id IS NOT NULL AND reason IS NOT NULL AND length(btrim(reason))>=1 AND length(btrim(reason))<=2000))
);

CREATE TABLE public.booking_refund_attempts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  refund_intent_id uuid NOT NULL,
  generation integer NOT NULL CHECK (generation>0),
  lease_token uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  not_after timestamptz NOT NULL,
  UNIQUE(refund_intent_id,generation),
  CHECK (not_after>created_at)
);
