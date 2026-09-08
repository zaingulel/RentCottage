begin;

select no_plan();

select ok(
  count(*) > 0,
  'the public table privilege inventory is not empty'
)
from pg_class relations
join pg_namespace schemas on schemas.oid = relations.relnamespace
where schemas.nspname = 'public'
  and relations.relkind in ('r', 'p');

select ok(
  not has_table_privilege(
    roles.role_name,
    format('%I.%I', schemas.nspname, relations.relname),
    privileges.privilege_name
  ),
  format(
    '%s has no %s privilege on public.%I',
    roles.role_name,
    privileges.privilege_name,
    relations.relname
  )
)
from pg_class relations
join pg_namespace schemas on schemas.oid = relations.relnamespace
cross join unnest(array['anon', 'authenticated', 'service_role']) roles(role_name)
cross join unnest(array['REFERENCES', 'TRIGGER', 'TRUNCATE', 'MAINTAIN']) privileges(privilege_name)
where schemas.nspname = 'public'
  and relations.relkind in ('r', 'p')
order by relations.relname, roles.role_name, privileges.privilege_name;

set local role postgres;

create table public.issue_199_default_privilege_probe (
  id bigint primary key
);

reset role;

select is(
  pg_get_userbyid(relations.relowner),
  'postgres',
  'the default privilege probe is created by the portable migration role'
)
from pg_class relations
join pg_namespace schemas on schemas.oid = relations.relnamespace
where schemas.nspname = 'public'
  and relations.relname = 'issue_199_default_privilege_probe'
  and relations.relkind = 'r';

select ok(
  not has_table_privilege(
    roles.role_name,
    'public.issue_199_default_privilege_probe',
    privileges.privilege_name
  ),
  format(
    '%s receives no default %s privilege on a new postgres-owned public table',
    roles.role_name,
    privileges.privilege_name
  )
)
from unnest(array['anon', 'authenticated', 'service_role']) roles(role_name)
cross join unnest(array['REFERENCES', 'TRIGGER', 'TRUNCATE', 'MAINTAIN']) privileges(privilege_name)
order by roles.role_name, privileges.privilege_name;

select * from finish();

rollback;
