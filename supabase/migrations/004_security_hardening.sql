-- NEXORA 004: Security Hardening
-- Не удаляет пользовательские данные.
-- Не меняет содержимое таблиц.

BEGIN;

-- 1. Уникальность username без учёта регистра
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_lower_unique
ON public.profiles (lower(username));

-- 2. Включение RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- 3. Отзыв табличных UPDATE и SELECT прав
REVOKE UPDATE ON TABLE public.profiles
FROM PUBLIC, anon, authenticated;

REVOKE SELECT ON TABLE public.profiles
FROM PUBLIC, anon, authenticated;

-- 4. Удаление ранее выданных отдельных SELECT-разрешений
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT DISTINCT grantee, column_name
        FROM information_schema.column_privileges
        WHERE table_schema = 'public'
          AND table_name = 'profiles'
          AND privilege_type = 'SELECT'
          AND grantee IN ('PUBLIC', 'anon', 'authenticated')
    LOOP
        EXECUTE format(
            'REVOKE SELECT (%I) ON TABLE public.profiles FROM %s',
            r.column_name,
            CASE
                WHEN r.grantee = 'PUBLIC' THEN 'PUBLIC'
                ELSE quote_ident(r.grantee)
            END
        );
    END LOOP;
END $$;

-- 5. Разрешённые колонки для чтения.
-- Email и другие служебные поля не предоставляются.
GRANT SELECT (
    id,
    name,
    username,
    phone,
    avatar_url,
    bio,
    status,
    last_seen,
    privacy_phone,
    privacy_last_seen,
    privacy_avatar
)
ON TABLE public.profiles TO authenticated;

-- 6. Разрешённые поля для обновления собственного профиля
GRANT UPDATE (
    name,
    username,
    phone,
    avatar_url,
    bio,
    status,
    last_seen,
    privacy_phone,
    privacy_last_seen,
    privacy_avatar
)
ON TABLE public.profiles TO authenticated;

-- 7. Добавление messages в Realtime, если ещё не добавлена
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_publication
        WHERE pubname = 'supabase_realtime'
    )
    AND NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'messages'
    ) THEN
        ALTER PUBLICATION supabase_realtime
        ADD TABLE public.messages;
    END IF;
END $$;

COMMIT;