create or replace function public.nexora_is_conversation_member(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.conversation_members as cm
    where cm.conversation_id = p_conversation_id
      and cm.user_id = auth.uid()
  );
$$;

create or replace function public.nexora_sync_profile(
  p_user_id uuid,
  p_email text,
  p_metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text;
  v_name text;
begin
  if p_email is null then
    return;
  end if;
  if exists (
    select 1 from public.profiles
    where id = p_user_id or lower(email) = lower(p_email)
  ) then
    return;
  end if;

  v_name := coalesce(
    nullif(btrim(p_metadata ->> 'name'), ''),
    nullif(split_part(p_email, '@', 1), ''),
    'Пользователь'
  );
  v_username := lower(regexp_replace(
    coalesce(
      nullif(btrim(p_metadata ->> 'username'), ''),
      nullif(split_part(p_email, '@', 1), ''),
      'user'
    ),
    '[^a-zA-Z0-9_]+',
    '_',
    'g'
  ));
  if length(v_username) < 3 then
    v_username := 'user_' || left(p_user_id::text, 8);
  end if;

  begin
    insert into public.profiles (id, name, username, phone, email, status)
    values (p_user_id, v_name, v_username, nullif(p_metadata ->> 'phone', ''), p_email, 'offline')
    on conflict (id) do nothing;
  exception when unique_violation then
    insert into public.profiles (id, name, username, phone, email, status)
    values (
      p_user_id,
      v_name,
      left(v_username, 40) || '_' || left(p_user_id::text, 8),
      nullif(p_metadata ->> 'phone', ''),
      p_email,
      'offline'
    )
    on conflict (id) do nothing;
  end;
end;
$$;

create or replace function public.nexora_on_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null then
    perform public.nexora_sync_profile(new.id, new.email, new.raw_user_meta_data);
  end if;
  return new;
end;
$$;

revoke all on function public.nexora_sync_profile(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.nexora_on_auth_user_created() from public, anon, authenticated;
drop trigger if exists nexora_auth_user_profile_created on auth.users;
create trigger nexora_auth_user_profile_created
after insert on auth.users
for each row execute function public.nexora_on_auth_user_created();
drop trigger if exists nexora_auth_user_profile_confirmed on auth.users;
create trigger nexora_auth_user_profile_confirmed
after update of email_confirmed_at on auth.users
for each row
when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
execute function public.nexora_on_auth_user_created();

do $$
declare
  auth_user record;
begin
  for auth_user in
    select id, email, raw_user_meta_data
    from auth.users
    where email_confirmed_at is not null
    order by created_at, id
  loop
    perform public.nexora_sync_profile(
      auth_user.id,
      auth_user.email,
      auth_user.raw_user_meta_data
    );
  end loop;
end;
$$;

create or replace function public.nexora_create_direct_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_conversation_id uuid;
begin
  if v_user_id is null then
    raise exception 'Требуется авторизация.' using errcode = '28000';
  end if;
  if p_other_user_id is null or p_other_user_id = v_user_id then
    raise exception 'Выберите другого пользователя.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.profiles as p
    join auth.users as u on u.id = p.id
    where p.id = v_user_id and u.email_confirmed_at is not null
  ) or not exists (
    select 1
    from public.profiles as p
    join auth.users as u on u.id = p.id
    where p.id = p_other_user_id and u.email_confirmed_at is not null
  ) then
    raise exception 'Подтверждённый пользователь не найден.' using errcode = 'P0002';
  end if;
  if exists (
    select 1
    from public.user_blocks as b
    where (b.blocker_id = v_user_id and b.blocked_id = p_other_user_id)
       or (b.blocker_id = p_other_user_id and b.blocked_id = v_user_id)
  ) then
    raise exception 'Не удалось создать переписку с этим пользователем.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      least(v_user_id::text, p_other_user_id::text) || ':' ||
      greatest(v_user_id::text, p_other_user_id::text),
      0
    )
  );

  select c.id into v_conversation_id
  from public.conversations as c
  where c.type = 'direct'
    and exists (
      select 1 from public.conversation_members as cm
      where cm.conversation_id = c.id and cm.user_id = v_user_id
    )
    and exists (
      select 1 from public.conversation_members as cm
      where cm.conversation_id = c.id and cm.user_id = p_other_user_id
    )
    and (
      select count(*) from public.conversation_members as cm
      where cm.conversation_id = c.id
    ) = 2
  limit 1;

  if v_conversation_id is not null then
    return v_conversation_id;
  end if;

  insert into public.conversations (type, created_by)
  values ('direct', v_user_id)
  returning id into v_conversation_id;

  insert into public.conversation_members (conversation_id, user_id, role)
  values
    (v_conversation_id, v_user_id, 'owner'),
    (v_conversation_id, p_other_user_id, 'member');

  return v_conversation_id;
end;
$$;

revoke all on function public.nexora_is_conversation_member(uuid) from public, anon;
revoke all on function public.nexora_create_direct_conversation(uuid) from public, anon;
grant execute on function public.nexora_is_conversation_member(uuid) to authenticated;
grant execute on function public.nexora_create_direct_conversation(uuid) to authenticated;

create or replace function public.nexora_get_profiles(p_user_ids uuid[])
returns table (
  id uuid,
  name text,
  username text,
  avatar_url text,
  bio text,
  status text,
  last_seen timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.name,
    p.username,
    case
      when p.privacy_avatar = 'everyone'
        or (
          p.privacy_avatar = 'contacts'
          and exists (
            select 1
            from public.contacts as subject_contacts
            where subject_contacts.owner_id = p.id
              and subject_contacts.contact_user_id = auth.uid()
          )
        )
      then p.avatar_url
      else null
    end,
    p.bio,
    case
      when p.privacy_last_seen = 'everyone'
        or (
          p.privacy_last_seen = 'contacts'
          and exists (
            select 1
            from public.contacts as subject_contacts
            where subject_contacts.owner_id = p.id
              and subject_contacts.contact_user_id = auth.uid()
          )
        )
      then p.status
      else 'offline'
    end,
    case
      when p.privacy_last_seen = 'everyone'
        or (
          p.privacy_last_seen = 'contacts'
          and exists (
            select 1
            from public.contacts as subject_contacts
            where subject_contacts.owner_id = p.id
              and subject_contacts.contact_user_id = auth.uid()
          )
        )
      then p.last_seen
      else null
    end
  from public.profiles as p
  join auth.users as subject on subject.id = p.id
  join auth.users as viewer on viewer.id = auth.uid()
  where auth.uid() is not null
    and viewer.email_confirmed_at is not null
    and subject.email_confirmed_at is not null
    and coalesce(cardinality(p_user_ids), 0) <= 100
    and p.id = any(coalesce(p_user_ids, array[]::uuid[]))
    and p.id <> auth.uid()
    and not exists (
      select 1
      from public.user_blocks as b
      where (b.blocker_id = auth.uid() and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = auth.uid())
    )
  limit 100;
$$;

revoke all on function public.nexora_get_profiles(uuid[]) from public, anon;
grant execute on function public.nexora_get_profiles(uuid[]) to authenticated;

create or replace function public.nexora_search_profiles(p_search text default '')
returns table (
  id uuid,
  name text,
  username text,
  avatar_url text,
  bio text,
  status text,
  last_seen timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.name,
    p.username,
    case
      when p.privacy_avatar = 'everyone'
        or (
          p.privacy_avatar = 'contacts'
          and exists (
            select 1 from public.contacts as subject_contacts
            where subject_contacts.owner_id = p.id
              and subject_contacts.contact_user_id = auth.uid()
          )
        )
      then p.avatar_url
      else null
    end,
    p.bio,
    case
      when p.privacy_last_seen = 'everyone'
        or (
          p.privacy_last_seen = 'contacts'
          and exists (
            select 1 from public.contacts as subject_contacts
            where subject_contacts.owner_id = p.id
              and subject_contacts.contact_user_id = auth.uid()
          )
        )
      then p.status
      else 'offline'
    end,
    case
      when p.privacy_last_seen = 'everyone'
        or (
          p.privacy_last_seen = 'contacts'
          and exists (
            select 1 from public.contacts as subject_contacts
            where subject_contacts.owner_id = p.id
              and subject_contacts.contact_user_id = auth.uid()
          )
        )
      then p.last_seen
      else null
    end
  from public.profiles as p
  join auth.users as subject on subject.id = p.id
  join auth.users as viewer on viewer.id = auth.uid()
  where auth.uid() is not null
    and viewer.email_confirmed_at is not null
    and subject.email_confirmed_at is not null
    and p.id <> auth.uid()
    and not exists (
      select 1 from public.user_blocks as b
      where (b.blocker_id = auth.uid() and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = auth.uid())
    )
    and (
      nullif(btrim(p_search), '') is null
      or p.name ilike '%' || left(btrim(p_search), 100) || '%'
      or p.username ilike '%' || left(btrim(p_search), 100) || '%'
    )
  order by p.name
  limit 50;
$$;

revoke all on function public.nexora_search_profiles(text) from public, anon;
grant execute on function public.nexora_search_profiles(text) to authenticated;

create or replace function public.nexora_latest_messages(p_conversation_ids uuid[])
returns table (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  content text,
  message_type text,
  created_at timestamptz,
  edited_at timestamptz,
  deleted_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (m.conversation_id)
    m.id,
    m.conversation_id,
    m.sender_id,
    m.content,
    m.message_type,
    m.created_at,
    m.edited_at,
    m.deleted_at
  from public.messages as m
  where m.conversation_id = any(coalesce(p_conversation_ids, array[]::uuid[]))
    and coalesce(cardinality(p_conversation_ids), 0) <= 500
    and public.nexora_is_conversation_member(m.conversation_id)
  order by m.conversation_id, m.created_at desc, m.id desc;
$$;

revoke all on function public.nexora_latest_messages(uuid[]) from public, anon;
grant execute on function public.nexora_latest_messages(uuid[]) to authenticated;

create or replace function public.nexora_touch_conversation_from_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations
  set updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

revoke all on function public.nexora_touch_conversation_from_message() from public, anon, authenticated;
drop trigger if exists nexora_touch_conversation_from_message on public.messages;
create trigger nexora_touch_conversation_from_message
after insert or update on public.messages
for each row execute function public.nexora_touch_conversation_from_message();

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

drop policy if exists "Users can view own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Users can view conversations they belong to" on public.conversations;
drop policy if exists "Users can only manage their own membership" on public.conversation_members;
drop policy if exists "Users can view messages in their conversations" on public.messages;
drop policy if exists "Users can insert messages to their conversations" on public.messages;
drop policy if exists "Users can update their own messages" on public.messages;
drop policy if exists nexora_profiles_select_own on public.profiles;
drop policy if exists nexora_profiles_update_own on public.profiles;
drop policy if exists nexora_conversations_select_member on public.conversations;
drop policy if exists nexora_members_select_conversation on public.conversation_members;
drop policy if exists nexora_messages_select_member on public.messages;
drop policy if exists nexora_messages_insert_member on public.messages;
drop policy if exists nexora_messages_update_own on public.messages;
drop policy if exists nexora_messages_delete_own on public.messages;

create policy nexora_profiles_select_own on public.profiles
for select to authenticated using (id = auth.uid());
create policy nexora_profiles_update_own on public.profiles
for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy nexora_conversations_select_member on public.conversations
for select to authenticated using (public.nexora_is_conversation_member(id));
create policy nexora_members_select_conversation on public.conversation_members
for select to authenticated using (public.nexora_is_conversation_member(conversation_id));
create policy nexora_messages_select_member on public.messages
for select to authenticated using (public.nexora_is_conversation_member(conversation_id));
create policy nexora_messages_insert_member on public.messages
for insert to authenticated with check (
  sender_id = auth.uid()
  and public.nexora_is_conversation_member(conversation_id)
);
create policy nexora_messages_update_own on public.messages
for update to authenticated
using (
  sender_id = auth.uid()
  and public.nexora_is_conversation_member(conversation_id)
)
with check (
  sender_id = auth.uid()
  and public.nexora_is_conversation_member(conversation_id)
);
create policy nexora_messages_delete_own on public.messages
for delete to authenticated
using (
  sender_id = auth.uid()
  and public.nexora_is_conversation_member(conversation_id)
);

revoke all on public.profiles, public.conversations, public.conversation_members, public.messages
from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (name, username, phone, avatar_url, bio, status, last_seen, privacy_phone, privacy_last_seen, privacy_avatar)
on public.profiles to authenticated;
grant select on public.conversations, public.conversation_members to authenticated;
grant select, insert, delete on public.messages to authenticated;
grant update (content, edited_at, deleted_at) on public.messages to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'messages'
    )
  then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;
