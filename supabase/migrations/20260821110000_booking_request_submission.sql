-- Booking Request submission is forward-only. Payment and reconciliation
-- evidence must be retained until every authorization has a definitive outcome.

create function public.get_public_booking_quote_with_fingerprint(
  target_locale public.cottage_profile_source_language,
  target_slug text,
  requested_search jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare quote jsonb;
declare fingerprint text;
begin
  quote := public.get_public_booking_quote(
    target_locale, target_slug, requested_search
  );
  if quote ->> 'status' <> 'quoted' then
    return quote;
  end if;
  fingerprint := encode(
    extensions.digest(
      convert_to((quote - 'status')::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  return quote || jsonb_build_object('quoteFingerprint', fingerprint);
end;
$$;

revoke all on function public.get_public_booking_quote_with_fingerprint(
  public.cottage_profile_source_language, text, jsonb
) from public;
grant execute on function public.get_public_booking_quote_with_fingerprint(
  public.cottage_profile_source_language, text, jsonb
) to anon, authenticated, service_role;

create table public.booking_request_submission_attempts (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null
    references public.account_contexts (user_id) on delete restrict,
  idempotency_key uuid not null,
  payment_lifecycle_id uuid not null unique,
  profile_id uuid not null
    references public.owner_application_cottage_profiles (id) on delete restrict,
  locale public.cottage_profile_source_language not null,
  public_slug text not null,
  requested_search jsonb not null,
  quote_fingerprint text not null check (quote_fingerprint ~ '^[0-9a-f]{64}$'),
  quote_payload jsonb not null,
  intent_fingerprint text not null check (intent_fingerprint ~ '^[0-9a-f]{64}$'),
  intent_payload jsonb not null,
  payment_snapshot jsonb,
  authorization_provider text,
  authorization_environment text,
  authorization_merchant_id text,
  authorization_terminal_id text,
  authorization_provider_request_id text,
  authorization_provider_reference text,
  authorization_movement_reference text,
  release_provider_request_id text,
  release_provider_reference text,
  release_movement_reference text,
  state text not null check (state in (
    'authorizing', 'authorized', 'authorization_failed',
    'reconciliation_required', 'releasing', 'released', 'finalized'
  )),
  booking_request_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nulls(
    authorization_provider, authorization_environment,
    authorization_merchant_id, authorization_terminal_id
  ) in (0, 4)),
  check (
    (authorization_provider_request_id is null) =
      (authorization_provider_reference is null)
  ),
  check (
    authorization_movement_reference is null
    or authorization_provider_request_id is not null
  ),
  check (
    (release_provider_request_id is null) =
      (release_provider_reference is null)
  ),
  check (
    release_movement_reference is null
    or release_provider_request_id is not null
  ),
  unique (customer_user_id, idempotency_key),
  unique (customer_user_id, intent_fingerprint)
);

create unique index booking_request_authorization_provider_request_unique
  on public.booking_request_submission_attempts (
    authorization_provider, authorization_environment,
    authorization_merchant_id, authorization_terminal_id,
    authorization_provider_request_id
  ) where authorization_provider_request_id is not null;
create unique index booking_request_authorization_provider_reference_unique
  on public.booking_request_submission_attempts (
    authorization_provider, authorization_environment,
    authorization_merchant_id, authorization_terminal_id,
    authorization_provider_reference
  ) where authorization_provider_reference is not null;
create unique index booking_request_authorization_movement_unique
  on public.booking_request_submission_attempts (
    authorization_provider, authorization_environment,
    authorization_merchant_id, authorization_terminal_id,
    authorization_movement_reference
  ) where authorization_movement_reference is not null;
create unique index booking_request_release_provider_request_unique
  on public.booking_request_submission_attempts (
    authorization_provider, authorization_environment,
    authorization_merchant_id, authorization_terminal_id,
    release_provider_request_id
  ) where release_provider_request_id is not null;
create unique index booking_request_release_provider_reference_unique
  on public.booking_request_submission_attempts (
    authorization_provider, authorization_environment,
    authorization_merchant_id, authorization_terminal_id,
    release_provider_reference
  ) where release_provider_reference is not null;
create unique index booking_request_release_movement_unique
  on public.booking_request_submission_attempts (
    authorization_provider, authorization_environment,
    authorization_merchant_id, authorization_terminal_id,
    release_movement_reference
  ) where release_movement_reference is not null;

create table public.booking_request_provider_operation_identities (
  attempt_id uuid not null
    references public.booking_request_submission_attempts (id) on delete restrict,
  operation_kind text not null check (operation_kind in ('authorization', 'release')),
  provider text not null,
  environment text not null,
  merchant_id text not null,
  terminal_id text not null,
  provider_request_id text not null,
  provider_reference text not null,
  movement_reference text,
  primary key (attempt_id, operation_kind),
  unique (provider, environment, merchant_id, terminal_id, provider_request_id),
  unique (provider, environment, merchant_id, terminal_id, provider_reference),
  unique (provider, environment, merchant_id, terminal_id, movement_reference)
);

create type public.booking_request_authorization_claim_state as enum (
  'starting', 'not_started', 'failed', 'reconciliation_required', 'authorized',
  'releasing', 'released', 'converted'
);

create function public.booking_request_claim_state_is_active(
  target_state public.booking_request_authorization_claim_state
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select target_state in (
    'starting', 'reconciliation_required', 'authorized', 'releasing'
  );
$$;

create function public.booking_request_claim_state_is_reconcilable(
  target_state public.booking_request_authorization_claim_state
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select target_state in ('starting', 'reconciliation_required', 'releasing');
$$;

create function public.booking_request_claim_state_is_terminal(
  target_state public.booking_request_authorization_claim_state
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select target_state in ('not_started', 'failed', 'released', 'converted');
$$;

create function public.booking_request_claim_state_allows_authorization(
  target_state public.booking_request_authorization_claim_state
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select target_state in ('starting', 'reconciliation_required');
$$;

create function public.booking_request_claim_state_after_payment(
  current_state public.booking_request_authorization_claim_state,
  next_attempt_state text,
  authorization_has_provider_request boolean,
  release_status text
)
returns public.booking_request_authorization_claim_state
language sql
immutable
set search_path = ''
as $$
  select case
    when public.booking_request_claim_state_is_terminal(current_state)
      then current_state
    when next_attempt_state = 'authorized' then 'authorized'
    when next_attempt_state = 'authorization_failed'
      and not authorization_has_provider_request then 'not_started'
    when next_attempt_state = 'authorization_failed' then 'failed'
    when next_attempt_state = 'released' then 'released'
    when next_attempt_state = 'releasing' and release_status = 'failed' then 'failed'
    when next_attempt_state = 'releasing' then 'releasing'
    when next_attempt_state = 'reconciliation_required'
      then 'reconciliation_required'
    else current_state
  end::public.booking_request_authorization_claim_state;
$$;

revoke all on function public.booking_request_claim_state_is_active(
  public.booking_request_authorization_claim_state
) from public, anon, authenticated, service_role;
revoke all on function public.booking_request_claim_state_is_reconcilable(
  public.booking_request_authorization_claim_state
) from public, anon, authenticated, service_role;
revoke all on function public.booking_request_claim_state_is_terminal(
  public.booking_request_authorization_claim_state
) from public, anon, authenticated, service_role;
revoke all on function public.booking_request_claim_state_allows_authorization(
  public.booking_request_authorization_claim_state
) from public, anon, authenticated, service_role;
revoke all on function public.booking_request_claim_state_after_payment(
  public.booking_request_authorization_claim_state, text, boolean, text
) from public, anon, authenticated, service_role;

create table public.booking_request_authorization_claims (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null unique
    references public.booking_request_submission_attempts (id) on delete restrict,
  generation integer not null default 1 check (generation > 0),
  state_revision bigint not null default 1 check (state_revision > 0),
  state public.booking_request_authorization_claim_state not null,
  customer_user_id uuid not null
    references public.account_contexts (user_id) on delete restrict,
  profile_id uuid not null
    references public.owner_application_cottage_profiles (id) on delete restrict,
  schedule_revision_id uuid not null,
  payment_lifecycle_id uuid not null unique,
  logical_operation_id text not null,
  physical_attempt_id text not null,
  amount_fils bigint not null check (amount_fils > 0),
  currency text not null check (currency = 'IQD'),
  provider text not null,
  environment text not null,
  merchant_id text not null,
  terminal_id text not null,
  provider_idempotency_key text not null,
  quote_fingerprint text not null check (quote_fingerprint ~ '^[0-9a-f]{64}$'),
  intent_fingerprint text not null check (intent_fingerprint ~ '^[0-9a-f]{64}$'),
  access_ranges tstzmultirange not null check (not isempty(access_ranges)),
  not_after timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, generation),
  unique (provider, environment, merchant_id, terminal_id, provider_idempotency_key),
  foreign key (schedule_revision_id, profile_id)
    references public.cottage_shift_schedule_revisions (id, profile_id)
    on delete restrict,
  constraint booking_request_authorization_customer_access_excl exclude using gist (
    customer_user_id with =,
    access_ranges with &&
  ) where (public.booking_request_claim_state_is_active(state))
);

create table public.booking_request_authorization_claim_items (
  claim_id uuid not null
    references public.booking_request_authorization_claims (id) on delete restrict,
  unit_kind public.cottage_inventory_unit_kind not null,
  unit_id uuid not null,
  service_day date not null,
  price_iqd bigint not null check (price_iqd > 0),
  primary key (claim_id, service_day, unit_kind, unit_id)
);

create table public.booking_request_authorization_claim_occupancies (
  claim_id uuid not null
    references public.booking_request_authorization_claims (id) on delete restrict,
  schedule_revision_id uuid not null,
  shift_id uuid not null,
  service_day date not null,
  active boolean not null default true,
  primary key (claim_id, schedule_revision_id, shift_id, service_day),
  foreign key (schedule_revision_id, shift_id)
    references public.cottage_shifts (schedule_revision_id, id) on delete restrict
);
create unique index booking_request_active_claim_occupancy_unique
  on public.booking_request_authorization_claim_occupancies (
    schedule_revision_id, shift_id, service_day
  ) where active;

create table public.booking_request_authorization_reconciliation_outbox (
  claim_id uuid primary key
    references public.booking_request_authorization_claims (id) on delete restrict,
  claim_generation integer not null,
  observed_state_revision bigint not null,
  state text not null check (state in ('pending', 'complete')),
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (claim_id, claim_generation)
    references public.booking_request_authorization_claims (id, generation)
    on delete restrict,
  check ((lease_token is null) = (lease_expires_at is null)),
  check (state = 'pending' or lease_token is null)
);

create table public.booking_snapshots (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null
    references public.account_contexts (user_id) on delete restrict,
  profile_id uuid not null
    references public.owner_application_cottage_profiles (id) on delete restrict,
  quote_fingerprint text not null check (quote_fingerprint ~ '^[0-9a-f]{64}$'),
  intent_fingerprint text not null check (intent_fingerprint ~ '^[0-9a-f]{64}$'),
  quote_payload jsonb not null,
  intent_payload jsonb not null,
  booking_terms_version text not null,
  cancellation_policy_version text not null,
  acceptance_locale public.cottage_profile_source_language not null,
  acceptance_evidence jsonb not null,
  acceptance_evidence_fingerprint text not null
    check (acceptance_evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  marketplace_commission_rate_basis_points smallint not null
    check (marketplace_commission_rate_basis_points = 1000),
  marketplace_commission_amount_fils bigint not null check (
    marketplace_commission_amount_fils > 0
    and marketplace_commission_amount_fils =
      (quote_payload ->> 'bookingPriceIqd')::bigint * 100
  ),
  created_at timestamptz not null default now()
);

create table public.booking_requests (
  id uuid primary key,
  booking_request_reference text not null unique
    check (booking_request_reference ~ '^RC-REQ-[A-F0-9]{16}$'),
  customer_user_id uuid not null
    references public.account_contexts (user_id) on delete restrict,
  owner_user_id uuid not null
    references public.account_contexts (user_id) on delete restrict,
  profile_id uuid not null
    references public.owner_application_cottage_profiles (id) on delete restrict,
  booking_snapshot_id uuid not null unique
    references public.booking_snapshots (id) on delete restrict,
  booking_period_commitment_id uuid not null unique
    references public.cottage_booking_period_commitments (id) on delete restrict,
  payment_lifecycle_id uuid not null unique,
  customer_name text not null check (
    customer_name = btrim(customer_name)
    and char_length(customer_name) between 2 and 120
  ),
  party_size smallint not null check (party_size between 1 and 1000),
  booking_note text check (
    booking_note = btrim(booking_note)
    and char_length(booking_note) between 1 and 500
  ),
  status text not null check (status = 'pending'),
  response_deadline timestamptz not null,
  created_at timestamptz not null default now(),
  check (response_deadline = created_at + interval '4 hours')
);

alter table public.booking_request_submission_attempts
  add constraint booking_request_submission_attempt_request_fkey
  foreign key (booking_request_id) references public.booking_requests (id)
  on delete restrict;

create table public.owner_request_notifications (
  id uuid primary key default gen_random_uuid(),
  booking_request_id uuid not null unique
    references public.booking_requests (id) on delete restrict,
  owner_user_id uuid not null
    references public.account_contexts (user_id) on delete restrict,
  channel text not null default 'in_product' check (channel = 'in_product'),
  created_at timestamptz not null default now(),
  seen_at timestamptz
);

create index booking_request_submission_customer_idx
  on public.booking_request_submission_attempts (customer_user_id, created_at desc);
create index booking_requests_customer_idx
  on public.booking_requests (customer_user_id, created_at desc);
create index booking_requests_owner_idx
  on public.booking_requests (owner_user_id, response_deadline);
create index owner_request_notifications_owner_idx
  on public.owner_request_notifications (owner_user_id, created_at desc);

alter table public.booking_request_submission_attempts enable row level security;
alter table public.booking_request_provider_operation_identities enable row level security;
alter table public.booking_request_authorization_claims enable row level security;
alter table public.booking_request_authorization_claim_items enable row level security;
alter table public.booking_request_authorization_claim_occupancies enable row level security;
alter table public.booking_request_authorization_reconciliation_outbox enable row level security;
alter table public.booking_snapshots enable row level security;
alter table public.booking_requests enable row level security;
alter table public.owner_request_notifications enable row level security;

revoke all on public.booking_request_submission_attempts,
  public.booking_request_provider_operation_identities,
  public.booking_request_authorization_claims,
  public.booking_request_authorization_claim_items,
  public.booking_request_authorization_claim_occupancies,
  public.booking_request_authorization_reconciliation_outbox,
  public.booking_snapshots,
  public.booking_requests,
  public.owner_request_notifications
from public, anon, authenticated, service_role;

create function public.reject_booking_snapshot_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Booking Snapshots are immutable' using errcode = 'RC204';
end;
$$;

revoke all on function public.reject_booking_snapshot_change()
  from public, anon, authenticated, service_role;

create trigger reject_booking_snapshot_update
before update or delete on public.booking_snapshots
for each row execute function public.reject_booking_snapshot_change();

create function public.booking_request_content_is_safe(target_value text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  with normalized as (
    select regexp_replace(
      target_value,
      U&'[\00AD\034F\061C\115F-\1160\17B4-\17B5\180B-\180F\200B-\200F\202A-\202E\2060-\206F\3164\FE00-\FE0F\FEFF\FFA0\FFF0-\FFF8\+013430-\+01343F\+01BCA0-\+01BCA3\+01D173-\+01D17A\+0E0000-\+0E0FFF]',
      '',
      'g'
    ) as value
  )
  select target_value is not null
    and translate(value, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789')
      !~ '([0-9][[:space:]()\[\]{}+./_‐‑‒–—―−-]*){7,}'
    and value !~* '[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+'
    and value !~* '(https?://|www\.|[[:alnum:]-]+\.(com|net|org|me|io|co|iq)([^[:alnum:]]|$))'
    and value !~* '(^|[^[:alnum:]_])@[[:alnum:]_][[:alnum:]_.-]{1,31}([^[:alnum:]_.-]|$)'
    and value !~* '(whats?app|telegram|instagram|facebook|snapchat|tiktok)'
    and value !~* '(^|[^[:alpha:]])(zero|one|two|three|four|five|six|seven|eight|nine|صفر|واحد|اثنان|اثنين|ثلاثة|أربعة|اربعة|خمسة|ستة|سبعة|ثمانية|تسعة|سفر|یەک|یەك|دوو|سێ|چوار|پێنج|شەش|حەوت|هەشت|نۆ)([[:space:][:punct:]]+(zero|one|two|three|four|five|six|seven|eight|nine|صفر|واحد|اثنان|اثنين|ثلاثة|أربعة|اربعة|خمسة|ستة|سبعة|ثمانية|تسعة|سفر|یەک|یەك|دوو|سێ|چوار|پێنج|شەش|حەوت|هەشت|نۆ)){6}'
    and value !~* '(^|[^[:alnum:]_])[[:alnum:]_-]+[[:space:][:punct:]]+(at|ات|آت|ئەت)[[:space:][:punct:]]+[[:alnum:]_-]+[[:space:][:punct:]]+(dot|دوت|نقطة|دۆت)[[:space:][:punct:]]+(com|net|org|iq)([^[:alnum:]]|$)'
  from normalized;
$$;

revoke all on function public.booking_request_content_is_safe(text)
  from public, anon, authenticated, service_role;

create function public.booking_request_policy_at(
  first_starts_at timestamptz,
  evaluated_at timestamptz
)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'insideCutoff', first_starts_at < evaluated_at + interval '6 hours',
    'requiresInside48HourNoRefundAcceptance',
      first_starts_at < evaluated_at + interval '48 hours'
  );
$$;

revoke all on function public.booking_request_policy_at(timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

create function public.booking_request_acceptance_evidence(
  target_locale public.cottage_profile_source_language,
  target_terms_version text,
  requires_inside_48 boolean
)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select case target_locale
    when 'en' then jsonb_build_object(
      'locale', 'en',
      'cancellationPolicy', 'Cancel at least 48 hours before the first shift for a full refund. Cancellation inside 48 hours and no-shows receive no refund.',
      'cancellationAcceptance', 'I accept the cancellation policy.',
      'marketplaceTermsAcceptance', 'I accept the marketplace booking terms. (' || target_terms_version || ')',
      'inside48Warning', case when requires_inside_48 then 'This request begins inside 48 hours and will be non-refundable immediately if accepted.' else null end,
      'inside48Acceptance', case when requires_inside_48 then 'I understand and accept the inside-48-hours no-refund rule.' else null end
    )
    when 'ar' then jsonb_build_object(
      'locale', 'ar',
      'cancellationPolicy', 'الإلغاء قبل 48 ساعة على الأقل يعيد المبلغ كاملاً. لا استرداد عند الإلغاء خلال 48 ساعة أو عدم الحضور.',
      'cancellationAcceptance', 'أوافق على سياسة الإلغاء.',
      'marketplaceTermsAcceptance', 'أوافق على شروط الحجز في المنصة. (' || target_terms_version || ')',
      'inside48Warning', case when requires_inside_48 then 'يبدأ هذا الطلب خلال 48 ساعة وسيصبح غير قابل للاسترداد فور قبوله.' else null end,
      'inside48Acceptance', case when requires_inside_48 then 'أفهم وأوافق على عدم الاسترداد خلال 48 ساعة.' else null end
    )
    when 'ckb' then jsonb_build_object(
      'locale', 'ckb',
      'cancellationPolicy', 'هەڵوەشاندنەوە لانیکەم 48 کاتژمێر پێش شەفت پارەکە بە تەواوی دەگەڕێنێتەوە. لە ناو 48 کاتژمێر یان نەهاتندا پارە ناگەڕێتەوە.',
      'cancellationAcceptance', 'سیاسەتی هەڵوەشاندنەوە قبوڵ دەکەم.',
      'marketplaceTermsAcceptance', 'مەرجەکانی حجزکردنی پلاتفۆرم قبوڵ دەکەم. (' || target_terms_version || ')',
      'inside48Warning', case when requires_inside_48 then 'ئەم داواکارییە لە ناو 48 کاتژمێردا دەست پێدەکات و دوای پەسەندکردن پارەکە ناگەڕێتەوە.' else null end,
      'inside48Acceptance', case when requires_inside_48 then 'یاسای نەگەڕاندنەوەی پارە لە ناو 48 کاتژمێردا قبوڵ دەکەم.' else null end
    )
  end;
$$;

revoke all on function public.booking_request_acceptance_evidence(
  public.cottage_profile_source_language, text, boolean
) from public, anon, authenticated, service_role;

create function public.project_existing_booking_request_submission_attempt(
  target_attempt public.booking_request_submission_attempts,
  expected_intent_fingerprint text,
  expected_intent_payload jsonb,
  null_snapshot_is_ready boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare existing_request public.booking_requests;
begin
  if target_attempt.intent_fingerprint <> expected_intent_fingerprint
    or target_attempt.intent_payload <> expected_intent_payload then
    return jsonb_build_object('status', 'invalid');
  end if;
  if target_attempt.state = 'finalized' then
    select * into existing_request
    from public.booking_requests requests
    where requests.id = target_attempt.booking_request_id;
    if found then
      return jsonb_build_object(
        'status', 'pending',
        'bookingRequestReference', existing_request.booking_request_reference,
        'responseDeadline', to_char(
          existing_request.response_deadline at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      );
    end if;
    return jsonb_build_object('status', 'reconciliation-required');
  end if;
  if target_attempt.state = 'authorization_failed' then
    return jsonb_build_object('status', 'authorization-failed');
  end if;
  if target_attempt.state = 'released' then
    return jsonb_build_object('status', 'unavailable');
  end if;
  if exists (
    select 1
    from public.booking_request_authorization_claims claims
    where claims.attempt_id = target_attempt.id
      and public.booking_request_claim_state_is_reconcilable(claims.state)
  ) then
    return jsonb_build_object('status', 'reconciliation-required');
  end if;
  if target_attempt.state in (
      'authorizing', 'authorized', 'reconciliation_required', 'releasing'
    ) and target_attempt.payment_snapshot is not null then
    return jsonb_build_object(
      'status', 'ready',
      'attemptId', target_attempt.id,
      'paymentLifecycleId', target_attempt.payment_lifecycle_id,
      'paymentSnapshot', target_attempt.payment_snapshot,
      'providerIdentity', case
        when target_attempt.authorization_provider is null then null
        else jsonb_build_object(
          'provider', target_attempt.authorization_provider,
          'environment', target_attempt.authorization_environment,
          'merchantId', target_attempt.authorization_merchant_id,
          'terminalId', target_attempt.authorization_terminal_id
        )
      end
    );
  end if;
  if target_attempt.state = 'authorizing'
    and target_attempt.payment_snapshot is null then
    if not null_snapshot_is_ready then
      return jsonb_build_object('status', 'continue');
    end if;
    return jsonb_build_object(
      'status', 'ready',
      'attemptId', target_attempt.id,
      'paymentLifecycleId', target_attempt.payment_lifecycle_id,
      'paymentSnapshot', null,
      'providerIdentity', null
    );
  end if;
  return jsonb_build_object('status', 'reconciliation-required');
end;
$$;

revoke all on function public.project_existing_booking_request_submission_attempt(
  public.booking_request_submission_attempts, text, jsonb, boolean
) from public, anon, authenticated, service_role;

create function public.prepare_booking_request_submission(
  target_customer_user_id uuid,
  target_idempotency_key uuid,
  target_submission jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target_locale public.cottage_profile_source_language;
declare target_slug text;
declare target_search jsonb;
declare displayed_fingerprint text;
declare current_quote jsonb;
declare current_profile_id uuid;
declare first_starts_at timestamptz;
declare policy_evaluated_at timestamptz;
declare policy jsonb;
declare expected_acceptance_evidence jsonb;
declare intent jsonb;
declare target_intent_fingerprint text;
declare existing_attempt public.booking_request_submission_attempts;
declare key_attempt public.booking_request_submission_attempts;
declare inserted_attempt public.booking_request_submission_attempts;
declare existing_projection jsonb;
begin
  if target_customer_user_id is null
    or target_idempotency_key is null
    or target_submission is null
    or jsonb_typeof(target_submission) <> 'object' then
    return jsonb_build_object('status', 'invalid');
  end if;
  if not exists (
    select 1
    from public.account_contexts contexts
    join auth.users users on users.id = contexts.user_id
    where contexts.user_id = target_customer_user_id
      and contexts.role = 'customer'::public.account_role
      and users.phone_confirmed_at is not null
  ) then
    return jsonb_build_object('status', 'access-required');
  end if;

  begin
    target_locale := (target_submission ->> 'locale')::public.cottage_profile_source_language;
    target_slug := target_submission ->> 'publicSlug';
    target_search := target_submission -> 'discoveryQuery';
    displayed_fingerprint := target_submission ->> 'quoteFingerprint';
    intent := target_submission -> 'intent';
    if target_slug is null
      or target_search is null
      or intent is null
      or jsonb_typeof(intent) <> 'object'
      or displayed_fingerprint !~ '^[0-9a-f]{64}$'
      or intent ->> 'customerName' <> btrim(intent ->> 'customerName')
      or char_length(intent ->> 'customerName') not between 2 and 120
      or not public.booking_request_content_is_safe(intent ->> 'customerName')
      or (intent ->> 'partySize')::integer not between 1 and 1000
      or (intent ->> 'partySize')::integer <> (target_search ->> 'guests')::integer
      or (intent ? 'bookingNote' and (
        intent ->> 'bookingNote' is null
        or intent ->> 'bookingNote' <> btrim(intent ->> 'bookingNote')
        or char_length(intent ->> 'bookingNote') not between 1 and 500
        or not public.booking_request_content_is_safe(intent ->> 'bookingNote')
      ))
      or (intent ->> 'acceptedHouseRules')::boolean is not true
      or (intent ->> 'acceptedCancellationPolicy')::boolean is not true
      or (intent ->> 'acceptedMarketplaceTerms')::boolean is not true
      or intent ->> 'cancellationPolicyVersion' <> 'rentcottage-mvp-2026-08-04'
      or jsonb_typeof(intent -> 'acceptanceEvidence') is distinct from 'object' then
      return jsonb_build_object('status', 'invalid');
    end if;
  exception when others then
    return jsonb_build_object('status', 'invalid');
  end;

  intent := intent || jsonb_build_object(
    'customerUserId', target_customer_user_id,
    'publicSlug', target_slug,
    'locale', target_locale,
    'discoveryQuery', target_search,
    'quoteFingerprint', displayed_fingerprint,
    'contentVersion', target_submission -> 'contentVersion',
    'termsVersion', target_submission -> 'termsVersion',
    'bookingPriceIqd', target_submission -> 'bookingPriceIqd',
    'serviceFeeIqd', target_submission -> 'serviceFeeIqd',
    'customerTotalIqd', target_submission -> 'customerTotalIqd',
    'firstStartsAt', target_submission -> 'firstStartsAt'
  );
  target_intent_fingerprint := encode(
    extensions.digest(convert_to(intent::text, 'UTF8'), 'sha256'),
    'hex'
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      target_customer_user_id::text || ':' || target_intent_fingerprint, 0
    )
  );

  select * into key_attempt
  from public.booking_request_submission_attempts attempts
  where attempts.customer_user_id = target_customer_user_id
    and attempts.idempotency_key = target_idempotency_key
  for update;
  if found and (
    key_attempt.intent_fingerprint <> target_intent_fingerprint
    or key_attempt.intent_payload <> intent
  ) then
    return jsonb_build_object('status', 'invalid');
  end if;

  select * into existing_attempt
  from public.booking_request_submission_attempts attempts
  where attempts.customer_user_id = target_customer_user_id
    and attempts.intent_fingerprint = target_intent_fingerprint
  for update;
  if found then
    existing_projection := public.project_existing_booking_request_submission_attempt(
      existing_attempt, target_intent_fingerprint, intent, false
    );
    if existing_projection ->> 'status' <> 'continue' then
      return existing_projection;
    end if;
  end if;

  select profiles.id into current_profile_id
  from public.cottage_marketplace_listings listings
  join public.owner_application_cottage_profiles profiles
    on profiles.id = listings.profile_id
  where listings.public_slug = target_slug
  for update of profiles;
  if current_profile_id is null then
    return jsonb_build_object('status', 'quote-stale');
  end if;
  policy_evaluated_at := clock_timestamp();

  current_quote := public.get_public_booking_quote_with_fingerprint(
    target_locale, target_slug, target_search
  );
  if current_quote ->> 'status' <> 'quoted'
    or current_quote ->> 'quoteFingerprint' <> displayed_fingerprint
    or (current_quote ->> 'contentVersion')::integer
      <> (target_submission ->> 'contentVersion')::integer
    or current_quote ->> 'termsVersion' <> target_submission ->> 'termsVersion'
    or (current_quote ->> 'bookingPriceIqd')::bigint
      <> (target_submission ->> 'bookingPriceIqd')::bigint
    or (current_quote ->> 'serviceFeeIqd')::bigint
      <> (target_submission ->> 'serviceFeeIqd')::bigint
    or (current_quote ->> 'customerTotalIqd')::bigint
      <> (target_submission ->> 'customerTotalIqd')::bigint
    or current_quote -> 'items' -> 0 ->> 'startsAt'
      <> target_submission ->> 'firstStartsAt' then
    return jsonb_build_object('status', 'quote-stale');
  end if;
  first_starts_at := (current_quote -> 'items' -> 0 ->> 'startsAt')::timestamptz;
  policy := public.booking_request_policy_at(
    first_starts_at, policy_evaluated_at
  );
  if (policy ->> 'insideCutoff')::boolean then
    return jsonb_build_object('status', 'too-late');
  end if;
  expected_acceptance_evidence := public.booking_request_acceptance_evidence(
    target_locale,
    current_quote ->> 'termsVersion',
    (policy ->> 'requiresInside48HourNoRefundAcceptance')::boolean
  );
  if intent -> 'acceptanceEvidence' is distinct from expected_acceptance_evidence then
    return jsonb_build_object('status', 'invalid');
  end if;
  if (policy ->> 'requiresInside48HourNoRefundAcceptance')::boolean
    and (intent ->> 'acceptedInside48HourNoRefund')::boolean is not true then
    return jsonb_build_object('status', 'invalid');
  end if;

  if existing_attempt.id is not null then
    if existing_attempt.profile_id <> current_profile_id
      or existing_attempt.quote_payload <> current_quote - 'status' then
      return jsonb_build_object('status', 'quote-stale');
    end if;
    return public.project_existing_booking_request_submission_attempt(
      existing_attempt, target_intent_fingerprint, intent, true
    );
  end if;

  insert into public.booking_request_submission_attempts (
    customer_user_id, idempotency_key, payment_lifecycle_id,
    profile_id, locale, public_slug, requested_search,
    quote_fingerprint, quote_payload, intent_fingerprint, intent_payload,
    state
  ) values (
    target_customer_user_id, target_idempotency_key, gen_random_uuid(),
    current_profile_id, target_locale, target_slug, target_search,
    displayed_fingerprint, current_quote - 'status', target_intent_fingerprint, intent,
    'authorizing'
  )
  on conflict do nothing
  returning * into inserted_attempt;

  if inserted_attempt.id is not null then
    return jsonb_build_object(
      'status', 'ready',
      'attemptId', inserted_attempt.id,
      'paymentLifecycleId', inserted_attempt.payment_lifecycle_id,
      'paymentSnapshot', null,
      'providerIdentity', null
    );
  end if;

  select * into existing_attempt
  from public.booking_request_submission_attempts attempts
  where attempts.customer_user_id = target_customer_user_id
    and (
      attempts.intent_fingerprint = target_intent_fingerprint
      or attempts.idempotency_key = target_idempotency_key
    )
  for update;
  if existing_attempt.quote_payload <> current_quote - 'status' then
    return jsonb_build_object('status', 'invalid');
  end if;
  return public.project_existing_booking_request_submission_attempt(
    existing_attempt, target_intent_fingerprint, intent, true
  );
end;
$$;

revoke all on function public.prepare_booking_request_submission(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.prepare_booking_request_submission(uuid, uuid, jsonb)
  to service_role;

create function public.save_booking_request_payment_snapshot(
  target_attempt_id uuid,
  target_payment_snapshot jsonb,
  target_provider_identity jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare attempt public.booking_request_submission_attempts;
declare authorization_operation jsonb;
declare authorization_status text;
declare release_operation jsonb;
declare existing_authorization_operation jsonb;
declare existing_release_operation jsonb;
declare stored_operation_identity public.booking_request_provider_operation_identities;
declare next_state text;
declare expected_total_fils bigint;
declare expected_booking_price_fils bigint;
declare expected_commission_fils bigint;
declare locked_claim public.booking_request_authorization_claims;
declare next_claim_state public.booking_request_authorization_claim_state;
begin
  select * into attempt
  from public.booking_request_submission_attempts attempts
  where attempts.id = target_attempt_id
  for update;
  if not found then
    raise exception 'Booking Request submission attempt was not found'
      using errcode = 'RC404';
  end if;
  select * into locked_claim
  from public.booking_request_authorization_claims claims
  where claims.attempt_id = target_attempt_id
  for update;
  authorization_operation := target_payment_snapshot -> 'authorization';
  release_operation := nullif(
    target_payment_snapshot -> 'release',
    'null'::jsonb
  );
  expected_total_fils := (attempt.quote_payload ->> 'customerTotalIqd')::bigint * 1000;
  expected_booking_price_fils := (attempt.quote_payload ->> 'bookingPriceIqd')::bigint * 1000;
  expected_commission_fils := expected_booking_price_fils / 10;
  if target_payment_snapshot ->> 'paymentLifecycleId' <> attempt.payment_lifecycle_id::text
    or target_payment_snapshot ->> 'currency' <> 'IQD'
    or (select count(*) from jsonb_object_keys(target_payment_snapshot)) <> 15
    or not (target_payment_snapshot ?& array[
      'paymentLifecycleId', 'currency', 'bookingPriceFils',
      'bookingServiceFeeFils', 'customerTotalFils', 'authorization',
      'capture', 'release', 'refunds', 'financials', 'payout', 'holds',
      'dispute', 'audits', 'movements'
    ])
    or (target_payment_snapshot ->> 'bookingPriceFils')::bigint <> expected_booking_price_fils
    or (target_payment_snapshot ->> 'bookingServiceFeeFils')::bigint
      <> (attempt.quote_payload ->> 'serviceFeeIqd')::bigint * 1000
    or (target_payment_snapshot ->> 'customerTotalFils')::bigint <> expected_total_fils
    or authorization_operation is null
    or (select count(*) from jsonb_object_keys(authorization_operation)) <> 11
    or not (authorization_operation ?& array[
      'paymentLifecycleId', 'kind', 'logicalOperationId', 'attemptId', 'status',
      'amountFils', 'providerRequestId', 'providerReference',
      'movementReference', 'reconciliationRequired', 'retrySafe'
    ])
    or authorization_operation ->> 'kind' <> 'authorization'
    or authorization_operation ->> 'paymentLifecycleId' <> attempt.payment_lifecycle_id::text
    or authorization_operation ->> 'logicalOperationId'
      <> (attempt.payment_lifecycle_id::text || ':authorization')
    or authorization_operation ->> 'attemptId'
      !~ ('^' || attempt.payment_lifecycle_id::text || ':authorization:attempt-[1-9][0-9]*$')
    or (authorization_operation ->> 'amountFils')::bigint <> expected_total_fils
    or authorization_operation ->> 'status' not in ('pending', 'succeeded', 'failed')
    or jsonb_typeof(authorization_operation -> 'reconciliationRequired') <> 'boolean'
    or jsonb_typeof(authorization_operation -> 'retrySafe') <> 'boolean'
    or target_payment_snapshot -> 'capture' <> 'null'::jsonb
    or target_payment_snapshot -> 'refunds' <> '[]'::jsonb
    or target_payment_snapshot -> 'dispute' <> 'null'::jsonb
    or target_payment_snapshot -> 'audits' <> '[]'::jsonb
    or target_payment_snapshot -> 'holds'
      <> '{"administrator":false,"dispute":false}'::jsonb
    or target_payment_snapshot -> 'financials' <> jsonb_build_object(
      'refundedBookingPriceFils', 0,
      'refundedBookingServiceFeeFils', 0,
      'remainingBookingPriceFils', expected_booking_price_fils,
      'remainingBookingServiceFeeFils',
        (attempt.quote_payload ->> 'serviceFeeIqd')::bigint * 1000,
      'marketplaceCommissionFils', expected_commission_fils,
      'ownerEntitlementFils', expected_booking_price_fils - expected_commission_fils
    )
    or target_payment_snapshot -> 'payout' <> jsonb_build_object(
      'status', 'not_eligible',
      'eligibleFils', expected_booking_price_fils - expected_commission_fils,
      'paidFils', 0, 'providerFeeFils', 0, 'providerReserveFils', 0,
      'recoveryExposureFils', 0, 'recoveryBalanceFils', 0,
      'automaticOwnerDebitFils', 0, 'paidWhileBlocked', false,
      'settlement', null
    ) then
    raise exception 'Stored Payment Lifecycle does not match the Booking Request intent'
      using errcode = '22023';
  end if;
  authorization_status := authorization_operation ->> 'status';
  if authorization_status = 'succeeded' and (
    coalesce(authorization_operation ->> 'providerRequestId', '') = ''
    or coalesce(authorization_operation ->> 'providerReference', '') = ''
    or coalesce(authorization_operation ->> 'movementReference', '') = ''
    or (authorization_operation ->> 'reconciliationRequired')::boolean
    or (authorization_operation ->> 'retrySafe')::boolean
    or jsonb_array_length(target_payment_snapshot -> 'movements') < 1
    or (
      release_operation is null
      and jsonb_array_length(target_payment_snapshot -> 'movements') <> 1
    )
    or target_payment_snapshot -> 'movements' -> 0 <> jsonb_build_object(
      'kind', 'authorization',
      'logicalOperationId', authorization_operation ->> 'logicalOperationId',
      'attemptId', authorization_operation ->> 'attemptId',
      'amountFils', expected_total_fils,
      'movementReference', authorization_operation ->> 'movementReference',
      'recordedAt', target_payment_snapshot -> 'movements' -> 0 ->> 'recordedAt'
    )
    or coalesce(target_payment_snapshot -> 'movements' -> 0 ->> 'recordedAt', '') = ''
  ) then
    raise exception 'Successful Payment Authorization evidence is invalid'
      using errcode = '22023';
  end if;
  if authorization_status = 'failed' and (
    not (
      (
        coalesce(authorization_operation ->> 'providerRequestId', '') <> ''
        and coalesce(authorization_operation ->> 'providerReference', '') <> ''
      ) or (
        authorization_operation -> 'providerRequestId' = 'null'::jsonb
        and authorization_operation -> 'providerReference' = 'null'::jsonb
      )
    )
    or authorization_operation -> 'movementReference' <> 'null'::jsonb
    or (authorization_operation ->> 'reconciliationRequired')::boolean
    or jsonb_array_length(target_payment_snapshot -> 'movements') <> 0
  ) then
    raise exception 'Failed Payment Authorization evidence is invalid'
      using errcode = '22023';
  end if;
  if authorization_status = 'pending' and (
    (authorization_operation ->> 'retrySafe')::boolean
    or (
      authorization_operation -> 'providerRequestId' = 'null'::jsonb
      and authorization_operation -> 'providerReference' = 'null'::jsonb
      and authorization_operation -> 'movementReference' = 'null'::jsonb
      and (authorization_operation ->> 'reconciliationRequired')::boolean
    )
    or (
      coalesce(authorization_operation ->> 'providerRequestId', '') <> ''
      and coalesce(authorization_operation ->> 'providerReference', '') <> ''
      and coalesce(authorization_operation ->> 'movementReference', '') <> ''
      and not (authorization_operation ->> 'reconciliationRequired')::boolean
    )
    or not (
      (
        authorization_operation -> 'providerRequestId' = 'null'::jsonb
        and authorization_operation -> 'providerReference' = 'null'::jsonb
        and authorization_operation -> 'movementReference' = 'null'::jsonb
      )
      or (
        coalesce(authorization_operation ->> 'providerRequestId', '') <> ''
        and coalesce(authorization_operation ->> 'providerReference', '') <> ''
        and coalesce(authorization_operation ->> 'movementReference', '') <> ''
      )
    )
    or jsonb_array_length(target_payment_snapshot -> 'movements') <> 0
  ) then
    raise exception 'Pending Payment Authorization evidence is invalid'
      using errcode = '22023';
  end if;
  if release_operation is not null then
    if authorization_status <> 'succeeded'
      or (select count(*) from jsonb_object_keys(release_operation)) <> 11
      or not (release_operation ?& array[
        'paymentLifecycleId', 'kind', 'logicalOperationId', 'attemptId', 'status',
        'amountFils', 'providerRequestId', 'providerReference',
        'movementReference', 'reconciliationRequired', 'retrySafe'
      ])
      or release_operation ->> 'paymentLifecycleId' <> attempt.payment_lifecycle_id::text
      or release_operation ->> 'kind' <> 'release'
      or release_operation ->> 'logicalOperationId'
        <> (attempt.payment_lifecycle_id::text || ':release')
      or release_operation ->> 'attemptId'
        !~ ('^' || attempt.payment_lifecycle_id::text || ':release:attempt-[1-9][0-9]*$')
      or (release_operation ->> 'amountFils')::bigint <> expected_total_fils
      or release_operation ->> 'status' not in ('pending', 'succeeded', 'failed')
      or jsonb_typeof(release_operation -> 'reconciliationRequired') <> 'boolean'
      or jsonb_typeof(release_operation -> 'retrySafe') <> 'boolean' then
      raise exception 'Authorization Release does not match the Customer Total'
        using errcode = '22023';
    end if;
    if release_operation ->> 'status' = 'succeeded' and (
      coalesce(release_operation ->> 'providerRequestId', '') = ''
      or coalesce(release_operation ->> 'providerReference', '') = ''
      or coalesce(release_operation ->> 'movementReference', '') = ''
      or (release_operation ->> 'reconciliationRequired')::boolean
      or (release_operation ->> 'retrySafe')::boolean
      or jsonb_array_length(target_payment_snapshot -> 'movements') <> 2
      or target_payment_snapshot -> 'movements' -> 1 <> jsonb_build_object(
        'kind', 'release',
        'logicalOperationId', release_operation ->> 'logicalOperationId',
        'attemptId', release_operation ->> 'attemptId',
        'amountFils', expected_total_fils,
        'movementReference', release_operation ->> 'movementReference',
        'recordedAt', target_payment_snapshot -> 'movements' -> 1 ->> 'recordedAt'
      )
      or coalesce(target_payment_snapshot -> 'movements' -> 1 ->> 'recordedAt', '') = ''
    ) then
      raise exception 'Successful Authorization Release evidence is invalid'
        using errcode = '22023';
    end if;
    if release_operation ->> 'status' = 'failed' and (
      coalesce(release_operation ->> 'providerRequestId', '') = ''
      or coalesce(release_operation ->> 'providerReference', '') = ''
      or release_operation -> 'movementReference' <> 'null'::jsonb
      or (release_operation ->> 'reconciliationRequired')::boolean
      or jsonb_array_length(target_payment_snapshot -> 'movements') <> 1
    ) then
      raise exception 'Failed Authorization Release evidence is invalid'
        using errcode = '22023';
    end if;
    if release_operation ->> 'status' = 'pending' and (
      (release_operation ->> 'retrySafe')::boolean
      or (
        release_operation -> 'providerRequestId' = 'null'::jsonb
        and release_operation -> 'providerReference' = 'null'::jsonb
        and release_operation -> 'movementReference' = 'null'::jsonb
        and (release_operation ->> 'reconciliationRequired')::boolean
      )
      or (
        coalesce(release_operation ->> 'providerRequestId', '') <> ''
        and coalesce(release_operation ->> 'providerReference', '') <> ''
        and coalesce(release_operation ->> 'movementReference', '') <> ''
        and not (release_operation ->> 'reconciliationRequired')::boolean
      )
      or not (
        (
          release_operation -> 'providerRequestId' = 'null'::jsonb
          and release_operation -> 'providerReference' = 'null'::jsonb
          and release_operation -> 'movementReference' = 'null'::jsonb
        )
        or (
          coalesce(release_operation ->> 'providerRequestId', '') <> ''
          and coalesce(release_operation ->> 'providerReference', '') <> ''
          and coalesce(release_operation ->> 'movementReference', '') <> ''
        )
      )
      or jsonb_array_length(target_payment_snapshot -> 'movements') <> 1
    ) then
      raise exception 'Pending Authorization Release evidence is invalid'
        using errcode = '22023';
    end if;
    next_state := case
      when release_operation ->> 'status' = 'succeeded' then 'released'
      when (release_operation ->> 'reconciliationRequired')::boolean then 'reconciliation_required'
      else 'releasing'
    end;
  else
    next_state := case
      when authorization_status = 'succeeded' then 'authorized'
      when authorization_status = 'failed' then 'authorization_failed'
      when (authorization_operation ->> 'reconciliationRequired')::boolean then 'reconciliation_required'
      else 'authorizing'
    end;
  end if;
  if attempt.state = 'finalized' then
    raise exception 'A finalized Booking Request payment snapshot cannot change'
      using errcode = 'RC204';
  end if;
  if target_provider_identity is null
    or (select count(*) from jsonb_object_keys(target_provider_identity)) <> 4
    or coalesce(target_provider_identity ->> 'provider', '') = ''
    or coalesce(target_provider_identity ->> 'environment', '') = ''
    or coalesce(target_provider_identity ->> 'merchantId', '') = ''
    or coalesce(target_provider_identity ->> 'terminalId', '') = '' then
    raise exception 'Payment provider identity is invalid' using errcode = '22023';
  end if;
  if attempt.authorization_provider is not null and (
    attempt.authorization_provider <> target_provider_identity ->> 'provider'
    or attempt.authorization_environment <> target_provider_identity ->> 'environment'
    or attempt.authorization_merchant_id <> target_provider_identity ->> 'merchantId'
    or attempt.authorization_terminal_id <> target_provider_identity ->> 'terminalId'
  ) then
    raise exception 'Payment provider identity does not match the durable attempt'
      using errcode = 'RC409';
  end if;

  existing_authorization_operation := attempt.payment_snapshot -> 'authorization';
  existing_release_operation := nullif(
    attempt.payment_snapshot -> 'release',
    'null'::jsonb
  );
  if attempt.payment_snapshot is not null
    and attempt.payment_snapshot <> target_payment_snapshot then
    if attempt.state in ('released', 'authorization_failed') then
      raise exception 'Terminal Payment evidence cannot regress'
        using errcode = 'RC409';
    end if;
    if existing_release_operation is not null then
      if release_operation is null
        or existing_release_operation ->> 'logicalOperationId'
          <> release_operation ->> 'logicalOperationId'
        or existing_release_operation ->> 'attemptId'
          <> release_operation ->> 'attemptId'
        or existing_release_operation ->> 'status' in ('succeeded', 'failed') then
        raise exception 'Authorization Release evidence cannot regress'
          using errcode = 'RC409';
      end if;
    elsif existing_authorization_operation ->> 'status' = 'succeeded' then
      if authorization_operation <> existing_authorization_operation
        or release_operation is null then
        raise exception 'Successful Payment Authorization evidence cannot regress'
          using errcode = 'RC409';
      end if;
    elsif existing_authorization_operation ->> 'status' = 'failed' then
      raise exception 'Failed Payment Authorization evidence cannot change'
        using errcode = 'RC409';
    elsif authorization_operation ->> 'logicalOperationId'
        <> existing_authorization_operation ->> 'logicalOperationId'
      or authorization_operation ->> 'attemptId'
        <> existing_authorization_operation ->> 'attemptId'
      or release_operation is not null then
      raise exception 'Pending Payment Authorization evidence cannot be replaced'
        using errcode = 'RC409';
    end if;
  end if;

  if attempt.authorization_provider_request_id is not null
      and nullif(authorization_operation ->> 'providerRequestId', '')
        is distinct from attempt.authorization_provider_request_id
    or attempt.authorization_provider_reference is not null
      and nullif(authorization_operation ->> 'providerReference', '')
        is distinct from attempt.authorization_provider_reference
    or attempt.authorization_movement_reference is not null
      and nullif(authorization_operation ->> 'movementReference', '')
        is distinct from attempt.authorization_movement_reference
    or attempt.release_provider_request_id is not null
      and nullif(release_operation ->> 'providerRequestId', '')
        is distinct from attempt.release_provider_request_id
    or attempt.release_provider_reference is not null
      and nullif(release_operation ->> 'providerReference', '')
        is distinct from attempt.release_provider_reference
    or attempt.release_movement_reference is not null
      and nullif(release_operation ->> 'movementReference', '')
        is distinct from attempt.release_movement_reference then
    raise exception 'External Payment identity cannot change'
      using errcode = 'RC409';
  end if;
  if nullif(authorization_operation ->> 'providerRequestId', '') is not null then
    insert into public.booking_request_provider_operation_identities (
      attempt_id, operation_kind, provider, environment, merchant_id, terminal_id,
      provider_request_id, provider_reference, movement_reference
    ) values (
      target_attempt_id, 'authorization',
      target_provider_identity ->> 'provider',
      target_provider_identity ->> 'environment',
      target_provider_identity ->> 'merchantId',
      target_provider_identity ->> 'terminalId',
      authorization_operation ->> 'providerRequestId',
      authorization_operation ->> 'providerReference',
      nullif(authorization_operation ->> 'movementReference', '')
    ) on conflict (attempt_id, operation_kind) do nothing;
    select * into stored_operation_identity
    from public.booking_request_provider_operation_identities identities
    where identities.attempt_id = target_attempt_id
      and identities.operation_kind = 'authorization';
    if stored_operation_identity.provider <> target_provider_identity ->> 'provider'
      or stored_operation_identity.environment <> target_provider_identity ->> 'environment'
      or stored_operation_identity.merchant_id <> target_provider_identity ->> 'merchantId'
      or stored_operation_identity.terminal_id <> target_provider_identity ->> 'terminalId'
      or stored_operation_identity.provider_request_id <> authorization_operation ->> 'providerRequestId'
      or stored_operation_identity.provider_reference <> authorization_operation ->> 'providerReference'
      or stored_operation_identity.movement_reference is distinct from
        nullif(authorization_operation ->> 'movementReference', '') then
      raise exception 'External Payment identity cannot change'
        using errcode = 'RC409';
    end if;
  end if;
  if release_operation is not null
    and nullif(release_operation ->> 'providerRequestId', '') is not null then
    insert into public.booking_request_provider_operation_identities (
      attempt_id, operation_kind, provider, environment, merchant_id, terminal_id,
      provider_request_id, provider_reference, movement_reference
    ) values (
      target_attempt_id, 'release',
      target_provider_identity ->> 'provider',
      target_provider_identity ->> 'environment',
      target_provider_identity ->> 'merchantId',
      target_provider_identity ->> 'terminalId',
      release_operation ->> 'providerRequestId',
      release_operation ->> 'providerReference',
      nullif(release_operation ->> 'movementReference', '')
    ) on conflict (attempt_id, operation_kind) do nothing;
    select * into stored_operation_identity
    from public.booking_request_provider_operation_identities identities
    where identities.attempt_id = target_attempt_id
      and identities.operation_kind = 'release';
    if stored_operation_identity.provider <> target_provider_identity ->> 'provider'
      or stored_operation_identity.environment <> target_provider_identity ->> 'environment'
      or stored_operation_identity.merchant_id <> target_provider_identity ->> 'merchantId'
      or stored_operation_identity.terminal_id <> target_provider_identity ->> 'terminalId'
      or stored_operation_identity.provider_request_id <> release_operation ->> 'providerRequestId'
      or stored_operation_identity.provider_reference <> release_operation ->> 'providerReference'
      or stored_operation_identity.movement_reference is distinct from
        nullif(release_operation ->> 'movementReference', '') then
      raise exception 'External Payment identity cannot change'
        using errcode = 'RC409';
    end if;
  end if;
  update public.booking_request_submission_attempts
  set payment_snapshot = target_payment_snapshot,
    state = next_state,
    authorization_provider = coalesce(
      authorization_provider, target_provider_identity ->> 'provider'
    ),
    authorization_environment = coalesce(
      authorization_environment, target_provider_identity ->> 'environment'
    ),
    authorization_merchant_id = coalesce(
      authorization_merchant_id, target_provider_identity ->> 'merchantId'
    ),
    authorization_terminal_id = coalesce(
      authorization_terminal_id, target_provider_identity ->> 'terminalId'
    ),
    authorization_provider_request_id = coalesce(
      authorization_provider_request_id,
      nullif(authorization_operation ->> 'providerRequestId', '')
    ),
    authorization_provider_reference = coalesce(
      authorization_provider_reference,
      nullif(authorization_operation ->> 'providerReference', '')
    ),
    authorization_movement_reference = coalesce(
      authorization_movement_reference,
      nullif(authorization_operation ->> 'movementReference', '')
    ),
    release_provider_request_id = coalesce(
      release_provider_request_id,
      nullif(release_operation ->> 'providerRequestId', '')
    ),
    release_provider_reference = coalesce(
      release_provider_reference,
      nullif(release_operation ->> 'providerReference', '')
    ),
    release_movement_reference = coalesce(
      release_movement_reference,
      nullif(release_operation ->> 'movementReference', '')
    ),
    updated_at = now()
  where id = target_attempt_id;

  if locked_claim.id is not null then
    next_claim_state := public.booking_request_claim_state_after_payment(
      locked_claim.state,
      next_state,
      authorization_operation -> 'providerRequestId' <> 'null'::jsonb,
      release_operation ->> 'status'
    );
  end if;
  update public.booking_request_authorization_claims claims
  set state = next_claim_state,
    state_revision = state_revision + 1,
    updated_at = clock_timestamp()
  where claims.attempt_id = target_attempt_id
    and claims.state is distinct from next_claim_state;
  update public.booking_request_authorization_claim_occupancies occupancies
  set active = public.booking_request_claim_state_is_active(claims.state)
  from public.booking_request_authorization_claims claims
  where claims.attempt_id = target_attempt_id
    and occupancies.claim_id = claims.id
    and occupancies.active is distinct from
      public.booking_request_claim_state_is_active(claims.state);
  update public.booking_request_authorization_reconciliation_outbox outbox
  set observed_state_revision = claims.state_revision,
    state = case
      when public.booking_request_claim_state_is_terminal(claims.state)
        then 'complete'
      else 'pending'
    end,
    lease_token = null,
    lease_expires_at = null,
    updated_at = clock_timestamp()
  from public.booking_request_authorization_claims claims
  where claims.attempt_id = target_attempt_id
    and outbox.claim_id = claims.id;
end;
$$;

revoke all on function public.save_booking_request_payment_snapshot(uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_booking_request_payment_snapshot(uuid, jsonb, jsonb)
  to service_role;

create function public.begin_booking_request_authorization_claim(
  target_attempt_id uuid,
  target_payment_snapshot jsonb,
  target_provider_identity jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare attempt public.booking_request_submission_attempts;
declare existing_claim public.booking_request_authorization_claims;
declare claim_id uuid := gen_random_uuid();
declare claim_generation integer := 1;
declare provider_idempotency_key text;
declare current_quote jsonb;
declare policy_evaluated_at timestamptz;
declare first_starts_at timestamptz;
declare claim_not_after timestamptz;
declare selection jsonb;
declare resolved_selection jsonb;
declare resolved_selections jsonb := '[]'::jsonb;
declare selection_day date;
declare target_unit_kind public.cottage_inventory_unit_kind;
declare target_unit_id uuid;
declare target_schedule_revision_id uuid;
declare target_price_iqd bigint;
declare target_start_time time without time zone;
declare target_end_time time without time zone;
declare target_starts_at timestamptz;
declare target_ends_at timestamptz;
declare claim_access_ranges tstzmultirange := '{}'::tstzmultirange;
declare booking_price_iqd bigint := 0;
declare authorization_operation jsonb;
begin
  if target_provider_identity is null
    or (select count(*) from jsonb_object_keys(target_provider_identity)) <> 4
    or coalesce(target_provider_identity ->> 'provider', '') = ''
    or coalesce(target_provider_identity ->> 'environment', '') = ''
    or coalesce(target_provider_identity ->> 'merchantId', '') = ''
    or coalesce(target_provider_identity ->> 'terminalId', '') = '' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into attempt
  from public.booking_request_submission_attempts attempts
  where attempts.id = target_attempt_id
  for update;
  if not found then
    return jsonb_build_object('status', 'unavailable');
  end if;
  authorization_operation := target_payment_snapshot -> 'authorization';
  select * into existing_claim
  from public.booking_request_authorization_claims claims
  where claims.attempt_id = target_attempt_id
  for update;
  if authorization_operation ->> 'status' <> 'pending'
    or authorization_operation -> 'providerRequestId' <> 'null'::jsonb
    or authorization_operation -> 'providerReference' <> 'null'::jsonb
    or authorization_operation -> 'movementReference' <> 'null'::jsonb
    or (authorization_operation ->> 'reconciliationRequired')::boolean
    or target_payment_snapshot -> 'release' <> 'null'::jsonb then
    return jsonb_build_object('status', 'invalid');
  end if;
  if found then
    if existing_claim.payment_lifecycle_id <> attempt.payment_lifecycle_id
      or existing_claim.logical_operation_id
        <> authorization_operation ->> 'logicalOperationId'
      or existing_claim.physical_attempt_id
        <> authorization_operation ->> 'attemptId'
      or existing_claim.amount_fils
        <> (authorization_operation ->> 'amountFils')::bigint
      or existing_claim.provider <> target_provider_identity ->> 'provider'
      or existing_claim.environment <> target_provider_identity ->> 'environment'
      or existing_claim.merchant_id <> target_provider_identity ->> 'merchantId'
      or existing_claim.terminal_id <> target_provider_identity ->> 'terminalId'
      or existing_claim.quote_fingerprint <> attempt.quote_fingerprint
      or existing_claim.intent_fingerprint <> attempt.intent_fingerprint then
      return jsonb_build_object('status', 'invalid');
    end if;
    if public.booking_request_claim_state_allows_authorization(existing_claim.state)
      and attempt.payment_snapshot -> 'release' = 'null'::jsonb
      and clock_timestamp() < existing_claim.not_after then
      return jsonb_build_object(
        'status', 'ready',
        'executionPermit', jsonb_build_object(
          'claimId', existing_claim.id,
          'generation', existing_claim.generation,
          'idempotencyKey', existing_claim.provider_idempotency_key,
          'notAfter', to_char(existing_claim.not_after at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        )
      );
    end if;
    return jsonb_build_object('status', 'too-late');
  end if;

  perform contexts.user_id
  from public.account_contexts contexts
  where contexts.user_id = attempt.customer_user_id
  for update;
  select profiles.current_shift_schedule_id into target_schedule_revision_id
  from public.owner_application_cottage_profiles profiles
  where profiles.id = attempt.profile_id
  for update;
  if target_schedule_revision_id is null then
    return jsonb_build_object('status', 'unavailable');
  end if;

  if attempt.payment_snapshot is not null
    or attempt.state <> 'authorizing' then
    return jsonb_build_object('status', 'invalid');
  end if;

  policy_evaluated_at := clock_timestamp();
  current_quote := public.get_public_booking_quote_with_fingerprint(
    attempt.locale, attempt.public_slug, attempt.requested_search
  );
  if current_quote ->> 'status' <> 'quoted'
    or current_quote ->> 'quoteFingerprint' <> attempt.quote_fingerprint
    or current_quote - 'status' <> attempt.quote_payload then
    return jsonb_build_object('status', 'quote-stale');
  end if;
  first_starts_at := (current_quote -> 'items' -> 0 ->> 'startsAt')::timestamptz;
  claim_not_after := first_starts_at - interval '6 hours';
  if (attempt.intent_payload ->> 'acceptedInside48HourNoRefund')::boolean
    is not true then
    claim_not_after := least(
      claim_not_after, first_starts_at - interval '48 hours'
    );
  end if;
  if policy_evaluated_at >= claim_not_after then
    return jsonb_build_object(
      'status', case
        when policy_evaluated_at >= first_starts_at - interval '6 hours'
          then 'too-late'
        else 'invalid'
      end
    );
  end if;

  for selection in
    select value
    from jsonb_array_elements(attempt.requested_search -> 'selections') selections(value)
    order by value ->> 'serviceDay', coalesce((value ->> 'position')::integer, 32767)
  loop
    selection_day := (selection ->> 'serviceDay')::date;
    if selection ->> 'kind' = 'shift' then
      target_unit_kind := 'shift'::public.cottage_inventory_unit_kind;
      select shifts.id, shifts.start_time, shifts.end_time
        into target_unit_id, target_start_time, target_end_time
      from public.cottage_shifts shifts
      where shifts.schedule_revision_id = target_schedule_revision_id
        and shifts.position = (selection ->> 'position')::smallint;
    else
      target_unit_kind := 'full_day_bundle'::public.cottage_inventory_unit_kind;
      select schedules.full_day_bundle_id,
        (select shifts.start_time from public.cottage_shifts shifts
          where shifts.schedule_revision_id = schedules.id
          order by shifts.position limit 1),
        (select shifts.end_time from public.cottage_shifts shifts
          where shifts.schedule_revision_id = schedules.id
          order by shifts.position desc limit 1)
        into target_unit_id, target_start_time, target_end_time
      from public.cottage_shift_schedule_revisions schedules
      where schedules.id = target_schedule_revision_id;
    end if;
    target_price_iqd := public.public_cottage_effective_price(
      target_schedule_revision_id,
      target_unit_kind, target_unit_id, selection_day
    );
    if target_unit_id is null
      or target_price_iqd is null
      or not coalesce(public.public_cottage_unit_is_available(
        target_schedule_revision_id,
        target_unit_kind, target_unit_id, selection_day
      ), false) then
      return jsonb_build_object('status', 'unavailable');
    end if;
    target_starts_at := (selection_day + target_start_time)
      at time zone 'Asia/Baghdad';
    target_ends_at := (
      selection_day + target_end_time
      + case when target_end_time < target_start_time
        then interval '1 day' else interval '0 days' end
    ) at time zone 'Asia/Baghdad';
    if target_unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
      and exists (
        select 1
        from jsonb_array_elements(attempt.requested_search -> 'selections') next_selection(value)
        where value ->> 'kind' = 'full-day'
          and (value ->> 'serviceDay')::date = selection_day + 1
      ) then
      target_ends_at := (selection_day + 1 + target_start_time)
        at time zone 'Asia/Baghdad';
    end if;
    claim_access_ranges := claim_access_ranges
      + tstzmultirange(tstzrange(target_starts_at, target_ends_at, '[)'));
    resolved_selections := resolved_selections || jsonb_build_array(
      jsonb_build_object(
        'serviceDay', selection_day, 'unitKind', target_unit_kind,
        'unitId', target_unit_id, 'priceIqd', target_price_iqd
      )
    );
    booking_price_iqd := booking_price_iqd + target_price_iqd;
  end loop;
  if booking_price_iqd <> (attempt.quote_payload ->> 'bookingPriceIqd')::bigint
    or exists (
      select 1
      from public.cottage_booking_period_commitments commitments
      where commitments.customer_user_id = attempt.customer_user_id
        and commitments.status in ('pending_hold', 'confirmed_booking')
        and commitments.access_ranges && claim_access_ranges
    ) then
    return jsonb_build_object('status', 'unavailable');
  end if;

  provider_idempotency_key := 'booking-request:' || claim_id::text || ':1';
  begin
    insert into public.booking_request_authorization_claims (
      id, attempt_id, generation, state, customer_user_id, profile_id,
      schedule_revision_id, payment_lifecycle_id, logical_operation_id,
      physical_attempt_id, amount_fils, currency,
      provider, environment, merchant_id, terminal_id,
      provider_idempotency_key, quote_fingerprint, intent_fingerprint,
      access_ranges, not_after
    ) values (
      claim_id, attempt.id, claim_generation, 'starting',
      attempt.customer_user_id, attempt.profile_id,
      target_schedule_revision_id,
      attempt.payment_lifecycle_id,
      authorization_operation ->> 'logicalOperationId',
      authorization_operation ->> 'attemptId',
      (authorization_operation ->> 'amountFils')::bigint, 'IQD',
      target_provider_identity ->> 'provider',
      target_provider_identity ->> 'environment',
      target_provider_identity ->> 'merchantId',
      target_provider_identity ->> 'terminalId',
      provider_idempotency_key, attempt.quote_fingerprint,
      attempt.intent_fingerprint, claim_access_ranges, claim_not_after
    );
    for resolved_selection in
      select value from jsonb_array_elements(resolved_selections) selections(value)
    loop
      insert into public.booking_request_authorization_claim_items (
        claim_id, unit_kind, unit_id, service_day, price_iqd
      ) values (
        claim_id,
        (resolved_selection ->> 'unitKind')::public.cottage_inventory_unit_kind,
        (resolved_selection ->> 'unitId')::uuid,
        (resolved_selection ->> 'serviceDay')::date,
        (resolved_selection ->> 'priceIqd')::bigint
      );
      if resolved_selection ->> 'unitKind' = 'shift' then
        insert into public.booking_request_authorization_claim_occupancies (
          claim_id, schedule_revision_id, shift_id, service_day
        ) values (
          claim_id, target_schedule_revision_id,
          (resolved_selection ->> 'unitId')::uuid,
          (resolved_selection ->> 'serviceDay')::date
        );
      else
        insert into public.booking_request_authorization_claim_occupancies (
          claim_id, schedule_revision_id, shift_id, service_day
        ) select claim_id,
          target_schedule_revision_id,
          shifts.id, (resolved_selection ->> 'serviceDay')::date
        from public.cottage_shifts shifts
        where shifts.schedule_revision_id =
          target_schedule_revision_id;
      end if;
    end loop;
  exception when unique_violation or exclusion_violation then
    return jsonb_build_object('status', 'unavailable');
  end;

  perform public.save_booking_request_payment_snapshot(
    attempt.id, target_payment_snapshot, target_provider_identity
  );
  update public.booking_request_submission_attempts attempts
  set payment_snapshot = jsonb_set(
      attempts.payment_snapshot,
      '{authorization,reconciliationRequired}', 'true'::jsonb
    ),
    state = 'reconciliation_required',
    updated_at = clock_timestamp()
  where attempts.id = attempt.id;
  insert into public.booking_request_authorization_reconciliation_outbox (
    claim_id, claim_generation, observed_state_revision, state
  ) values (claim_id, claim_generation, 1, 'pending');

  return jsonb_build_object(
    'status', 'ready',
    'executionPermit', jsonb_build_object(
      'claimId', claim_id,
      'generation', claim_generation,
      'idempotencyKey', provider_idempotency_key,
      'notAfter', to_char(claim_not_after at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );
end;
$$;

revoke all on function public.begin_booking_request_authorization_claim(
  uuid, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.begin_booking_request_authorization_claim(
  uuid, jsonb, jsonb
) to service_role;

create function public.booking_request_active_claim_conflicts_unit(
  target_schedule_revision_id uuid,
  target_unit_kind public.cottage_inventory_unit_kind,
  target_unit_id uuid,
  target_service_day date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.booking_request_authorization_claim_occupancies occupancies
    where occupancies.active
      and occupancies.schedule_revision_id = target_schedule_revision_id
      and occupancies.service_day = target_service_day
      and (
        target_unit_kind = 'full_day_bundle'::public.cottage_inventory_unit_kind
        or occupancies.shift_id = target_unit_id
      )
  );
$$;

revoke all on function public.booking_request_active_claim_conflicts_unit(
  uuid, public.cottage_inventory_unit_kind, uuid, date
) from public, anon, authenticated, service_role;

alter function public.public_cottage_unit_is_available(
  uuid, public.cottage_inventory_unit_kind, uuid, date
) rename to public_cottage_unit_is_available_without_authorization_claim;
create function public.public_cottage_unit_is_available(
  target_schedule_revision_id uuid,
  target_unit_kind public.cottage_inventory_unit_kind,
  target_unit_id uuid,
  target_service_day date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.public_cottage_unit_is_available_without_authorization_claim(
    target_schedule_revision_id, target_unit_kind, target_unit_id,
    target_service_day
  ) and not public.booking_request_active_claim_conflicts_unit(
    target_schedule_revision_id, target_unit_kind, target_unit_id,
    target_service_day
  );
$$;
revoke all on function public.public_cottage_unit_is_available(
  uuid, public.cottage_inventory_unit_kind, uuid, date
) from public, anon, authenticated, service_role;

alter function public.cottage_inventory_component_is_effectively_available(
  uuid, uuid, date
) rename to cottage_inventory_component_available_without_auth_claim;
create function public.cottage_inventory_component_is_effectively_available(
  target_schedule_revision_id uuid,
  target_shift_id uuid,
  target_service_day date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.cottage_inventory_component_available_without_auth_claim(
    target_schedule_revision_id, target_shift_id, target_service_day
  ) and not public.booking_request_active_claim_conflicts_unit(
    target_schedule_revision_id,
    'shift'::public.cottage_inventory_unit_kind,
    target_shift_id,
    target_service_day
  );
$$;
revoke all on function public.cottage_inventory_component_is_effectively_available(
  uuid, uuid, date
) from public, anon, authenticated, service_role;

create function public.reject_authorization_claim_inventory_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare candidate_schedule_revision_id uuid;
declare candidate_unit_kind public.cottage_inventory_unit_kind;
declare candidate_unit_id uuid;
declare candidate_service_day date;
declare candidate_weekday smallint;
begin
  if current_setting('role', true) = 'service_role' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'DELETE' then
    candidate_schedule_revision_id := old.schedule_revision_id;
    candidate_unit_kind := old.unit_kind;
    candidate_unit_id := old.unit_id;
    if tg_table_name in (
      'cottage_inventory_date_price_overrides', 'cottage_inventory_availability'
    ) then candidate_service_day := old.service_day; end if;
    if tg_table_name = 'cottage_inventory_weekday_price_overrides'
      then candidate_weekday := old.weekday; end if;
  else
    candidate_schedule_revision_id := new.schedule_revision_id;
    candidate_unit_kind := new.unit_kind;
    candidate_unit_id := new.unit_id;
    if tg_table_name in (
      'cottage_inventory_date_price_overrides', 'cottage_inventory_availability'
    ) then candidate_service_day := new.service_day; end if;
    if tg_table_name = 'cottage_inventory_weekday_price_overrides'
      then candidate_weekday := new.weekday; end if;
  end if;
  if tg_table_name = 'cottage_inventory_standard_prices'
    and exists (
      select 1
      from public.booking_request_authorization_claim_items items
      join public.booking_request_authorization_claims claims
        on claims.id = items.claim_id
	      where public.booking_request_claim_state_is_active(claims.state)
        and claims.schedule_revision_id = candidate_schedule_revision_id
        and items.unit_kind = candidate_unit_kind
        and items.unit_id = candidate_unit_id
    ) then
    raise exception 'Authorization-claimed Cottage Inventory cannot change'
      using errcode = 'RC204';
  elsif tg_table_name = 'cottage_inventory_weekday_price_overrides'
    and exists (
      select 1
      from public.booking_request_authorization_claim_items items
      join public.booking_request_authorization_claims claims
        on claims.id = items.claim_id
	      where public.booking_request_claim_state_is_active(claims.state)
        and claims.schedule_revision_id = candidate_schedule_revision_id
        and items.unit_kind = candidate_unit_kind
        and items.unit_id = candidate_unit_id
        and extract(dow from items.service_day)::smallint = candidate_weekday
    ) then
    raise exception 'Authorization-claimed Cottage Inventory cannot change'
      using errcode = 'RC204';
  elsif tg_table_name in (
      'cottage_inventory_date_price_overrides', 'cottage_inventory_availability'
    ) and public.booking_request_active_claim_conflicts_unit(
      candidate_schedule_revision_id, candidate_unit_kind,
      candidate_unit_id, candidate_service_day
    ) then
    raise exception 'Authorization-claimed Cottage Inventory cannot change'
      using errcode = 'RC204';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function public.reject_authorization_claim_inventory_mutation()
  from public, anon, authenticated, service_role;
create trigger reject_authorization_claim_standard_price_mutation
before insert or update or delete on public.cottage_inventory_standard_prices
for each row execute function public.reject_authorization_claim_inventory_mutation();
create trigger reject_authorization_claim_weekday_price_mutation
before insert or update or delete on public.cottage_inventory_weekday_price_overrides
for each row execute function public.reject_authorization_claim_inventory_mutation();
create trigger reject_authorization_claim_date_price_mutation
before insert or update or delete on public.cottage_inventory_date_price_overrides
for each row execute function public.reject_authorization_claim_inventory_mutation();
create trigger reject_authorization_claim_availability_mutation
before insert or update or delete on public.cottage_inventory_availability
for each row execute function public.reject_authorization_claim_inventory_mutation();

create function public.reject_authorization_claim_profile_or_shift_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare target_profile_id uuid;
declare target_schedule_id uuid;
begin
  if current_setting('role', true) = 'service_role' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_table_name = 'owner_application_cottage_profiles' then
    target_profile_id := coalesce(new.id, old.id);
    if (new.current_publication_id is distinct from old.current_publication_id
        or new.current_shift_schedule_id is distinct from old.current_shift_schedule_id)
      and exists (
        select 1 from public.booking_request_authorization_claims claims
        where claims.profile_id = target_profile_id
	          and public.booking_request_claim_state_is_active(claims.state)
      ) then
      raise exception 'Authorization-claimed Cottage Profile cannot change'
        using errcode = 'RC204';
    end if;
  else
    if tg_op = 'DELETE' then
      target_schedule_id := old.schedule_revision_id;
    else
      target_schedule_id := new.schedule_revision_id;
    end if;
    if exists (
      select 1 from public.booking_request_authorization_claims claims
      where claims.schedule_revision_id = target_schedule_id
	        and public.booking_request_claim_state_is_active(claims.state)
    ) then
      raise exception 'Authorization-claimed Shift Schedule cannot change'
        using errcode = 'RC204';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function public.reject_authorization_claim_profile_or_shift_mutation()
  from public, anon, authenticated, service_role;
create trigger reject_authorization_claim_profile_pointer_mutation
before update of current_publication_id, current_shift_schedule_id
on public.owner_application_cottage_profiles
for each row execute function public.reject_authorization_claim_profile_or_shift_mutation();
create trigger reject_authorization_claim_shift_mutation
before update or delete on public.cottage_shifts
for each row execute function public.reject_authorization_claim_profile_or_shift_mutation();

create function public.reject_booking_period_overlap_with_authorization_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.booking_request_authorization_claims claims
    where claims.customer_user_id = new.customer_user_id
	      and public.booking_request_claim_state_is_active(claims.state)
      and claims.access_ranges && new.access_ranges
  ) then
    raise exception 'The Customer has an overlapping Authorization Claim'
      using errcode = 'RC409';
  end if;
  return new;
end;
$$;
revoke all on function public.reject_booking_period_overlap_with_authorization_claim()
  from public, anon, authenticated, service_role;
create trigger reject_booking_period_overlap_with_authorization_claim
before insert on public.cottage_booking_period_commitments
for each row execute function public.reject_booking_period_overlap_with_authorization_claim();

alter function public.create_pending_booking_period_hold(uuid, uuid, text, jsonb)
  rename to create_pending_booking_period_hold_without_authorization_claim;
revoke all on function public.create_pending_booking_period_hold_without_authorization_claim(
  uuid, uuid, text, jsonb
) from public, anon, authenticated, service_role;
create function public.create_pending_booking_period_hold(
  target_customer_user_id uuid,
  target_profile_id uuid,
  target_commitment_reference text,
  requested_search jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform contexts.user_id
  from public.account_contexts contexts
  where contexts.user_id = target_customer_user_id
  for update;
  return public.create_pending_booking_period_hold_without_authorization_claim(
    target_customer_user_id, target_profile_id, target_commitment_reference,
    requested_search
  );
end;
$$;
revoke all on function public.create_pending_booking_period_hold(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_pending_booking_period_hold(uuid, uuid, text, jsonb)
  to service_role;

alter function public.resolve_cottage_inventory_owner_calendar(uuid, uuid, date)
  rename to resolve_owner_calendar_without_auth_claim;
revoke all on function public.resolve_owner_calendar_without_auth_claim(
  uuid, uuid, date
) from public, anon, authenticated, service_role;
create function public.resolve_cottage_inventory_owner_calendar(
  target_profile_id uuid,
  target_schedule_revision_id uuid,
  target_service_day date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare original jsonb;
declare unit jsonb;
declare result jsonb := '[]'::jsonb;
begin
  original := public.resolve_owner_calendar_without_auth_claim(
    target_profile_id, target_schedule_revision_id, target_service_day
  );
  for unit in select value from jsonb_array_elements(original -> 'units')
  loop
    if public.booking_request_active_claim_conflicts_unit(
      target_schedule_revision_id,
      (unit ->> 'kind')::public.cottage_inventory_unit_kind,
      (unit ->> 'id')::uuid,
      target_service_day
    ) then
      unit := unit || jsonb_build_object(
        'available', false,
        'calendarState', 'unavailable',
        'commitmentReference', null,
        'editable', false
      );
    end if;
    result := result || jsonb_build_array(unit);
  end loop;
  return original || jsonb_build_object('units', result);
end;
$$;
revoke all on function public.resolve_cottage_inventory_owner_calendar(uuid, uuid, date)
  from public, anon;
grant execute on function public.resolve_cottage_inventory_owner_calendar(uuid, uuid, date)
  to authenticated, service_role;

create function public.finalize_booking_request_submission(
  target_attempt_id uuid,
  target_payment_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare attempt public.booking_request_submission_attempts;
declare current_quote jsonb;
declare first_starts_at timestamptz;
declare owner_user_id uuid;
declare request_id uuid := gen_random_uuid();
declare snapshot_id uuid := gen_random_uuid();
declare request_reference text;
declare hold jsonb;
declare submission_created_at timestamptz;
declare response_deadline timestamptz;
declare authorization_operation jsonb;
declare policy jsonb;
declare expected_acceptance_evidence jsonb;
declare authorization_claim public.booking_request_authorization_claims;
declare authorization_claim_found boolean;
begin
  select * into attempt
  from public.booking_request_submission_attempts attempts
  where attempts.id = target_attempt_id
  for update;
  if not found then
    raise exception 'Booking Request submission attempt was not found'
      using errcode = 'RC404';
  end if;
  if attempt.state = 'finalized' then
    return public.lookup_booking_request_submission(target_attempt_id);
  end if;
  authorization_operation := target_payment_snapshot -> 'authorization';
  select * into authorization_claim
  from public.booking_request_authorization_claims claims
  where claims.attempt_id = attempt.id
  for update;
  authorization_claim_found := found;
  perform contexts.user_id
  from public.account_contexts contexts
  where contexts.user_id = attempt.customer_user_id
  for update;
  select profiles.owner_user_id into owner_user_id
  from public.owner_application_cottage_profiles profiles
  where profiles.id = attempt.profile_id
  for update;
  if owner_user_id is null then
    raise exception 'Published Cottage was not found' using errcode = 'RC404';
  end if;
  perform public.save_booking_request_payment_snapshot(
    target_attempt_id,
    target_payment_snapshot,
    jsonb_build_object(
      'provider', attempt.authorization_provider,
      'environment', attempt.authorization_environment,
      'merchantId', attempt.authorization_merchant_id,
      'terminalId', attempt.authorization_terminal_id
    )
  );
  select * into attempt
  from public.booking_request_submission_attempts attempts
  where attempts.id = target_attempt_id;
  if attempt.state <> 'authorized'
    or attempt.payment_snapshot <> target_payment_snapshot
    or authorization_operation ->> 'status' <> 'succeeded'
    or (authorization_operation ->> 'amountFils')::bigint
      <> (attempt.quote_payload ->> 'customerTotalIqd')::bigint * 1000
    or target_payment_snapshot ->> 'capture' is not null
    or target_payment_snapshot ->> 'release' is not null
    or attempt.authorization_provider_request_id is null
    or attempt.authorization_provider_reference is null
    or attempt.authorization_movement_reference is null then
    raise exception 'Successful exact Payment Authorization is required'
      using errcode = 'RC402';
  end if;

  if not authorization_claim_found
    or authorization_claim.state <> 'authorized'
    or authorization_claim.payment_lifecycle_id <> attempt.payment_lifecycle_id
    or authorization_claim.logical_operation_id
      <> authorization_operation ->> 'logicalOperationId'
    or authorization_claim.physical_attempt_id
      <> authorization_operation ->> 'attemptId'
    or authorization_claim.amount_fils
      <> (authorization_operation ->> 'amountFils')::bigint
    or authorization_claim.currency <> 'IQD'
    or authorization_claim.provider <> attempt.authorization_provider
    or authorization_claim.environment <> attempt.authorization_environment
    or authorization_claim.merchant_id <> attempt.authorization_merchant_id
    or authorization_claim.terminal_id <> attempt.authorization_terminal_id
    or authorization_claim.quote_fingerprint <> attempt.quote_fingerprint
    or authorization_claim.intent_fingerprint <> attempt.intent_fingerprint then
    raise exception 'Authorization Claim does not match the Payment evidence'
      using errcode = 'RC409';
  end if;

  update public.booking_request_authorization_claims
  set state = 'converted', state_revision = state_revision + 1,
    updated_at = clock_timestamp()
  where id = authorization_claim.id;
  update public.booking_request_authorization_claim_occupancies
  set active = false
  where claim_id = authorization_claim.id and active;
  update public.booking_request_authorization_reconciliation_outbox
  set state = 'complete',
    observed_state_revision = authorization_claim.state_revision + 1,
    lease_token = null,
    lease_expires_at = null,
    updated_at = clock_timestamp()
  where claim_id = authorization_claim.id;

  current_quote := public.get_public_booking_quote_with_fingerprint(
    attempt.locale, attempt.public_slug, attempt.requested_search
  );
  if current_quote ->> 'status' <> 'quoted'
    or current_quote ->> 'quoteFingerprint' <> attempt.quote_fingerprint
    or current_quote - 'status' <> attempt.quote_payload then
    raise exception 'Booking Quote changed before finalization'
      using errcode = 'RC409';
  end if;
  first_starts_at := (current_quote -> 'items' -> 0 ->> 'startsAt')::timestamptz;
  request_reference := 'RC-REQ-' || upper(substr(replace(request_id::text, '-', ''), 1, 16));
  hold := public.create_pending_booking_period_hold(
    attempt.customer_user_id,
    attempt.profile_id,
    request_reference,
    attempt.requested_search
  );
  if (hold ->> 'bookingPriceIqd')::bigint
    <> (current_quote ->> 'bookingPriceIqd')::bigint then
    raise exception 'Pending Hold price does not match the Booking Quote'
      using errcode = 'RC409';
  end if;
  submission_created_at := clock_timestamp();
  policy := public.booking_request_policy_at(
    first_starts_at, submission_created_at
  );
  if (policy ->> 'insideCutoff')::boolean then
    raise exception 'Booking Request Cut-Off has passed'
      using errcode = 'RC409';
  end if;
  expected_acceptance_evidence := public.booking_request_acceptance_evidence(
    attempt.locale,
    current_quote ->> 'termsVersion',
    (policy ->> 'requiresInside48HourNoRefundAcceptance')::boolean
  );
  if attempt.intent_payload -> 'acceptanceEvidence'
      is distinct from expected_acceptance_evidence
    or encode(
      extensions.digest(convert_to(attempt.intent_payload::text, 'UTF8'), 'sha256'),
      'hex'
    ) <> attempt.intent_fingerprint then
    raise exception 'Booking acceptance evidence changed before finalization'
      using errcode = 'RC409';
  end if;
  if (policy ->> 'requiresInside48HourNoRefundAcceptance')::boolean
    and (attempt.intent_payload ->> 'acceptedInside48HourNoRefund')::boolean
      is not true then
    raise exception 'Inside-48-hour acceptance is required'
      using errcode = 'RC409';
  end if;

  insert into public.booking_snapshots (
    id, customer_user_id, profile_id, quote_fingerprint, intent_fingerprint,
    quote_payload, intent_payload, booking_terms_version,
    cancellation_policy_version, acceptance_locale, acceptance_evidence,
    acceptance_evidence_fingerprint,
    marketplace_commission_rate_basis_points,
    marketplace_commission_amount_fils, created_at
  ) values (
    snapshot_id, attempt.customer_user_id, attempt.profile_id,
    attempt.quote_fingerprint, attempt.intent_fingerprint,
    attempt.quote_payload, attempt.intent_payload,
    current_quote ->> 'termsVersion',
    attempt.intent_payload ->> 'cancellationPolicyVersion', attempt.locale,
    attempt.intent_payload -> 'acceptanceEvidence',
    encode(extensions.digest(
      convert_to((attempt.intent_payload -> 'acceptanceEvidence')::text, 'UTF8'),
      'sha256'
    ), 'hex'),
    1000,
    (current_quote ->> 'bookingPriceIqd')::bigint * 100,
    submission_created_at
  );
  response_deadline := submission_created_at + interval '4 hours';
  insert into public.booking_requests (
    id, booking_request_reference, customer_user_id, owner_user_id, profile_id,
    booking_snapshot_id, booking_period_commitment_id, payment_lifecycle_id,
    customer_name, party_size, booking_note, status,
    response_deadline, created_at
  ) values (
    request_id, request_reference, attempt.customer_user_id, owner_user_id,
    attempt.profile_id, snapshot_id,
    (hold ->> 'bookingPeriodCommitmentId')::uuid,
    attempt.payment_lifecycle_id,
    attempt.intent_payload ->> 'customerName',
    (attempt.intent_payload ->> 'partySize')::smallint,
    attempt.intent_payload ->> 'bookingNote',
    'pending', response_deadline, submission_created_at
  );
  insert into public.owner_request_notifications (
    booking_request_id, owner_user_id, created_at
  ) values (request_id, owner_user_id, submission_created_at);
  update public.booking_request_submission_attempts
  set state = 'finalized', booking_request_id = request_id,
    updated_at = submission_created_at
  where id = target_attempt_id;

  return jsonb_build_object(
    'status', 'pending',
    'bookingRequestReference', request_reference,
    'responseDeadline', to_char(
      response_deadline at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  );
end;
$$;

create function public.lookup_booking_request_submission(target_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare attempt public.booking_request_submission_attempts;
declare request public.booking_requests;
begin
  select attempts.* into attempt
  from public.booking_request_submission_attempts attempts
  where attempts.id = target_attempt_id
  for update;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  if attempt.booking_request_id is null then
    return jsonb_build_object('status', 'absent');
  end if;
  select requests.* into request
  from public.booking_requests requests
  where requests.id = attempt.booking_request_id;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  return jsonb_build_object(
    'status', 'pending',
    'bookingRequestReference', request.booking_request_reference,
    'responseDeadline', to_char(
      request.response_deadline at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  );
end;
$$;

revoke all on function public.lookup_booking_request_submission(uuid)
  from public, anon, authenticated;
grant execute on function public.lookup_booking_request_submission(uuid)
  to service_role;

create function public.classify_booking_request_authorization_claim_persistence(
  target_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare attempt public.booking_request_submission_attempts;
declare claim public.booking_request_authorization_claims;
begin
  select * into attempt
  from public.booking_request_submission_attempts attempts
  where attempts.id = target_attempt_id
  for update;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  select * into claim
  from public.booking_request_authorization_claims claims
  where claims.attempt_id = target_attempt_id
  for update;
  if not found then
    if attempt.state = 'authorizing' and attempt.payment_snapshot is null then
      return jsonb_build_object('status', 'absent');
    end if;
    return jsonb_build_object('status', 'unknown');
  end if;
  if exists (
    select 1
    from public.booking_request_authorization_reconciliation_outbox outbox
    where outbox.claim_id = claim.id
      and outbox.claim_generation = claim.generation
  ) and attempt.payment_snapshot is not null then
    return jsonb_build_object('status', 'persisted');
  end if;
  return jsonb_build_object('status', 'unknown');
end;
$$;
revoke all on function public.classify_booking_request_authorization_claim_persistence(uuid)
  from public, anon, authenticated;
grant execute on function public.classify_booking_request_authorization_claim_persistence(uuid)
  to service_role;

create function public.dequeue_booking_request_authorization_reconciliation()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare attempt public.booking_request_submission_attempts;
declare claim public.booking_request_authorization_claims;
declare leased_outbox public.booking_request_authorization_reconciliation_outbox;
declare worker_lease_token uuid := gen_random_uuid();
declare leased_until timestamptz := clock_timestamp() + interval '5 minutes';
declare operation jsonb;
declare operation_kind text;
begin
  select attempts.* into attempt
  from public.booking_request_submission_attempts attempts
  join public.booking_request_authorization_claims claims
    on claims.attempt_id = attempts.id
  join public.booking_request_authorization_reconciliation_outbox outbox
    on outbox.claim_id = claims.id
    and outbox.claim_generation = claims.generation
  where outbox.state = 'pending'
    and (outbox.lease_expires_at is null
      or outbox.lease_expires_at <= clock_timestamp())
    and public.booking_request_claim_state_is_reconcilable(claims.state)
  order by outbox.updated_at, outbox.claim_id
  for update of attempts skip locked
  limit 1;
  if not found then
    return jsonb_build_object('status', 'empty');
  end if;

  select * into claim
  from public.booking_request_authorization_claims claims
  where claims.attempt_id = attempt.id
  for update;
  select * into leased_outbox
  from public.booking_request_authorization_reconciliation_outbox rows
  where rows.claim_id = claim.id
    and rows.claim_generation = claim.generation
  for update;
  if not found
    or leased_outbox.state <> 'pending'
    or (leased_outbox.lease_expires_at is not null
      and leased_outbox.lease_expires_at > clock_timestamp())
    or not public.booking_request_claim_state_is_reconcilable(claim.state) then
    return jsonb_build_object('status', 'empty');
  end if;

  operation := nullif(attempt.payment_snapshot -> 'release', 'null'::jsonb);
  if operation is null then
    operation := attempt.payment_snapshot -> 'authorization';
    operation_kind := 'authorization';
  else
    operation_kind := 'release';
  end if;
  if operation is null or operation ->> 'status' <> 'pending' then
    return jsonb_build_object('status', 'empty');
  end if;

  update public.booking_request_authorization_reconciliation_outbox rows
  set lease_token = worker_lease_token,
    lease_expires_at = leased_until,
    updated_at = clock_timestamp()
  where rows.claim_id = claim.id;

  return jsonb_build_object(
    'status', 'work',
    'claimId', claim.id,
    'generation', claim.generation,
    'stateRevision', claim.state_revision,
    'leaseToken', worker_lease_token,
    'leaseExpiresAt', to_char(
      leased_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'operationKind', operation_kind,
    'paymentLifecycleId', claim.payment_lifecycle_id,
    'logicalOperationId', operation ->> 'logicalOperationId',
    'physicalAttemptId', operation ->> 'attemptId',
    'amountFils', claim.amount_fils,
    'currency', claim.currency,
    'providerIdentity', jsonb_build_object(
      'provider', claim.provider,
      'environment', claim.environment,
      'merchantId', claim.merchant_id,
      'terminalId', claim.terminal_id
    ),
    'providerIdempotencyKey', claim.provider_idempotency_key,
    'notAfter', to_char(
      claim.not_after at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'paymentSnapshot', attempt.payment_snapshot
  );
end;
$$;
revoke all on function public.dequeue_booking_request_authorization_reconciliation()
  from public, anon, authenticated;
grant execute on function public.dequeue_booking_request_authorization_reconciliation()
  to service_role;

create function public.complete_booking_request_authorization_reconciliation(
  target_claim_id uuid,
  target_generation integer,
  target_state_revision bigint,
  target_lease_token uuid,
  target_payment_snapshot jsonb,
  target_provider_identity jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target_attempt_id uuid;
declare claim public.booking_request_authorization_claims;
declare outbox public.booking_request_authorization_reconciliation_outbox;
begin
  select claims.attempt_id into target_attempt_id
  from public.booking_request_authorization_claims claims
  where claims.id = target_claim_id;
  if target_attempt_id is null then
    return jsonb_build_object('status', 'conflict');
  end if;
  perform attempts.id
  from public.booking_request_submission_attempts attempts
  where attempts.id = target_attempt_id
  for update;
  if not found then
    return jsonb_build_object('status', 'conflict');
  end if;
  select * into claim
  from public.booking_request_authorization_claims claims
  where claims.id = target_claim_id
  for update;
  select * into outbox
  from public.booking_request_authorization_reconciliation_outbox rows
  where rows.claim_id = target_claim_id
    and rows.claim_generation = target_generation
  for update;
  if not found
    or claim.generation <> target_generation
    or claim.state_revision <> target_state_revision
    or not public.booking_request_claim_state_is_reconcilable(claim.state)
    or outbox.state <> 'pending'
    or outbox.lease_token is distinct from target_lease_token
    or outbox.lease_expires_at <= clock_timestamp() then
    return jsonb_build_object('status', 'conflict');
  end if;
  perform public.save_booking_request_payment_snapshot(
    claim.attempt_id, target_payment_snapshot, target_provider_identity
  );
  select * into claim
  from public.booking_request_authorization_claims claims
  where claims.id = target_claim_id;
  update public.booking_request_authorization_reconciliation_outbox rows
  set observed_state_revision = claim.state_revision,
    state = case
      when public.booking_request_claim_state_is_reconcilable(claim.state)
        then 'pending'
      else 'complete'
    end,
    lease_token = null,
    lease_expires_at = null,
    updated_at = clock_timestamp()
  where rows.claim_id = claim.id
    and rows.claim_generation = target_generation;
  return jsonb_build_object(
    'status', 'applied',
    'claimState', claim.state,
    'stateRevision', claim.state_revision
  );
end;
$$;
revoke all on function public.complete_booking_request_authorization_reconciliation(
  uuid, integer, bigint, uuid, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.complete_booking_request_authorization_reconciliation(
  uuid, integer, bigint, uuid, jsonb, jsonb
) to service_role;

revoke all on function public.finalize_booking_request_submission(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.finalize_booking_request_submission(uuid, jsonb)
  to service_role;

create or replace function public.mark_booking_request_reconciliation_required(
  target_attempt_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform attempts.id
  from public.booking_request_submission_attempts attempts
  where attempts.id = target_attempt_id
  for update;
  perform claims.id
  from public.booking_request_authorization_claims claims
  where claims.attempt_id = target_attempt_id
  for update;
  update public.booking_request_submission_attempts
  set state = case
      when state in ('finalized', 'released', 'authorization_failed') then state
      else 'reconciliation_required'
    end,
    updated_at = now()
  where id = target_attempt_id;
  update public.booking_request_authorization_claims claims
  set state = 'reconciliation_required',
    state_revision = state_revision + 1,
    updated_at = clock_timestamp()
  where claims.attempt_id = target_attempt_id
    and claims.state = 'starting';
  update public.booking_request_authorization_reconciliation_outbox outbox
  set state = 'pending', observed_state_revision = claims.state_revision,
    lease_token = null, lease_expires_at = null,
    updated_at = clock_timestamp()
  from public.booking_request_authorization_claims claims
  where claims.attempt_id = target_attempt_id
    and outbox.claim_id = claims.id;
end;
$$;

revoke all on function public.mark_booking_request_reconciliation_required(uuid)
  from public, anon, authenticated;
grant execute on function public.mark_booking_request_reconciliation_required(uuid)
  to service_role;

create function public.list_owner_booking_request_notifications()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'bookingRequestReference', requests.booking_request_reference,
    'status', requests.status,
    'customerName', requests.customer_name,
    'partySize', requests.party_size,
    'bookingNote', requests.booking_note,
    'cottageName', snapshots.quote_payload ->> 'cottageName',
    'bookingPeriod', snapshots.quote_payload -> 'items',
    'responseDeadline', to_char(
      requests.response_deadline at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'createdAt', to_char(
      notifications.created_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
  ) order by notifications.created_at desc), '[]'::jsonb)
  from public.owner_request_notifications notifications
  join public.booking_requests requests on requests.id = notifications.booking_request_id
  join public.booking_snapshots snapshots on snapshots.id = requests.booking_snapshot_id
  where notifications.owner_user_id = (select auth.uid())
    and exists (
      select 1 from public.account_contexts contexts
      where contexts.user_id = (select auth.uid())
        and contexts.role = 'cottage_owner'::public.account_role
        and contexts.owner_approval_state = 'approved'::public.owner_approval_state
    );
$$;

revoke all on function public.list_owner_booking_request_notifications()
  from public, anon;
grant execute on function public.list_owner_booking_request_notifications()
  to authenticated;
