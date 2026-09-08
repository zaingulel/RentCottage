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

CREATE TABLE IF NOT EXISTS "public"."owner_application_cottage_profiles" (
    "application_id" "uuid",
    "name" "text",
    "governorate" "text",
    "approximate_location" "text",
    "exact_address" "text",
    "capacity" smallint,
    "bedrooms" smallint,
    "bathrooms" smallint,
    "amenities" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "description" "text",
    "house_rules" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "exact_latitude" numeric(9,6),
    "exact_longitude" numeric(9,6),
    "private_directions" "text",
    "source_language" "public"."cottage_profile_source_language",
    "status" "public"."cottage_profile_status" DEFAULT 'draft'::"public"."cottage_profile_status" NOT NULL,
    "version" bigint DEFAULT 1 NOT NULL,
    "submitted_source_revision_id" "uuid",
    "current_publication_id" "uuid",
    "current_shift_schedule_id" "uuid",
    "abandoned_at" timestamp with time zone,
    CONSTRAINT "cottage_profile_abandonment_shape" CHECK (((("status" = 'abandoned'::"public"."cottage_profile_status") AND ("abandoned_at" IS NOT NULL) AND ("application_id" IS NULL) AND ("current_publication_id" IS NULL) AND ("submitted_source_revision_id" IS NULL)) OR (("status" <> 'abandoned'::"public"."cottage_profile_status") AND ("abandoned_at" IS NULL)))),
    CONSTRAINT "cottage_profile_private_directions_length" CHECK (("char_length"(COALESCE("private_directions", ''::"text")) <= 1000)),
    CONSTRAINT "cottage_profile_private_location_pair" CHECK (((("exact_latitude" IS NULL) AND ("exact_longitude" IS NULL)) OR (("exact_latitude" IS NOT NULL) AND ("exact_longitude" IS NOT NULL) AND (("exact_latitude" >= ('-90'::integer)::numeric) AND ("exact_latitude" <= (90)::numeric)) AND (("exact_longitude" >= ('-180'::integer)::numeric) AND ("exact_longitude" <= (180)::numeric))))),
    CONSTRAINT "cottage_profile_submission_source_matches_status" CHECK (((("status" = ANY (ARRAY['draft'::"public"."cottage_profile_status", 'abandoned'::"public"."cottage_profile_status"])) AND ("submitted_source_revision_id" IS NULL)) OR (("status" = 'submitted_for_content_approval'::"public"."cottage_profile_status") AND ("submitted_source_revision_id" IS NOT NULL)))),
    CONSTRAINT "owner_application_amenities_are_known" CHECK ((("amenities" <@ ARRAY['garden'::"text", 'parking'::"text", 'pool'::"text", 'air_conditioning'::"text", 'wifi'::"text", 'outdoor_seating'::"text"]) AND ("cardinality"("amenities") <= 6))),
    CONSTRAINT "owner_application_cottage_profiles_bathrooms_check" CHECK ((("bathrooms" IS NULL) OR (("bathrooms" >= 1) AND ("bathrooms" <= 50)))),
    CONSTRAINT "owner_application_cottage_profiles_bedrooms_check" CHECK ((("bedrooms" IS NULL) OR (("bedrooms" >= 1) AND ("bedrooms" <= 50)))),
    CONSTRAINT "owner_application_cottage_profiles_capacity_check" CHECK ((("capacity" IS NULL) OR (("capacity" >= 1) AND ("capacity" <= 100)))),
    CONSTRAINT "owner_application_cottage_profiles_version_check" CHECK (("version" >= 1)),
    CONSTRAINT "owner_application_cottage_text_lengths" CHECK ((("char_length"(COALESCE("name", ''::"text")) <= 120) AND ("char_length"(COALESCE("governorate", ''::"text")) <= 120) AND ("char_length"(COALESCE("approximate_location", ''::"text")) <= 240) AND ("char_length"(COALESCE("exact_address", ''::"text")) <= 240) AND ("char_length"(COALESCE("description", ''::"text")) <= 2000) AND ("char_length"(COALESCE("house_rules", ''::"text")) <= 1500)))
);

ALTER TABLE "public"."owner_application_cottage_profiles" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_publication_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "review_cycle_id" "uuid" NOT NULL,
    "publication_number" integer NOT NULL,
    "name" "text" NOT NULL,
    "governorate" "text" NOT NULL,
    "approximate_location" "text" NOT NULL,
    "capacity" integer NOT NULL,
    "bedrooms" integer NOT NULL,
    "bathrooms" integer NOT NULL,
    "amenities" "text"[] NOT NULL,
    "published_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cottage_publication_snapshots_publication_number_check" CHECK (("publication_number" >= 1))
);

ALTER TABLE "public"."cottage_publication_snapshots" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_profile_translation_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "review_cycle_id" "uuid" NOT NULL,
    "source_revision_id" "uuid" NOT NULL,
    "target_language" "public"."cottage_profile_source_language" NOT NULL,
    "expected_localized_revision_id" "uuid",
    "attempt_number" integer NOT NULL,
    "state" "text" DEFAULT 'pending'::"text" NOT NULL,
    "failure_code" "text",
    "provider" "text",
    "model" "text",
    "effort" "text",
    "prompt_version" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "route" "text" DEFAULT 'ordinary'::"text" NOT NULL,
    "lease_token" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lease_expires_at" timestamp with time zone DEFAULT ("now"() + '00:05:00'::interval) NOT NULL,
    CONSTRAINT "cottage_profile_translation_attempt_failure_code" CHECK ((("failure_code" IS NULL) OR ("failure_code" = ANY (ARRAY['adapter_unavailable'::"text", 'configuration_unavailable'::"text", 'unsupported_content'::"text", 'invalid_input'::"text", 'usage_limit_reached'::"text", 'provider_timeout'::"text", 'provider_unavailable'::"text", 'invalid_provider_response'::"text", 'cache_unavailable'::"text", 'usage_accounting_unavailable'::"text", 'provider_failure'::"text"])))),
    CONSTRAINT "cottage_profile_translation_attempt_outcome" CHECK (((("state" = 'pending'::"text") AND ("failure_code" IS NULL) AND ("provider" IS NULL) AND ("completed_at" IS NULL)) OR (("state" = 'completed'::"text") AND ("failure_code" IS NULL) AND ("provider" IS NOT NULL) AND ("model" IS NOT NULL) AND ("effort" IS NOT NULL) AND ("prompt_version" IS NOT NULL) AND ("completed_at" IS NOT NULL)) OR (("state" = 'failed'::"text") AND ("failure_code" IS NOT NULL) AND ("provider" IS NULL) AND ("completed_at" IS NOT NULL)) OR (("state" = 'superseded'::"text") AND ("failure_code" IS NULL) AND ("completed_at" IS NOT NULL)))),
    CONSTRAINT "cottage_profile_translation_attempts_attempt_number_check" CHECK (("attempt_number" >= 1)),
    CONSTRAINT "cottage_profile_translation_attempts_route_check" CHECK (("route" = ANY (ARRAY['ordinary'::"text", 'stronger_model'::"text"]))),
    CONSTRAINT "cottage_profile_translation_attempts_state_check" CHECK (("state" = ANY (ARRAY['pending'::"text", 'completed'::"text", 'failed'::"text", 'superseded'::"text"])))
);

ALTER TABLE "public"."cottage_profile_translation_attempts" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_profile_localized_revisions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "review_cycle_id" "uuid" NOT NULL,
    "locale" "public"."cottage_profile_source_language" NOT NULL,
    "revision" integer NOT NULL,
    "origin" "text" NOT NULL,
    "description" "text" NOT NULL,
    "house_rules" "text" NOT NULL,
    "provider" "text",
    "model" "text",
    "effort" "text",
    "prompt_version" "text",
    "administrator_user_id" "uuid",
    "correction_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cottage_profile_localized_revision_origin" CHECK (((("origin" = 'owner_source'::"text") AND ("provider" IS NULL) AND ("model" IS NULL) AND ("effort" IS NULL) AND ("prompt_version" IS NULL) AND ("administrator_user_id" IS NULL) AND ("correction_reason" IS NULL)) OR (("origin" = 'generated'::"text") AND ("provider" IS NOT NULL) AND ("model" IS NOT NULL) AND ("effort" IS NOT NULL) AND ("prompt_version" IS NOT NULL) AND ("administrator_user_id" IS NULL) AND ("correction_reason" IS NULL)) OR (("origin" = 'administrator_correction'::"text") AND ("provider" IS NULL) AND ("model" IS NULL) AND ("effort" IS NULL) AND ("prompt_version" IS NULL) AND ("administrator_user_id" IS NOT NULL) AND (("char_length"("btrim"("correction_reason")) >= 1) AND ("char_length"("btrim"("correction_reason")) <= 1000))))),
    CONSTRAINT "cottage_profile_localized_revisions_description_check" CHECK ((("char_length"("description") >= 1) AND ("char_length"("description") <= 2000))),
    CONSTRAINT "cottage_profile_localized_revisions_house_rules_check" CHECK ((("char_length"("house_rules") >= 1) AND ("char_length"("house_rules") <= 1500))),
    CONSTRAINT "cottage_profile_localized_revisions_origin_check" CHECK (("origin" = ANY (ARRAY['owner_source'::"text", 'generated'::"text", 'administrator_correction'::"text"]))),
    CONSTRAINT "cottage_profile_localized_revisions_revision_check" CHECK (("revision" >= 1))
);

ALTER TABLE "public"."cottage_profile_localized_revisions" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_profile_localized_decisions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "review_cycle_id" "uuid" NOT NULL,
    "locale" "public"."cottage_profile_source_language" NOT NULL,
    "localized_revision_id" "uuid" NOT NULL,
    "administrator_user_id" "uuid" NOT NULL,
    "approved" boolean NOT NULL,
    "reason" "text" NOT NULL,
    "decided_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cottage_profile_localized_decisions_reason_check" CHECK ((("char_length"("btrim"("reason")) >= 1) AND ("char_length"("btrim"("reason")) <= 1000)))
);

ALTER TABLE "public"."cottage_profile_localized_decisions" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_profile_photos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "actor_user_id" "uuid" NOT NULL,
    "object_path" "text" NOT NULL,
    "original_filename" "text" NOT NULL,
    "media_type" "text" NOT NULL,
    "size_bytes" integer NOT NULL,
    "state" "public"."cottage_profile_photo_state" DEFAULT 'pending'::"public"."cottage_profile_photo_state" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    CONSTRAINT "cottage_profile_photo_filename_length" CHECK ((("char_length"("btrim"("original_filename")) >= 1) AND ("char_length"("btrim"("original_filename")) <= 180))),
    CONSTRAINT "cottage_profile_photos_media_type_check" CHECK (("media_type" = ANY (ARRAY['image/jpeg'::"text", 'image/png'::"text", 'image/webp'::"text"]))),
    CONSTRAINT "cottage_profile_photos_size_bytes_check" CHECK ((("size_bytes" >= 1) AND ("size_bytes" <= 5242880)))
);

ALTER TABLE "public"."cottage_profile_photos" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_translation_quality_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "review_cycle_id" "uuid" NOT NULL,
    "remediation_review_cycle_id" "uuid" NOT NULL,
    "localized_revision_id" "uuid" NOT NULL,
    "locale" "public"."cottage_profile_source_language" NOT NULL,
    "reporter_user_id" "uuid" NOT NULL,
    "reason" "text" NOT NULL,
    "reported_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cottage_translation_quality_reports_reason_check" CHECK ((("char_length"("btrim"("reason")) >= 1) AND ("char_length"("btrim"("reason")) <= 1000)))
);

ALTER TABLE "public"."cottage_translation_quality_reports" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_profile_translation_human_reviews" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "review_cycle_id" "uuid" NOT NULL,
    "locale" "public"."cottage_profile_source_language" NOT NULL,
    "generated_revision_id" "uuid" NOT NULL,
    "administrator_user_id" "uuid" NOT NULL,
    "reason" "text" NOT NULL,
    "state" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    CONSTRAINT "cottage_profile_translation_human_review_state" CHECK (((("state" = 'active'::"text") AND ("resolved_at" IS NULL)) OR (("state" = ANY (ARRAY['resolved'::"text", 'superseded'::"text"])) AND ("resolved_at" IS NOT NULL)))),
    CONSTRAINT "cottage_profile_translation_human_reviews_reason_check" CHECK ((("char_length"("btrim"("reason")) >= 1) AND ("char_length"("btrim"("reason")) <= 1000))),
    CONSTRAINT "cottage_profile_translation_human_reviews_state_check" CHECK (("state" = ANY (ARRAY['active'::"text", 'resolved'::"text", 'superseded'::"text"])))
);

ALTER TABLE "public"."cottage_profile_translation_human_reviews" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_inventory_availability" (
    "schedule_revision_id" "uuid" NOT NULL,
    "unit_kind" "public"."cottage_inventory_unit_kind" NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "service_day" "date" NOT NULL,
    "state" "public"."cottage_inventory_availability_state" NOT NULL
);

ALTER TABLE "public"."cottage_inventory_availability" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_inventory_commitments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "unit_kind" "public"."cottage_inventory_unit_kind" NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "service_day" "date" NOT NULL,
    "committed_price_iqd" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "booking_period_commitment_id" "uuid" NOT NULL,
    CONSTRAINT "cottage_inventory_commitments_committed_price_iqd_check" CHECK (("committed_price_iqd" > 0))
);

ALTER TABLE "public"."cottage_inventory_commitments" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_inventory_date_price_overrides" (
    "schedule_revision_id" "uuid" NOT NULL,
    "unit_kind" "public"."cottage_inventory_unit_kind" NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "service_day" "date" NOT NULL,
    "price_iqd" bigint NOT NULL,
    CONSTRAINT "cottage_inventory_date_price_overrides_price_iqd_check" CHECK (("price_iqd" > 0))
);

ALTER TABLE "public"."cottage_inventory_date_price_overrides" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_inventory_standard_prices" (
    "schedule_revision_id" "uuid" NOT NULL,
    "unit_kind" "public"."cottage_inventory_unit_kind" NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "price_iqd" bigint NOT NULL,
    CONSTRAINT "cottage_inventory_standard_prices_price_iqd_check" CHECK (("price_iqd" > 0))
);

ALTER TABLE "public"."cottage_inventory_standard_prices" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_inventory_weekday_price_overrides" (
    "schedule_revision_id" "uuid" NOT NULL,
    "unit_kind" "public"."cottage_inventory_unit_kind" NOT NULL,
    "unit_id" "uuid" NOT NULL,
    "weekday" smallint NOT NULL,
    "price_iqd" bigint NOT NULL,
    CONSTRAINT "cottage_inventory_weekday_price_overrides_price_iqd_check" CHECK (("price_iqd" > 0)),
    CONSTRAINT "cottage_inventory_weekday_price_overrides_weekday_check" CHECK ((("weekday" >= 0) AND ("weekday" <= 6)))
);

ALTER TABLE "public"."cottage_inventory_weekday_price_overrides" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_marketplace_listings" (
    "profile_id" "uuid" NOT NULL,
    "public_slug" "text" NOT NULL,
    "state" "public"."cottage_marketplace_state" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cottage_marketplace_listings_public_slug_check" CHECK (("public_slug" ~ '^cottage-[0-9a-f]{32}$'::"text"))
);

ALTER TABLE "public"."cottage_marketplace_listings" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_ownership" (
    "cottage_id" "uuid" NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."cottage_ownership" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_profile_administrator_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "administrator_user_id" "uuid" NOT NULL,
    "previous_version" bigint NOT NULL,
    "resulting_version" bigint NOT NULL,
    "changed_fields" "text"[] NOT NULL,
    "event_kind" "text" DEFAULT 'working_copy_updated'::"text" NOT NULL,
    "object_path" "text",
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "lifecycle_reason" "text",
    "previous_status" "public"."cottage_profile_status",
    "resulting_status" "public"."cottage_profile_status",
    CONSTRAINT "cottage_profile_administrator_audit_check" CHECK (("resulting_version" >= "previous_version")),
    CONSTRAINT "cottage_profile_administrator_audit_event_kind_check" CHECK (("event_kind" = ANY (ARRAY['working_copy_updated'::"text", 'photo_upload_prepared'::"text", 'photo_deletion_prepared'::"text", 'photo_deletion_recovered'::"text", 'draft_abandoned'::"text", 'draft_restored'::"text"]))),
    CONSTRAINT "cottage_profile_administrator_audit_event_shape" CHECK (((("event_kind" = 'working_copy_updated'::"text") AND ("resulting_version" > "previous_version") AND ("object_path" IS NULL) AND ("lifecycle_reason" IS NULL) AND ("previous_status" IS NULL) AND ("resulting_status" IS NULL)) OR (("event_kind" = ANY (ARRAY['photo_upload_prepared'::"text", 'photo_deletion_prepared'::"text", 'photo_deletion_recovered'::"text"])) AND ("resulting_version" = "previous_version") AND ("changed_fields" = ARRAY['photos'::"text"]) AND ("object_path" IS NOT NULL) AND ("lifecycle_reason" IS NULL) AND ("previous_status" IS NULL) AND ("resulting_status" IS NULL)) OR (("event_kind" = 'draft_abandoned'::"text") AND ("resulting_version" = ("previous_version" + 1)) AND ("changed_fields" = ARRAY['status'::"text"]) AND ("object_path" IS NULL) AND ("lifecycle_reason" IS NOT NULL) AND ("lifecycle_reason" = "regexp_replace"("lifecycle_reason", '^[[:space:]]+|[[:space:]]+$'::"text", ''::"text", 'g'::"text")) AND (("char_length"("btrim"("lifecycle_reason")) >= 1) AND ("char_length"("btrim"("lifecycle_reason")) <= 1000)) AND ("previous_status" IS NOT NULL) AND ("resulting_status" IS NOT NULL) AND ("previous_status" = 'draft'::"public"."cottage_profile_status") AND ("resulting_status" = 'abandoned'::"public"."cottage_profile_status")) OR (("event_kind" = 'draft_restored'::"text") AND ("resulting_version" = ("previous_version" + 1)) AND ("changed_fields" = ARRAY['status'::"text"]) AND ("object_path" IS NULL) AND ("lifecycle_reason" IS NOT NULL) AND ("lifecycle_reason" = "regexp_replace"("lifecycle_reason", '^[[:space:]]+|[[:space:]]+$'::"text", ''::"text", 'g'::"text")) AND (("char_length"("btrim"("lifecycle_reason")) >= 1) AND ("char_length"("btrim"("lifecycle_reason")) <= 1000)) AND ("previous_status" IS NOT NULL) AND ("resulting_status" IS NOT NULL) AND ("previous_status" = 'abandoned'::"public"."cottage_profile_status") AND ("resulting_status" = 'draft'::"public"."cottage_profile_status")))),
    CONSTRAINT "cottage_profile_administrator_audit_previous_version_check" CHECK (("previous_version" >= 1))
);

ALTER TABLE "public"."cottage_profile_administrator_audit" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_profile_localized_heads" (
    "review_cycle_id" "uuid" NOT NULL,
    "locale" "public"."cottage_profile_source_language" NOT NULL,
    "localized_revision_id" "uuid" NOT NULL
);

ALTER TABLE "public"."cottage_profile_localized_heads" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_profile_publication_decisions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "review_cycle_id" "uuid" NOT NULL,
    "administrator_user_id" "uuid" NOT NULL,
    "approved" boolean NOT NULL,
    "reason" "text" NOT NULL,
    "decided_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cottage_profile_publication_decisions_reason_check" CHECK ((("char_length"("btrim"("reason")) >= 1) AND ("char_length"("btrim"("reason")) <= 1000)))
);

ALTER TABLE "public"."cottage_profile_publication_decisions" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_profile_review_cycles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "source_revision_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "governorate" "text" NOT NULL,
    "approximate_location" "text" NOT NULL,
    "capacity" integer NOT NULL,
    "bedrooms" integer NOT NULL,
    "bathrooms" integer NOT NULL,
    "amenities" "text"[] NOT NULL,
    "cycle_number" integer NOT NULL,
    "state" "text" DEFAULT 'in_review'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "decided_at" timestamp with time zone,
    "remediation_publication_id" "uuid",
    CONSTRAINT "cottage_profile_review_cycle_decision_time" CHECK (((("state" = 'in_review'::"text") AND ("decided_at" IS NULL)) OR (("state" = ANY (ARRAY['approved'::"text", 'rejected'::"text"])) AND ("decided_at" IS NOT NULL)))),
    CONSTRAINT "cottage_profile_review_cycles_cycle_number_check" CHECK (("cycle_number" >= 1)),
    CONSTRAINT "cottage_profile_review_cycles_state_check" CHECK (("state" = ANY (ARRAY['in_review'::"text", 'approved'::"text", 'rejected'::"text"])))
);

ALTER TABLE "public"."cottage_profile_review_cycles" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_profile_review_photos" (
    "review_cycle_id" "uuid" NOT NULL,
    "photo_id" "uuid" NOT NULL,
    "position" integer NOT NULL,
    CONSTRAINT "cottage_profile_review_photos_position_check" CHECK (("position" >= 1))
);

ALTER TABLE "public"."cottage_profile_review_photos" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_profile_source_revisions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "source_language" "public"."cottage_profile_source_language" NOT NULL,
    "description" "text" NOT NULL,
    "house_rules" "text" NOT NULL,
    "revision" integer NOT NULL,
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cottage_profile_source_revisions_revision_check" CHECK (("revision" >= 1)),
    CONSTRAINT "cottage_profile_source_text_lengths" CHECK (char_length(description) between 1 and 2000 and char_length(house_rules) between 1 and 1500)
);

ALTER TABLE "public"."cottage_profile_source_revisions" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_publication_localizations" (
    "publication_id" "uuid" NOT NULL,
    "locale" "public"."cottage_profile_source_language" NOT NULL,
    "localized_revision_id" "uuid" NOT NULL,
    "description" "text" NOT NULL,
    "house_rules" "text" NOT NULL
);

ALTER TABLE "public"."cottage_publication_localizations" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_publication_media" (
    "publication_id" "uuid" NOT NULL,
    "photo_id" "uuid" NOT NULL,
    "opaque_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "object_path" "text" NOT NULL,
    "media_type" "text" NOT NULL,
    "position" integer NOT NULL,
    CONSTRAINT "cottage_publication_media_position_check" CHECK (("position" >= 1))
);

ALTER TABLE "public"."cottage_publication_media" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_shift_schedule_revisions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "revision" integer NOT NULL,
    "full_day_bundle_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cottage_shift_schedule_revisions_revision_check" CHECK (("revision" >= 1))
);

ALTER TABLE "public"."cottage_shift_schedule_revisions" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_shifts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "schedule_revision_id" "uuid" NOT NULL,
    "position" smallint NOT NULL,
    "name" "text" NOT NULL,
    "start_time" time without time zone NOT NULL,
    "end_time" time without time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cottage_shifts_check" CHECK (("start_time" <> "end_time")),
    CONSTRAINT "cottage_shifts_name_check" CHECK (("char_length"("btrim"("name")) >= 1)),
    CONSTRAINT "cottage_shifts_position_check" CHECK ((("position" >= 1) AND ("position" <= 3)))
);

ALTER TABLE "public"."cottage_shifts" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_translation_cache" (
    "cache_key" "text" NOT NULL,
    "result" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cottage_translation_cache_cache_key_check" CHECK (("cache_key" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "cottage_translation_cache_result_check" CHECK (("jsonb_typeof"("result") = 'object'::"text"))
);

ALTER TABLE "public"."cottage_translation_cache" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_translation_runtime_control" (
    "singleton" boolean DEFAULT true NOT NULL,
    "production_ready" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "approved_evaluation_artifact_digest" "text",
    "production_approval_digest" "text",
    "provider_terms_approval_reference" "text",
    "native_review_approval_reference" "text",
    "quality_threshold_approval_reference" "text",
    "ordinary_model" "text",
    "ordinary_effort" "text",
    "ordinary_prompt_version" "text",
    "stronger_model" "text",
    "stronger_effort" "text",
    "stronger_prompt_version" "text",
    "judge_model" "text",
    "judge_effort" "text",
    "judge_prompt_version" "text",
    "monthly_request_limit" bigint,
    "monthly_token_limit" bigint,
    "monthly_spend_microusd_limit" bigint,
    CONSTRAINT "cottage_translation_runtime__monthly_spend_microusd_limit_check" CHECK (("monthly_spend_microusd_limit" > 0)),
    CONSTRAINT "cottage_translation_runtime_control_monthly_request_limit_check" CHECK (("monthly_request_limit" > 0)),
    CONSTRAINT "cottage_translation_runtime_control_monthly_token_limit_check" CHECK (("monthly_token_limit" > 0)),
    CONSTRAINT "cottage_translation_runtime_control_singleton_check" CHECK ("singleton"),
    CONSTRAINT "cottage_translation_runtime_launch_gate" CHECK (((NOT "production_ready") OR COALESCE((("approved_evaluation_artifact_digest" ~ '^[0-9a-f]{64}$'::"text") AND ("production_approval_digest" ~ '^[0-9a-f]{64}$'::"text") AND ("char_length"("btrim"("provider_terms_approval_reference")) > 0) AND ("char_length"("btrim"("native_review_approval_reference")) > 0) AND ("char_length"("btrim"("quality_threshold_approval_reference")) > 0) AND ("char_length"("btrim"("ordinary_model")) > 0) AND ("ordinary_effort" = ANY (ARRAY['none'::"text", 'low'::"text", 'medium'::"text", 'high'::"text", 'xhigh'::"text", 'max'::"text"])) AND ("char_length"("btrim"("ordinary_prompt_version")) > 0) AND ("char_length"("btrim"("stronger_model")) > 0) AND ("stronger_effort" = ANY (ARRAY['none'::"text", 'low'::"text", 'medium'::"text", 'high'::"text", 'xhigh'::"text", 'max'::"text"])) AND ("char_length"("btrim"("stronger_prompt_version")) > 0) AND ("char_length"("btrim"("judge_model")) > 0) AND ("judge_effort" = ANY (ARRAY['none'::"text", 'low'::"text", 'medium'::"text", 'high'::"text", 'xhigh'::"text", 'max'::"text"])) AND ("char_length"("btrim"("judge_prompt_version")) > 0) AND ("monthly_request_limit" > 0) AND ("monthly_token_limit" > 0) AND ("monthly_spend_microusd_limit" > 0)), false)))
);

ALTER TABLE "public"."cottage_translation_runtime_control" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_translation_usage_reservations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cache_key" "text" NOT NULL,
    "model" "text" NOT NULL,
    "effort" "text" NOT NULL,
    "prompt_version" "text" NOT NULL,
    "reserved_tokens" bigint NOT NULL,
    "reserved_microusd" bigint NOT NULL,
    "billing_month" "date" NOT NULL,
    "reserved_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cottage_translation_usage_reservations_cache_key_check" CHECK (("cache_key" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "cottage_translation_usage_reservations_effort_check" CHECK (("effort" = ANY (ARRAY['none'::"text", 'low'::"text", 'medium'::"text", 'high'::"text", 'xhigh'::"text", 'max'::"text"]))),
    CONSTRAINT "cottage_translation_usage_reservations_model_check" CHECK (("char_length"("btrim"("model")) > 0)),
    CONSTRAINT "cottage_translation_usage_reservations_prompt_version_check" CHECK (("char_length"("btrim"("prompt_version")) > 0)),
    CONSTRAINT "cottage_translation_usage_reservations_reserved_microusd_check" CHECK (("reserved_microusd" > 0)),
    CONSTRAINT "cottage_translation_usage_reservations_reserved_tokens_check" CHECK (("reserved_tokens" > 0))
);

ALTER TABLE "public"."cottage_translation_usage_reservations" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."cottage_translation_usage_results" (
    "reservation_id" "uuid" NOT NULL,
    "input_tokens" bigint NOT NULL,
    "output_tokens" bigint NOT NULL,
    "total_tokens" bigint NOT NULL,
    "actual_microusd" bigint NOT NULL,
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cottage_translation_usage_results_actual_microusd_check" CHECK (("actual_microusd" >= 0)),
    CONSTRAINT "cottage_translation_usage_results_check" CHECK (("total_tokens" = ("input_tokens" + "output_tokens"))),
    CONSTRAINT "cottage_translation_usage_results_input_tokens_check" CHECK (("input_tokens" >= 0)),
    CONSTRAINT "cottage_translation_usage_results_output_tokens_check" CHECK (("output_tokens" >= 0))
);

ALTER TABLE "public"."cottage_translation_usage_results" OWNER TO "postgres";
