alter type public.owner_application_status add value 'needs_information';
alter type public.owner_application_status add value 'under_review';
alter type public.owner_application_status add value 'approved';
alter type public.owner_application_status add value 'rejected';
alter type public.owner_application_status add value 'expired';
alter type public.owner_application_status add value 'suspended';

alter type public.owner_approval_state add value 'expired';
alter type public.owner_approval_state add value 'suspended';
