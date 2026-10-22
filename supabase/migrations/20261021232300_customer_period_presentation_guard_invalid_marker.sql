-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

ALTER TABLE public.booking_snapshots
  ADD CONSTRAINT booking_snapshots_period_presentation_check CHECK (period_presentation = ANY (ARRAY['morning-evening-v1'::text, 'original-names'::text]));