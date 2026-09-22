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
    OR char_length(original_body) >= 1
      AND char_length(original_body) <= 2000
      AND char_length(btrim(original_body)) >= 1
  )
);

ALTER TABLE public.customer_reviews OWNER TO postgres;

CREATE TABLE IF NOT EXISTS public.customer_review_hides (
  review_id uuid NOT NULL,
  administrator_user_id uuid NOT NULL,
  reason text NOT NULL,
  hidden_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT customer_review_hides_reason_check CHECK (
    char_length(btrim(reason)) BETWEEN 1 AND 2000
  )
);

ALTER TABLE public.customer_review_hides OWNER TO postgres;
