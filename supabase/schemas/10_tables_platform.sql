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

CREATE TABLE IF NOT EXISTS "public"."account_contexts" (
    "user_id" "uuid" NOT NULL,
    "role" "public"."account_role" NOT NULL,
    "owner_approval_state" "public"."owner_approval_state",
    "customer_suspended" boolean DEFAULT false NOT NULL,
    "customer_suspension_revision" bigint DEFAULT 0 NOT NULL,
    "owner_suspension_revision" bigint DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "owner_approval_matches_role" CHECK (((("role" = 'cottage_owner'::"public"."account_role") AND ("owner_approval_state" IS NOT NULL)) OR (("role" <> 'cottage_owner'::"public"."account_role") AND ("owner_approval_state" IS NULL))))
);

ALTER TABLE "public"."account_contexts" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."account_names" (
    "user_id" "uuid" NOT NULL,
    "first_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."account_names" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."privileged_sign_in_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_user_id" "uuid",
    "email_digest" "text" NOT NULL,
    "stage" "text" NOT NULL,
    "outcome" "text" NOT NULL,
    "attempted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "privileged_sign_in_attempts_email_digest_check" CHECK (("length"("email_digest") = 64)),
    CONSTRAINT "privileged_sign_in_attempts_outcome_check" CHECK (("outcome" = ANY (ARRAY['succeeded'::"text", 'failed'::"text"]))),
    CONSTRAINT "privileged_sign_in_attempts_stage_check" CHECK (("stage" = ANY (ARRAY['primary'::"text", 'mfa'::"text"])))
);

ALTER TABLE "public"."privileged_sign_in_attempts" OWNER TO "postgres";

COMMENT ON TABLE "public"."privileged_sign_in_attempts" IS 'Privileged access security audit retained for 180 days';

CREATE TABLE IF NOT EXISTS private.marketplace_suspension_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    command_id uuid NOT NULL,
    target_kind text NOT NULL,
    account_user_id uuid,
    profile_id uuid,
    actor_user_id uuid NOT NULL,
    action text NOT NULL,
    expected_revision bigint NOT NULL,
    resulting_revision bigint NOT NULL,
    from_state text NOT NULL,
    to_state text NOT NULL,
    reason text NOT NULL,
    created_at timestamptz DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT marketplace_suspension_action_target CHECK (
      (target_kind IN ('customer','owner') AND account_user_id IS NOT NULL AND profile_id IS NULL)
      OR (target_kind='cottage' AND profile_id IS NOT NULL AND account_user_id IS NULL)),
    CONSTRAINT marketplace_suspension_action_kind CHECK (action IN ('suspend','reactivate')),
    CONSTRAINT marketplace_suspension_action_reason CHECK (reason=regexp_replace(reason,'^[[:space:]]+|[[:space:]]+$','','g') AND char_length(reason) BETWEEN 1 AND 1000),
    CONSTRAINT marketplace_suspension_action_revision CHECK (expected_revision>=0 AND resulting_revision=expected_revision+1)
);
ALTER TABLE private.marketplace_suspension_actions OWNER TO postgres;
