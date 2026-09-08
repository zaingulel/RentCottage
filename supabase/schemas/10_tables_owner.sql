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

CREATE TABLE IF NOT EXISTS "public"."owner_applications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "applicant_kind" "public"."owner_applicant_kind" NOT NULL,
    "legal_name" "text",
    "company_name" "text",
    "licensing_basis" "public"."owner_licensing_basis" DEFAULT 'licence'::"public"."owner_licensing_basis" NOT NULL,
    "exemption_basis" "text",
    "status" "public"."owner_application_status" DEFAULT 'draft'::"public"."owner_application_status" NOT NULL,
    "submitted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "version" bigint DEFAULT 1 NOT NULL,
    "review_started_at" timestamp with time zone,
    "review_due_at" timestamp with time zone,
    "review_remaining" interval DEFAULT '72:00:00'::interval NOT NULL,
    "review_paused_at" timestamp with time zone,
    "decided_at" timestamp with time zone,
    "current_verification_record_id" "uuid",
    CONSTRAINT "owner_application_exemption_basis_matches_choice" CHECK (((("licensing_basis" = 'licence'::"public"."owner_licensing_basis") AND ("exemption_basis" IS NULL)) OR ("licensing_basis" = 'exemption'::"public"."owner_licensing_basis"))),
    CONSTRAINT "owner_application_review_clock_matches_status" CHECK (((("status" = 'draft'::"public"."owner_application_status") AND ("review_started_at" IS NULL) AND ("review_due_at" IS NULL)) OR (("status" = 'needs_information'::"public"."owner_application_status") AND ("review_started_at" IS NOT NULL) AND ("review_due_at" IS NULL) AND ("review_paused_at" IS NOT NULL)) OR (("status" = 'submitted'::"public"."owner_application_status") AND ((("review_started_at" IS NULL) AND ("review_due_at" IS NULL) AND ("review_paused_at" IS NULL)) OR (("review_started_at" IS NOT NULL) AND ("review_due_at" IS NOT NULL) AND ("review_paused_at" IS NULL)))) OR (("status" = 'under_review'::"public"."owner_application_status") AND ("review_started_at" IS NOT NULL) AND ("review_due_at" IS NOT NULL) AND ("review_paused_at" IS NULL)) OR (("status" = ANY (ARRAY['approved'::"public"."owner_application_status", 'rejected'::"public"."owner_application_status", 'expired'::"public"."owner_application_status", 'suspended'::"public"."owner_application_status"])) AND ("review_started_at" IS NOT NULL) AND ("review_due_at" IS NULL)))),
    CONSTRAINT "owner_application_submission_time_matches_status" CHECK (((("status" = 'draft'::"public"."owner_application_status") AND ("submitted_at" IS NULL)) OR (("status" <> 'draft'::"public"."owner_application_status") AND ("submitted_at" IS NOT NULL)))),
    CONSTRAINT "owner_application_text_lengths" CHECK ((("char_length"(COALESCE("legal_name", ''::"text")) <= 120) AND ("char_length"(COALESCE("company_name", ''::"text")) <= 120) AND ("char_length"(COALESCE("exemption_basis", ''::"text")) <= 1000))),
    CONSTRAINT "owner_applications_review_remaining_check" CHECK ((("review_remaining" >= '00:00:00'::interval) AND ("review_remaining" <= '72:00:00'::interval))),
    CONSTRAINT "owner_applications_version_check" CHECK (("version" >= 1))
);

ALTER TABLE "public"."owner_applications" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."owner_application_information_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "application_id" "uuid" NOT NULL,
    "requested_by_user_id" "uuid",
    "requested_by_subject_id" "uuid" NOT NULL,
    "reason" "text" NOT NULL,
    "requested_fields" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "requested_document_kinds" "public"."owner_verification_document_kind"[] DEFAULT '{}'::"public"."owner_verification_document_kind"[] NOT NULL,
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "responded_at" timestamp with time zone,
    "response_version" bigint,
    CONSTRAINT "owner_application_information_request_completion" CHECK (((("responded_at" IS NULL) AND ("response_version" IS NULL)) OR (("responded_at" IS NOT NULL) AND ("response_version" IS NOT NULL)))),
    CONSTRAINT "owner_application_information_request_has_scope" CHECK ((("cardinality"("requested_fields") + "cardinality"("requested_document_kinds")) > 0)),
    CONSTRAINT "owner_application_information_requests_reason_check" CHECK ((("char_length"("reason") >= 1) AND ("char_length"("reason") <= 1000)))
);

ALTER TABLE "public"."owner_application_information_requests" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."owner_application_lifecycle_control" (
    "singleton" boolean DEFAULT true NOT NULL,
    "expiry_processor_enabled" boolean DEFAULT false NOT NULL,
    "activated_at" timestamp with time zone,
    "cron_installed_at" timestamp with time zone,
    CONSTRAINT "owner_application_lifecycle_control_singleton_check" CHECK ("singleton")
);

ALTER TABLE "public"."owner_application_lifecycle_control" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."owner_application_notices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "application_id" "uuid" NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "owner_application_notices_kind_check" CHECK (("kind" = ANY (ARRAY['information_requested'::"text", 'response_received'::"text", 'approved'::"text", 'rejected'::"text", 'expired'::"text", 'suspended'::"text"])))
);

ALTER TABLE "public"."owner_application_notices" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."owner_application_renewal_work" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "application_id" "uuid" NOT NULL,
    "verification_record_id" "uuid" NOT NULL,
    "requested_document_kinds" "public"."owner_verification_document_kind"[] NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "submitted_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    CONSTRAINT "owner_application_renewal_work_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'submitted'::"text", 'completed'::"text"])))
);

ALTER TABLE "public"."owner_application_renewal_work" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."owner_application_transitions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "application_id" "uuid" NOT NULL,
    "from_status" "public"."owner_application_status" NOT NULL,
    "to_status" "public"."owner_application_status" NOT NULL,
    "application_version" bigint NOT NULL,
    "actor_user_id" "uuid",
    "actor_subject_id" "text" NOT NULL,
    "reason" "text",
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."owner_application_transitions" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."owner_application_verification_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "application_id" "uuid" NOT NULL,
    "version" integer NOT NULL,
    "reviewer_user_id" "uuid",
    "reviewer_subject_id" "uuid" NOT NULL,
    "decision" "text" NOT NULL,
    "reason" "text" NOT NULL,
    "jurisdiction" "text" NOT NULL,
    "licensing_basis" "public"."owner_licensing_basis" NOT NULL,
    "licence_or_exemption_basis" "text" NOT NULL,
    "evidence_version_ids" "uuid"[] NOT NULL,
    "evidence_types" "public"."owner_verification_document_kind"[] NOT NULL,
    "relevant_expiry_dates" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "decided_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "owner_application_verification_licence_or_exemption_basis_check" CHECK ((("char_length"("licence_or_exemption_basis") >= 1) AND ("char_length"("licence_or_exemption_basis") <= 1000))),
    CONSTRAINT "owner_application_verification_records_decision_check" CHECK (("decision" = ANY (ARRAY['approved'::"text", 'rejected'::"text"]))),
    CONSTRAINT "owner_application_verification_records_jurisdiction_check" CHECK ((("char_length"("jurisdiction") >= 1) AND ("char_length"("jurisdiction") <= 120))),
    CONSTRAINT "owner_application_verification_records_reason_check" CHECK ((("char_length"("reason") >= 1) AND ("char_length"("reason") <= 1000))),
    CONSTRAINT "owner_application_verification_records_version_check" CHECK (("version" >= 1))
);

ALTER TABLE "public"."owner_application_verification_records" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."owner_request_notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "booking_request_id" "uuid" NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "channel" "text" DEFAULT 'in_product'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "seen_at" timestamp with time zone,
    CONSTRAINT "owner_request_notifications_channel_check" CHECK (("channel" = 'in_product'::"text"))
);

ALTER TABLE "public"."owner_request_notifications" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."owner_verification_document_access_grants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "document_id" "uuid",
    "document_subject_id" "uuid" NOT NULL,
    "actor_user_id" "uuid",
    "actor_subject_id" "uuid" NOT NULL,
    "object_path" "text" NOT NULL,
    "status" "public"."owner_verification_access_grant_status" DEFAULT 'pending'::"public"."owner_verification_access_grant_status" NOT NULL,
    "prepared_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "complete_before" timestamp with time zone DEFAULT ("now"() + '00:02:00'::interval) NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "owner_verification_access_grant_completion_matches_status" CHECK (((("status" = 'pending'::"public"."owner_verification_access_grant_status") AND ("completed_at" IS NULL)) OR (("status" = ANY (ARRAY['completed'::"public"."owner_verification_access_grant_status", 'expired'::"public"."owner_verification_access_grant_status"])) AND ("completed_at" IS NOT NULL))))
);

ALTER TABLE "public"."owner_verification_document_access_grants" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."owner_verification_document_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "document_id" "uuid",
    "access_grant_id" "uuid",
    "actor_user_id" "uuid",
    "actor_subject_id" "uuid" NOT NULL,
    "action" "public"."owner_verification_document_action" NOT NULL,
    "object_path" "text" NOT NULL,
    "access_expires_at" timestamp with time zone,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "owner_document_access_expiry_matches_action" CHECK (((("action" = 'access_granted'::"public"."owner_verification_document_action") AND ("access_grant_id" IS NOT NULL) AND ("access_expires_at" IS NOT NULL)) OR (("action" <> 'access_granted'::"public"."owner_verification_document_action") AND ("access_grant_id" IS NULL) AND ("access_expires_at" IS NULL))))
);

ALTER TABLE "public"."owner_verification_document_audit" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."owner_verification_document_cleanup" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "application_id" "uuid",
    "document_id" "uuid",
    "replacement_cleanup_id" "uuid",
    "actor_user_id" "uuid",
    "actor_subject_id" "uuid" NOT NULL,
    "reason" "public"."owner_verification_cleanup_reason" NOT NULL,
    "status" "public"."owner_verification_cleanup_status" DEFAULT 'pending'::"public"."owner_verification_cleanup_status" NOT NULL,
    "kind" "public"."owner_verification_document_kind" NOT NULL,
    "object_path" "text" NOT NULL,
    "original_filename" "text" NOT NULL,
    "media_type" "text" NOT NULL,
    "size_bytes" integer NOT NULL,
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "content_digest" "text",
    "digest_source" "text",
    CONSTRAINT "owner_verification_cleanup_completion_matches_status" CHECK (((("status" = 'pending'::"public"."owner_verification_cleanup_status") AND ("completed_at" IS NULL)) OR (("status" = 'completed'::"public"."owner_verification_cleanup_status") AND ("completed_at" IS NOT NULL)))),
    CONSTRAINT "owner_verification_cleanup_digest_shape" CHECK ((("content_digest" IS NULL) OR ("content_digest" ~ '^[0-9a-f]{64}$'::"text"))),
    CONSTRAINT "owner_verification_document_cleanup_digest_source_check" CHECK (("digest_source" = ANY (ARRAY['legacy_metadata'::"text", 'sha256'::"text"]))),
    CONSTRAINT "owner_verification_document_cleanup_media_type_check" CHECK (("media_type" = ANY (ARRAY['application/pdf'::"text", 'image/jpeg'::"text", 'image/png'::"text"]))),
    CONSTRAINT "owner_verification_document_cleanup_size_bytes_check" CHECK ((("size_bytes" >= 1) AND ("size_bytes" <= 5242880)))
);

ALTER TABLE "public"."owner_verification_document_cleanup" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."owner_verification_document_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "document_id" "uuid" NOT NULL,
    "application_id" "uuid" NOT NULL,
    "kind" "public"."owner_verification_document_kind" NOT NULL,
    "version" integer NOT NULL,
    "object_path" "text" NOT NULL,
    "original_filename" "text" NOT NULL,
    "media_type" "text" NOT NULL,
    "size_bytes" integer NOT NULL,
    "content_digest" "text" NOT NULL,
    "digest_source" "text" NOT NULL,
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "owner_verification_document_versions_content_digest_check" CHECK (("content_digest" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "owner_verification_document_versions_digest_source_check" CHECK (("digest_source" = ANY (ARRAY['legacy_metadata'::"text", 'sha256'::"text"]))),
    CONSTRAINT "owner_verification_document_versions_version_check" CHECK (("version" >= 1))
);

ALTER TABLE "public"."owner_verification_document_versions" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."owner_verification_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "application_id" "uuid" NOT NULL,
    "kind" "public"."owner_verification_document_kind" NOT NULL,
    "object_path" "text" NOT NULL,
    "original_filename" "text" NOT NULL,
    "media_type" "text" NOT NULL,
    "size_bytes" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "content_digest" "text" DEFAULT "repeat"('0'::"text", 64) NOT NULL,
    "digest_source" "text" DEFAULT 'legacy_metadata'::"text" NOT NULL,
    CONSTRAINT "owner_verification_document_digest_shape" CHECK (("content_digest" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "owner_verification_documents_digest_source_check" CHECK (("digest_source" = ANY (ARRAY['legacy_metadata'::"text", 'sha256'::"text"]))),
    CONSTRAINT "owner_verification_documents_media_type_check" CHECK (("media_type" = ANY (ARRAY['application/pdf'::"text", 'image/jpeg'::"text", 'image/png'::"text"]))),
    CONSTRAINT "owner_verification_documents_size_bytes_check" CHECK ((("size_bytes" >= 1) AND ("size_bytes" <= 5242880)))
);

ALTER TABLE "public"."owner_verification_documents" OWNER TO "postgres";
