begin;

-- API clients use the existing row privileges and authorized functions. They do
-- not need table-definition, bulk-erasure, trigger, or maintenance privileges.
revoke references, trigger, truncate, maintain on table
  public.account_contexts,
  public.cottage_ownership,
  public.cottage_profile_administrator_audit,
  public.cottage_profile_localized_decisions,
  public.cottage_profile_localized_heads,
  public.cottage_profile_localized_revisions,
  public.cottage_profile_photos,
  public.cottage_profile_publication_decisions,
  public.cottage_profile_review_cycles,
  public.cottage_profile_review_photos,
  public.cottage_profile_source_revisions,
  public.cottage_profile_translation_attempts,
  public.cottage_profile_translation_human_reviews,
  public.cottage_publication_localizations,
  public.cottage_publication_media,
  public.cottage_publication_snapshots,
  public.cottage_translation_cache,
  public.cottage_translation_quality_reports,
  public.cottage_translation_runtime_control,
  public.cottage_translation_usage_reservations,
  public.cottage_translation_usage_results,
  public.owner_application_cottage_profiles,
  public.owner_application_information_requests,
  public.owner_application_lifecycle_control,
  public.owner_application_notices,
  public.owner_application_renewal_work,
  public.owner_application_transitions,
  public.owner_application_verification_records,
  public.owner_applications,
  public.owner_verification_document_access_grants,
  public.owner_verification_document_audit,
  public.owner_verification_document_cleanup,
  public.owner_verification_document_versions,
  public.owner_verification_documents
from anon, authenticated, service_role;

-- The remaining service-role grants came from the same broad defaults. Service
-- clients use narrow functions or existing row privileges for these tables too.
revoke references, trigger, truncate, maintain on table
  public.cottage_inventory_availability,
  public.cottage_inventory_date_price_overrides,
  public.cottage_inventory_standard_prices,
  public.cottage_inventory_weekday_price_overrides,
  public.cottage_marketplace_listings,
  public.cottage_shift_schedule_revisions,
  public.cottage_shifts,
  public.privileged_sign_in_attempts
from service_role;

-- Portable migrations create public tables as postgres. Provider-internal
-- creators such as supabase_admin remain outside this application boundary.
alter default privileges for role postgres in schema public
  revoke references, trigger, truncate, maintain on tables
  from anon, authenticated, service_role;

commit;
