CREATE TABLE IF NOT EXISTS public.customer_reviews (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  booking_request_id uuid NOT NULL,
  booking_confirmation_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  author_user_id uuid NOT NULL,
  rating smallint NOT NULL,
  original_language public.cottage_profile_source_language NOT NULL,
  original_body text,
  submitted_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT customer_reviews_rating_check CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT customer_reviews_original_body_check CHECK (
    original_body IS NULL
    OR (char_length(original_body) <= 2000 AND original_body ~ '\S')
  )
);

ALTER TABLE public.customer_reviews OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.customer_review_hides (
  review_id uuid NOT NULL,
  administrator_user_id uuid NOT NULL,
  reason text NOT NULL,
  hidden_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT customer_review_hides_reason_check CHECK (
    reason ~ '\S' AND char_length(btrim(reason)) <= 2000
  )
);

ALTER TABLE public.customer_review_hides OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.customer_review_replies (
  review_id uuid NOT NULL,
  author_user_id uuid NOT NULL,
  original_language public.cottage_profile_source_language NOT NULL,
  original_body text NOT NULL,
  submitted_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT customer_review_replies_original_body_check CHECK (
    char_length(original_body) <= 2000
      AND original_body ~ '[^\s\uFEFF]'
  )
);

ALTER TABLE public.customer_review_replies OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.customer_review_reply_hides (
  review_id uuid NOT NULL,
  administrator_user_id uuid NOT NULL,
  reason text NOT NULL,
  hidden_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT customer_review_reply_hides_reason_check CHECK (
    reason ~ '[^\s\uFEFF]' AND char_length(btrim(reason)) <= 2000
  )
);

ALTER TABLE public.customer_review_reply_hides OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.customer_review_translations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  review_id uuid NOT NULL,
  subject text NOT NULL,
  target_language public.cottage_profile_source_language NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  translated_body text NOT NULL,
  created_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT customer_review_translations_subject_check CHECK (
    subject IN ('review','reply')
  ),
  -- Twice the 2,000 source cap, so a faithful rendering of a full-length original is not refused.
  CONSTRAINT customer_review_translations_translated_body_check CHECK (
    char_length(translated_body) <= 4000
      AND translated_body ~ '[^\s\uFEFF]'
  ),
  CONSTRAINT customer_review_translations_provenance_check CHECK (
    provider = btrim(provider) AND char_length(provider) >= 1 AND char_length(provider) <= 80
      AND model = btrim(model) AND char_length(model) >= 1 AND char_length(model) <= 120
      AND prompt_version = btrim(prompt_version) AND char_length(prompt_version) >= 1 AND char_length(prompt_version) <= 120
  )
);

ALTER TABLE public.customer_review_translations OWNER TO postgres;
