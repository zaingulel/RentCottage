-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

ALTER TYPE public.cottage_inventory_commitment_status ADD VALUE 'cancelled_booking' AFTER 'confirmed_booking';
