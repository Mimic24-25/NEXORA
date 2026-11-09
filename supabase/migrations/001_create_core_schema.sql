create extension if not exists pgcrypto;

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  username text not null unique,
  phone text,
  email text not null unique,
  avatar_url text,
  bio text default '',
  status text not null default 'offline' check (status in ('online', 'offline')),
  last_seen timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  privacy_phone text not null default 'contacts' check (privacy_phone in ('everyone', 'contacts', 'nobody')),
  privacy_last_seen text not null default 'everyone' check (privacy_last_seen in ('everyone', 'contacts', 'nobody')),
  privacy_avatar text not null default 'contacts' check (privacy_avatar in ('everyone', 'contacts', 'nobody'))
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'direct' check (type in ('direct', 'group')),
  title text,
  avatar_url text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists conversation_members (
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid not null references profiles(id) on delete cascade,
  content text,
  message_type text not null default 'text' check (message_type in ('text', 'image', 'video', 'file', 'voice')),
  reply_to uuid references messages(id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  check (content is not null or message_type in ('image', 'video', 'file', 'voice'))
);

create table if not exists message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  file_name text not null,
  mime_type text not null,
  storage_path text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 25000000),
  created_at timestamptz not null default now()
);

create table if not exists message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

create table if not exists message_reads (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  unique (message_id, user_id)
);

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  contact_user_id uuid not null references profiles(id) on delete cascade,
  label text,
  created_at timestamptz not null default now(),
  unique (owner_id, contact_user_id)
);

create table if not exists user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references profiles(id) on delete cascade,
  blocked_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id)
);

create table if not exists call_sessions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete set null,
  created_by uuid references profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  mode text not null default 'video' check (mode in ('audio', 'video')),
  status text not null default 'active' check (status in ('active', 'ended', 'missed'))
);

create table if not exists call_participants (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references call_sessions(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  is_muted boolean not null default false,
  is_camera_on boolean not null default true,
  unique (call_id, user_id)
);

create table if not exists group_invites (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  invited_by uuid not null references profiles(id) on delete cascade,
  invited_user_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  unique (conversation_id, invited_user_id)
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('message', 'call', 'group', 'system')),
  title text not null,
  body text not null,
  payload jsonb default '{}'::jsonb,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create table if not exists user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references profiles(id) on delete cascade,
  theme text not null default 'dark' check (theme in ('dark', 'light', 'system')),
  sound_enabled boolean not null default true,
  push_enabled boolean not null default false,
  message_notifications boolean not null default true,
  call_notifications boolean not null default true,
  group_notifications boolean not null default true
);

create index if not exists idx_profiles_username on profiles(username);
create index if not exists idx_profiles_phone on profiles(phone);
create index if not exists idx_messages_conversation on messages(conversation_id, created_at desc);
create index if not exists idx_notifications_user on notifications(user_id, is_read, created_at desc);
create index if not exists idx_conversation_members_user on conversation_members(user_id);

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists profiles_updated_at on profiles;
create trigger profiles_updated_at
before update on profiles
for each row execute function update_updated_at();

drop trigger if exists conversations_updated_at on conversations;
create trigger conversations_updated_at
before update on conversations
for each row execute function update_updated_at();

alter table profiles enable row level security;
alter table conversations enable row level security;
alter table conversation_members enable row level security;
alter table messages enable row level security;
alter table message_attachments enable row level security;
alter table message_reactions enable row level security;
alter table message_reads enable row level security;
alter table contacts enable row level security;
alter table user_blocks enable row level security;
alter table call_sessions enable row level security;
alter table call_participants enable row level security;
alter table group_invites enable row level security;
alter table notifications enable row level security;
alter table push_subscriptions enable row level security;
alter table user_settings enable row level security;

drop policy if exists "Users can view own profile" on profiles;
create policy "Users can view own profile" on profiles for select using (auth.uid() = id);
drop policy if exists "Users can update own profile" on profiles;
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);
drop policy if exists "Users can view conversations they belong to" on conversations;
create policy "Users can view conversations they belong to" on conversations for select using (
  exists (
    select 1 from conversation_members cm
    where cm.conversation_id = conversations.id and cm.user_id = auth.uid()
  )
);
drop policy if exists "Users can only manage their own membership" on conversation_members;
create policy "Users can only manage their own membership" on conversation_members for select using (user_id = auth.uid());
drop policy if exists "Users can view messages in their conversations" on messages;
create policy "Users can view messages in their conversations" on messages for select using (
  exists (
    select 1 from conversation_members cm
    where cm.conversation_id = messages.conversation_id and cm.user_id = auth.uid()
  )
);
drop policy if exists "Users can insert messages to their conversations" on messages;
create policy "Users can insert messages to their conversations" on messages for insert with check (
  sender_id = auth.uid() and exists (
    select 1 from conversation_members cm
    where cm.conversation_id = messages.conversation_id and cm.user_id = auth.uid()
  )
);
drop policy if exists "Users can update their own messages" on messages;
create policy "Users can update their own messages" on messages for update
using (
  sender_id = auth.uid()
  and exists (
    select 1 from conversation_members cm
    where cm.conversation_id = messages.conversation_id and cm.user_id = auth.uid()
  )
)
with check (
  sender_id = auth.uid()
  and exists (
    select 1 from conversation_members cm
    where cm.conversation_id = messages.conversation_id and cm.user_id = auth.uid()
  )
);
drop policy if exists "Users can manage own attachments" on message_attachments;
create policy "Users can manage own attachments" on message_attachments for all using (
  exists (
    select 1 from messages m
    where m.id = message_attachments.message_id and m.sender_id = auth.uid()
  )
);
drop policy if exists "Users can view own notifications" on notifications;
create policy "Users can view own notifications" on notifications for select using (user_id = auth.uid());
drop policy if exists "Users can manage own notifications" on notifications;
create policy "Users can manage own notifications" on notifications for update using (user_id = auth.uid());
drop policy if exists "Users can manage own settings" on user_settings;
create policy "Users can manage own settings" on user_settings for all using (user_id = auth.uid());
