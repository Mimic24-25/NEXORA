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
  v_name := coalesce(
    nullif(btrim(p_metadata ->> 'name'), ''),
    nullif(split_part(coalesce(p_email, ''), '@', 1), ''),
    'Пользователь'
  );
  v_username := lower(regexp_replace(
    coalesce(
      nullif(btrim(p_metadata ->> 'username'), ''),
      nullif(split_part(coalesce(p_email, ''), '@', 1), ''),
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
    values (
      p_user_id,
      v_name,
      v_username,
      nullif(p_metadata ->> 'phone', ''),
      p_email,
      'offline'
    )
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
  if new.email_confirmed_at is null then
    return new;
  end if;

  perform public.nexora_sync_profile(new.id, new.email, new.raw_user_meta_data);
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
            select 1
            from public.contacts as ct
            where ct.owner_id = auth.uid()
              and ct.contact_user_id = p.id
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
            from public.contacts as ct
            where ct.owner_id = auth.uid()
              and ct.contact_user_id = p.id
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
            from public.contacts as ct
            where ct.owner_id = auth.uid()
              and ct.contact_user_id = p.id
          )
        )
      then p.last_seen
      else null
    end
  from public.profiles as p
  join auth.users as u on u.id = p.id
  where auth.uid() is not null
    and u.email_confirmed_at is not null
    and p.id <> auth.uid()
    and not exists (
      select 1
      from public.user_blocks as b
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
revoke all on function public.nexora_search_profiles(text) from public, anon;
revoke all on function public.nexora_create_direct_conversation(uuid) from public, anon;
grant execute on function public.nexora_is_conversation_member(uuid) to authenticated;
grant execute on function public.nexora_search_profiles(text) to authenticated;
grant execute on function public.nexora_create_direct_conversation(uuid) to authenticated;

drop policy if exists "Users can view own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Users can view conversations they belong to" on public.conversations;
drop policy if exists "Users can only manage their own membership" on public.conversation_members;
drop policy if exists "Users can view messages in their conversations" on public.messages;
drop policy if exists "Users can insert messages to their conversations" on public.messages;
drop policy if exists "Users can update their own messages" on public.messages;
drop policy if exists "Users can manage own attachments" on public.message_attachments;
drop policy if exists "Users can view own notifications" on public.notifications;
drop policy if exists "Users can manage own notifications" on public.notifications;
drop policy if exists "Users can manage own settings" on public.user_settings;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and policyname like 'nexora\_%' escape '\'
  loop
    execute format(
      'drop policy %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end;
$$;

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
using (sender_id = auth.uid() and public.nexora_is_conversation_member(conversation_id))
with check (sender_id = auth.uid() and public.nexora_is_conversation_member(conversation_id));

create policy nexora_attachments_select_member on public.message_attachments
for select to authenticated using (
  exists (
    select 1 from public.messages as m
    where m.id = message_id
      and public.nexora_is_conversation_member(m.conversation_id)
  )
);
create policy nexora_attachments_insert_own on public.message_attachments
for insert to authenticated with check (
  exists (
    select 1 from public.messages as m
    where m.id = message_id
      and m.sender_id = auth.uid()
      and public.nexora_is_conversation_member(m.conversation_id)
  )
);
create policy nexora_attachments_delete_own on public.message_attachments
for delete to authenticated using (
  exists (
    select 1 from public.messages as m
    where m.id = message_id
      and m.sender_id = auth.uid()
      and public.nexora_is_conversation_member(m.conversation_id)
  )
);

create policy nexora_reactions_select_member on public.message_reactions
for select to authenticated using (
  exists (
    select 1 from public.messages as m
    where m.id = message_id
      and public.nexora_is_conversation_member(m.conversation_id)
  )
);
create policy nexora_reactions_insert_own on public.message_reactions
for insert to authenticated with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.messages as m
    where m.id = message_id
      and public.nexora_is_conversation_member(m.conversation_id)
  )
);
create policy nexora_reactions_delete_own on public.message_reactions
for delete to authenticated using (user_id = auth.uid());

create policy nexora_reads_select_member on public.message_reads
for select to authenticated using (
  exists (
    select 1 from public.messages as m
    where m.id = message_id
      and public.nexora_is_conversation_member(m.conversation_id)
  )
);
create policy nexora_reads_insert_own on public.message_reads
for insert to authenticated with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.messages as m
    where m.id = message_id
      and public.nexora_is_conversation_member(m.conversation_id)
  )
);
create policy nexora_reads_update_own on public.message_reads
for update to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.messages as m
    where m.id = message_id
      and public.nexora_is_conversation_member(m.conversation_id)
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.messages as m
    where m.id = message_id
      and public.nexora_is_conversation_member(m.conversation_id)
  )
);

create policy nexora_contacts_manage_own on public.contacts
for all to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());
create policy nexora_blocks_manage_own on public.user_blocks
for all to authenticated
using (blocker_id = auth.uid())
with check (blocker_id = auth.uid());

create policy nexora_calls_select_member on public.call_sessions
for select to authenticated using (
  conversation_id is not null
  and public.nexora_is_conversation_member(conversation_id)
);
create policy nexora_calls_insert_member on public.call_sessions
for insert to authenticated with check (
  created_by = auth.uid()
  and conversation_id is not null
  and public.nexora_is_conversation_member(conversation_id)
);
create policy nexora_calls_update_creator on public.call_sessions
for update to authenticated
using (created_by = auth.uid() and public.nexora_is_conversation_member(conversation_id))
with check (created_by = auth.uid() and public.nexora_is_conversation_member(conversation_id));

create policy nexora_call_participants_select_member on public.call_participants
for select to authenticated using (
  exists (
    select 1 from public.call_sessions as cs
    where cs.id = call_id
      and public.nexora_is_conversation_member(cs.conversation_id)
  )
);
create policy nexora_call_participants_insert_self on public.call_participants
for insert to authenticated with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.call_sessions as cs
    where cs.id = call_id
      and public.nexora_is_conversation_member(cs.conversation_id)
  )
);
create policy nexora_call_participants_update_self on public.call_participants
for update to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.call_sessions as cs
    where cs.id = call_id
      and public.nexora_is_conversation_member(cs.conversation_id)
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.call_sessions as cs
    where cs.id = call_id
      and public.nexora_is_conversation_member(cs.conversation_id)
  )
);

create policy nexora_invites_select_involved on public.group_invites
for select to authenticated using (
  invited_by = auth.uid()
  or invited_user_id = auth.uid()
);
create policy nexora_invites_insert_member on public.group_invites
for insert to authenticated with check (
  invited_by = auth.uid()
  and public.nexora_is_conversation_member(conversation_id)
);
create policy nexora_invites_update_invitee on public.group_invites
for update to authenticated
using (invited_user_id = auth.uid())
with check (invited_user_id = auth.uid());

create policy nexora_notifications_select_own on public.notifications
for select to authenticated using (user_id = auth.uid());
create policy nexora_notifications_update_own on public.notifications
for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy nexora_notifications_delete_own on public.notifications
for delete to authenticated using (user_id = auth.uid());

create policy nexora_push_subscriptions_manage_own on public.push_subscriptions
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
create policy nexora_settings_manage_own on public.user_settings
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

grant select on public.profiles to authenticated;
grant update (name, username, phone, avatar_url, bio, status, last_seen, privacy_phone, privacy_last_seen, privacy_avatar)
on public.profiles to authenticated;
grant select on public.conversations, public.conversation_members to authenticated;
grant select, insert on public.messages to authenticated;
grant update (content, edited_at, deleted_at) on public.messages to authenticated;
grant select, insert, delete on public.message_attachments to authenticated;
grant select, insert, delete on public.message_reactions to authenticated;
grant select, insert on public.message_reads to authenticated;
grant update (read_at) on public.message_reads to authenticated;
grant select, insert, update, delete on public.contacts, public.user_blocks to authenticated;
grant select, insert on public.call_sessions, public.call_participants to authenticated;
grant update (ended_at, status) on public.call_sessions to authenticated;
grant update (left_at, is_muted, is_camera_on) on public.call_participants to authenticated;
grant select, insert on public.group_invites to authenticated;
grant update (status) on public.group_invites to authenticated;
grant select, delete on public.notifications to authenticated;
grant update (is_read) on public.notifications to authenticated;
grant select, insert, update, delete on public.push_subscriptions, public.user_settings to authenticated;

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
