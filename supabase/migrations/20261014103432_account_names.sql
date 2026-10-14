-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.save_account_name (
  account_first_name text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  caller_role public.account_role;
begin
  select account_contexts.role into caller_role
  from public.account_contexts
  where account_contexts.user_id = (select auth.uid());

  if caller_role is null then
    raise exception 'A marketplace account is required'
      using errcode = '42501';
  end if;

  if caller_role = 'platform_administrator' and public.is_platform_administrator('aal2') is not true then
    raise exception 'Two-step sign-in is required'
      using errcode = '42501';
  end if;

  insert into public.account_names (user_id, first_name)
  values ((select auth.uid()), account_first_name)
  on conflict (user_id) do update
    set first_name = excluded.first_name, updated_at = now();
end;
$function$;

REVOKE ALL ON FUNCTION public.save_account_name(text) FROM PUBLIC,anon,service_role;

GRANT EXECUTE ON FUNCTION public.save_account_name(text) TO authenticated;

CREATE TABLE public.account_names (
  user_id    uuid                     NOT NULL,
  first_name text                     NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

REVOKE ALL ON TABLE public.account_names FROM anon,authenticated,service_role;

ALTER TABLE public.account_names
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.account_names
  ADD CONSTRAINT account_names_first_name_shape
    CHECK (first_name = btrim(first_name) AND char_length(first_name) >= 1 AND char_length(first_name) <= 50 AND first_name !~ '[[:cntrl:]]'::text);

ALTER TABLE public.account_names
  ADD CONSTRAINT account_names_pkey PRIMARY KEY (user_id);

ALTER TABLE public.account_names
  ADD CONSTRAINT account_names_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.account_contexts(user_id) ON DELETE CASCADE;

GRANT SELECT ON public.account_names TO authenticated;

CREATE POLICY "Account holder reads own name" ON public.account_names
  FOR SELECT
  TO authenticated
  USING ((( SELECT auth.uid() AS uid) = user_id));