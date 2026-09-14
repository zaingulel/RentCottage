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

CREATE TABLE IF NOT EXISTS "public"."messaging_conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "customer_user_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "creation_command_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "messaging_conversations_distinct_participants" CHECK (("customer_user_id" <> "owner_user_id"))
);

ALTER TABLE "public"."messaging_conversations" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."messaging_conversation_booking_requests" (
    "conversation_id" "uuid" NOT NULL,
    "booking_request_id" "uuid" NOT NULL,
    "submission_attempt_id" "uuid" NOT NULL,
    "linked_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL
);

ALTER TABLE "public"."messaging_conversation_booking_requests" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."messaging_send_attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "command_id" "uuid" NOT NULL,
    "actor_user_id" "uuid" NOT NULL,
    "outcome" "text" NOT NULL,
    "blocked_category" "text",
    "occurred_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "messaging_send_attempts_outcome" CHECK ((
      ("outcome" = 'sent'::"text" AND "blocked_category" IS NULL) OR
      ("outcome" = 'blocked'::"text" AND "blocked_category" = 'contact'::"text")
    ))
);

ALTER TABLE "public"."messaging_send_attempts" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."messaging_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "send_attempt_id" "uuid" NOT NULL,
    "sender_user_id" "uuid" NOT NULL,
    "original_language" "public"."cottage_profile_source_language" NOT NULL,
    "original_body" "text" NOT NULL,
    "contact_protected" boolean NOT NULL,
    "position" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "messaging_messages_original_body" CHECK ((
      "original_body" = "btrim"("original_body") AND
      "char_length"("original_body") >= 1 AND
      "char_length"("original_body") <= 2000
    ))
);

ALTER TABLE "public"."messaging_messages" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."messaging_translations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message_id" "uuid" NOT NULL,
    "target_language" "public"."cottage_profile_source_language" NOT NULL,
    "provider" "text" NOT NULL,
    "model" "text" NOT NULL,
    "prompt_version" "text" NOT NULL,
    "translated_body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "messaging_translations_body" CHECK ((
      "translated_body" = "btrim"("translated_body") AND
      "char_length"("translated_body") >= 1 AND
      "char_length"("translated_body") <= 2000
    )),
    CONSTRAINT "messaging_translations_provenance" CHECK ((
      "provider" = "btrim"("provider") AND "char_length"("provider") >= 1 AND "char_length"("provider") <= 80 AND
      "model" = "btrim"("model") AND "char_length"("model") >= 1 AND "char_length"("model") <= 120 AND
      "prompt_version" = "btrim"("prompt_version") AND "char_length"("prompt_version") >= 1 AND "char_length"("prompt_version") <= 120
    ))
);

ALTER TABLE "public"."messaging_translations" OWNER TO "postgres";

CREATE TABLE IF NOT EXISTS "public"."messaging_translation_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "translation_id" "uuid" NOT NULL,
    "reporter_user_id" "uuid" NOT NULL,
    "command_id" "uuid" NOT NULL,
    "category" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "messaging_translation_reports_category" CHECK (("category" = ANY (ARRAY[
      'incorrect'::"text", 'unclear'::"text", 'inappropriate'::"text"
    ])))
);

ALTER TABLE "public"."messaging_translation_reports" OWNER TO "postgres";
