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
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "owner_approval_matches_role" CHECK (((("role" = 'cottage_owner'::"public"."account_role") AND ("owner_approval_state" IS NOT NULL)) OR (("role" <> 'cottage_owner'::"public"."account_role") AND ("owner_approval_state" IS NULL))))
);

ALTER TABLE "public"."account_contexts" OWNER TO "postgres";

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
