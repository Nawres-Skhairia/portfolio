// Command Center schema. Each migration runs once, in order, inside one transaction.
// Isolation in three layers: composite keys that carry workspace_id (a link across workspaces is
// impossible), row-level security for the cc_app role, and the cross-workspace tests.
export const MIGRATIONS = [
  { id: 1, sql: `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'cc_app') then create role cc_app nologin; end if;
end $$;
do $$ begin
  execute format('grant cc_app to %I with set true, inherit false', current_user);
end $$;

create table cc_user (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email) and length(email) <= 254),
  password_hash text not null,
  display_name text not null check (length(display_name) between 1 and 40),
  email_verified_at timestamptz,
  privacy_ack_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table cc_session (
  id text primary key,
  user_id uuid not null references cc_user on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index cc_session_user on cc_session (user_id);
create table cc_token (
  id text primary key,
  user_id uuid not null references cc_user on delete cascade,
  purpose text not null check (purpose in ('verify')),
  expires_at timestamptz not null,
  used_at timestamptz
);
create table cc_attempt (bucket text not null, at timestamptz not null default now());
create index cc_attempt_bucket on cc_attempt (bucket, at);
create table cc_outbox (
  id bigserial primary key,
  to_email text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table cc_workspace (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 60),
  version integer not null default 0,
  settings jsonb not null default '{}'::jsonb,
  is_sample boolean not null default false,
  created_by uuid references cc_user on delete set null,
  created_at timestamptz not null default now()
);
create table cc_membership (
  workspace_id uuid not null references cc_workspace on delete cascade,
  user_id uuid not null references cc_user on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index cc_membership_user on cc_membership (user_id);

create table cc_project (
  workspace_id uuid not null references cc_workspace on delete cascade,
  id text not null,
  doc jsonb not null,
  primary key (workspace_id, id)
);
create table cc_milestone (
  workspace_id uuid not null,
  id text not null,
  project_id text not null,
  doc jsonb not null,
  primary key (workspace_id, id),
  foreign key (workspace_id, project_id) references cc_project (workspace_id, id) on delete cascade
);
create table cc_task (
  workspace_id uuid not null,
  id text not null,
  project_id text not null,
  doc jsonb not null,
  primary key (workspace_id, id),
  foreign key (workspace_id, project_id) references cc_project (workspace_id, id) on delete cascade
);
create table cc_task_dep (
  workspace_id uuid not null,
  task_id text not null,
  depends_on_id text not null,
  primary key (workspace_id, task_id, depends_on_id),
  foreign key (workspace_id, task_id) references cc_task (workspace_id, id) on delete cascade,
  foreign key (workspace_id, depends_on_id) references cc_task (workspace_id, id) on delete cascade
);
create table cc_risk (
  workspace_id uuid not null,
  id text not null,
  project_id text not null,
  doc jsonb not null,
  primary key (workspace_id, id),
  foreign key (workspace_id, project_id) references cc_project (workspace_id, id) on delete cascade
);
create table cc_activity (
  id bigserial primary key,
  workspace_id uuid not null references cc_workspace on delete cascade,
  actor_user_id uuid,
  actor_name text not null,
  entity text not null,
  entity_id text not null,
  field text not null,
  old_value text not null default '',
  new_value text not null default '',
  at_text text not null,
  copied boolean not null default false,
  created_at timestamptz not null default now()
);
create index cc_activity_entity on cc_activity (workspace_id, entity, entity_id, id);

create function cc_is_member(ws uuid) returns boolean language sql stable security definer set search_path = public as $f$
  select exists (select 1 from cc_membership m where m.workspace_id = ws and m.user_id = nullif(current_setting('cc.user_id', true), '')::uuid)
$f$;
revoke all on function cc_is_member(uuid) from public;
grant execute on function cc_is_member(uuid) to cc_app;

alter table cc_workspace enable row level security;
alter table cc_membership enable row level security;
alter table cc_project enable row level security;
alter table cc_milestone enable row level security;
alter table cc_task enable row level security;
alter table cc_task_dep enable row level security;
alter table cc_risk enable row level security;
alter table cc_activity enable row level security;

create policy cc_ws on cc_workspace to cc_app using (cc_is_member(id)) with check (cc_is_member(id));
create policy cc_mem on cc_membership for select to cc_app using (cc_is_member(workspace_id));
create policy cc_p on cc_project to cc_app using (cc_is_member(workspace_id)) with check (cc_is_member(workspace_id));
create policy cc_m on cc_milestone to cc_app using (cc_is_member(workspace_id)) with check (cc_is_member(workspace_id));
create policy cc_t on cc_task to cc_app using (cc_is_member(workspace_id)) with check (cc_is_member(workspace_id));
create policy cc_d on cc_task_dep to cc_app using (cc_is_member(workspace_id)) with check (cc_is_member(workspace_id));
create policy cc_r on cc_risk to cc_app using (cc_is_member(workspace_id)) with check (cc_is_member(workspace_id));
create policy cc_a_read on cc_activity for select to cc_app using (cc_is_member(workspace_id));
create policy cc_a_add on cc_activity for insert to cc_app with check (cc_is_member(workspace_id));

grant usage on schema public to cc_app;
grant select, update (name, version, settings) on cc_workspace to cc_app;
grant select on cc_membership to cc_app;
grant select, insert, update, delete on cc_project, cc_milestone, cc_task, cc_task_dep, cc_risk to cc_app;
grant select, insert on cc_activity to cc_app;
grant usage on sequence cc_activity_id_seq to cc_app;
` },
  // Sharing: invitations by email. The token itself is never stored, only its keyed hash (the id).
  { id: 2, sql: `
create table cc_invite (
  id text primary key,
  workspace_id uuid not null references cc_workspace on delete cascade,
  email text not null check (email = lower(email) and length(email) <= 254),
  role text not null check (role in ('admin', 'member')),
  invited_by uuid references cc_user on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz
);
create index cc_invite_ws on cc_invite (workspace_id);
alter table cc_invite enable row level security;
` },
];
