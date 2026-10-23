-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

ALTER TABLE public.simulated_payment_effects
  DROP CONSTRAINT simulated_payment_effect_scope;

CREATE OR REPLACE FUNCTION public.validate_simulated_payment_binding (
  target_binding jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if current_setting('role',true)<>'service_role' then raise exception 'Fictional effect unavailable' using errcode='42501'; end if;
  if target_binding is null or jsonb_typeof(target_binding)<>'object'
    or target_binding ?& array['operationId','providerIdentity','idempotencyKey','requestFingerprint','notBefore','notAfter'] is not true
    or target_binding-array['operationId','providerIdentity','idempotencyKey','requestFingerprint','notBefore','notAfter']<>'{}'
    or (target_binding->'providerIdentity' is distinct from '{"provider":"fictional-payments","environment":"local-test","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb
      and target_binding->'providerIdentity' is distinct from '{"provider":"fictional-payments","environment":"hosted-demo-yvibcyqtyihpzpmomnzg","merchantId":"fictional-merchant","terminalId":"fictional-terminal"}'::jsonb)
    or (target_binding->>'operationId')::uuid is null or coalesce(length(target_binding->>'idempotencyKey'),0)=0
    or coalesce(target_binding->>'requestFingerprint','') !~ '^[0-9a-f]{64}$'
    or (target_binding->>'notBefore' is not null and not isfinite((target_binding->>'notBefore')::timestamptz))
    or (target_binding->>'notAfter' is not null and not isfinite((target_binding->>'notAfter')::timestamptz)) then
    raise exception 'Fictional effect binding is invalid' using errcode='RC409'; end if;
end;
$function$;

ALTER TABLE public.simulated_payment_effects
  ADD CONSTRAINT simulated_payment_effect_scope
    CHECK
    (length(provider) > 0 AND environment = 'local-test'::text AND length(merchant_id) > 0 AND length(terminal_id) > 0 OR provider = 'fictional-payments'::text AND environment =
    'hosted-demo-yvibcyqtyihpzpmomnzg'::text AND merchant_id = 'fictional-merchant'::text AND terminal_id = 'fictional-terminal'::text);