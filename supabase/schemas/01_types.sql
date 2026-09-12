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

CREATE TYPE "public"."account_role" AS ENUM (
    'customer',
    'cottage_owner',
    'platform_administrator'
);

ALTER TYPE "public"."account_role" OWNER TO "postgres";

CREATE TYPE "public"."booking_request_authorization_claim_state" AS ENUM (
    'starting',
    'not_started',
    'failed',
    'reconciliation_required',
    'authorized',
    'releasing',
    'released',
    'expired',
    'converted'
);

ALTER TYPE "public"."booking_request_authorization_claim_state" OWNER TO "postgres";

CREATE TYPE "public"."cottage_inventory_availability_state" AS ENUM (
    'open',
    'closed',
    'private_blocked'
);

ALTER TYPE "public"."cottage_inventory_availability_state" OWNER TO "postgres";

CREATE TYPE "public"."cottage_inventory_commitment_status" AS ENUM (
    'pending_hold',
    'confirmed_booking',
    'cancelled_booking',
    'released_hold'
);

ALTER TYPE "public"."cottage_inventory_commitment_status" OWNER TO "postgres";

CREATE TYPE "public"."cottage_inventory_unit_kind" AS ENUM (
    'shift',
    'full_day_bundle'
);

ALTER TYPE "public"."cottage_inventory_unit_kind" OWNER TO "postgres";

CREATE TYPE "public"."cottage_marketplace_state" AS ENUM (
    'published',
    'paused',
    'suspended'
);

ALTER TYPE "public"."cottage_marketplace_state" OWNER TO "postgres";

CREATE TYPE "public"."cottage_profile_photo_state" AS ENUM (
    'pending',
    'ready',
    'deletion_pending'
);

ALTER TYPE "public"."cottage_profile_photo_state" OWNER TO "postgres";

CREATE TYPE "public"."cottage_profile_source_language" AS ENUM (
    'ar',
    'ckb',
    'en'
);

ALTER TYPE "public"."cottage_profile_source_language" OWNER TO "postgres";

CREATE TYPE "public"."cottage_profile_status" AS ENUM (
    'draft',
    'submitted_for_content_approval',
    'abandoned'
);

ALTER TYPE "public"."cottage_profile_status" OWNER TO "postgres";

CREATE TYPE "public"."owner_applicant_kind" AS ENUM (
    'individual',
    'company'
);

ALTER TYPE "public"."owner_applicant_kind" OWNER TO "postgres";

CREATE TYPE "public"."owner_application_status" AS ENUM (
    'draft',
    'submitted',
    'needs_information',
    'under_review',
    'approved',
    'rejected',
    'expired',
    'suspended'
);

ALTER TYPE "public"."owner_application_status" OWNER TO "postgres";

CREATE TYPE "public"."owner_approval_state" AS ENUM (
    'prospective',
    'approved',
    'expired',
    'suspended'
);

ALTER TYPE "public"."owner_approval_state" OWNER TO "postgres";

CREATE TYPE "public"."owner_licensing_basis" AS ENUM (
    'licence',
    'exemption'
);

ALTER TYPE "public"."owner_licensing_basis" OWNER TO "postgres";

CREATE TYPE "public"."owner_verification_access_grant_status" AS ENUM (
    'pending',
    'completed',
    'expired'
);

ALTER TYPE "public"."owner_verification_access_grant_status" OWNER TO "postgres";

CREATE TYPE "public"."owner_verification_cleanup_reason" AS ENUM (
    'unregistered_upload',
    'replaced'
);

ALTER TYPE "public"."owner_verification_cleanup_reason" OWNER TO "postgres";

CREATE TYPE "public"."owner_verification_cleanup_status" AS ENUM (
    'pending',
    'completed'
);

ALTER TYPE "public"."owner_verification_cleanup_status" OWNER TO "postgres";

CREATE TYPE "public"."owner_verification_document_action" AS ENUM (
    'uploaded',
    'replaced',
    'access_granted',
    'deleted'
);

ALTER TYPE "public"."owner_verification_document_action" OWNER TO "postgres";

CREATE TYPE "public"."owner_verification_document_kind" AS ENUM (
    'identity',
    'company_registration',
    'authorised_representative',
    'authority_to_rent',
    'licensing_or_exemption',
    'payout_account'
);

ALTER TYPE "public"."owner_verification_document_kind" OWNER TO "postgres";
