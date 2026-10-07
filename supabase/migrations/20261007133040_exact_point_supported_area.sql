-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

-- Hand-written precondition: this migration corrects no stored exact point.
DO $precondition$
DECLARE
  outside_count bigint;
BEGIN
  SELECT count(*) INTO outside_count
  FROM public.owner_application_cottage_profiles
  WHERE exact_latitude NOT BETWEEN 29.0 AND 37.4
    OR exact_longitude NOT BETWEEN 38.7 AND 49.2;
  IF outside_count > 0 THEN
    RAISE EXCEPTION 'Stored Cottage Profile exact points outside the supported area (latitude 29.0 to 37.4, longitude 38.7 to 49.2): %. Nothing was changed. Correct or clear them, then apply this migration again.', outside_count;
  END IF;
END;
$precondition$;

ALTER TABLE public.owner_application_cottage_profiles
  DROP CONSTRAINT cottage_profile_private_location_pair;

ALTER TABLE public.owner_application_cottage_profiles
  ADD CONSTRAINT cottage_profile_private_location_pair CHECK (exact_latitude IS NULL AND exact_longitude IS NULL OR exact_latitude IS NOT NULL AND exact_longitude IS
    NOT NULL AND exact_latitude >= 29.0 AND exact_latitude <= 37.4 AND exact_longitude >= 38.7 AND exact_longitude <= 49.2);