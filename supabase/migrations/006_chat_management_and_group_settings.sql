-- NEXORA 006: Chat management, group settings and notifications
-- Идемпотентная миграция. Не удаляет пользовательские данные.

BEGIN;

-- ============================================================================
-- 1. Настройки чата для каждого участника
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.conversation_user_settings (
  conversation_id uuid NOT NULL
    REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL
    REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_pinned boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  muted_until timestamptz,
  last_read_at timestamptz,
  PRIMARY KEY (conversation_id, user_id)
);

ALTER TABLE public.conversation_user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nexora_conv_settings_select_own
  ON public.conversation_user_settings;
DROP POLICY IF EXISTS nexora_conv_settings_upsert_own
  ON public.conversation_user_settings;
DROP POLICY IF EXISTS nexora_conv_settings_delete_own
  ON public.conversation_user_settings;

CREATE POLICY nexora_conv_settings_select_own
  ON public.conversation_user_settings FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY nexora_conv_settings_upsert_own
  ON public.conversation_user_settings FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.nexora_is_conversation_member(conversation_id)
  );

CREATE POLICY nexora_conv_settings_update_own
  ON public.conversation_user_settings FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY nexora_conv_settings_delete_own
  ON public.conversation_user_settings FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.conversation_user_settings TO authenticated;

-- ============================================================================
-- 2. Настройки группы (глобальные для conversation)
-- ============================================================================

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS description text DEFAULT '',
  ADD COLUMN IF NOT EXISTS can_write boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_send_files boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_send_media boolean NOT NULL DEFAULT true;

-- ============================================================================
-- 3. RPC: обновить настройки чата участника
-- ============================================================================

CREATE OR REPLACE FUNCTION public.nexora_update_conversation_settings(
  p_conversation_id uuid,
  p_is_pinned boolean DEFAULT NULL,
  p_is_archived boolean DEFAULT NULL,
  p_muted_until timestamptz DEFAULT NULL,
  p_last_read_at timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация.' USING errcode = '28000';
  END IF;

  IF NOT public.nexora_is_conversation_member(p_conversation_id) THEN
    RAISE EXCEPTION 'Доступ запрещён.' USING errcode = '42501';
  END IF;

  INSERT INTO public.conversation_user_settings (
    conversation_id, user_id, is_pinned, is_archived, muted_until, last_read_at
  )
  VALUES (
    p_conversation_id,
    v_user_id,
    COALESCE(p_is_pinned, false),
    COALESCE(p_is_archived, false),
    p_muted_until,
    COALESCE(p_last_read_at, now())
  )
  ON CONFLICT (conversation_id, user_id)
  DO UPDATE SET
    is_pinned    = COALESCE(p_is_pinned,    conversation_user_settings.is_pinned),
    is_archived  = COALESCE(p_is_archived,  conversation_user_settings.is_archived),
    muted_until  = COALESCE(p_muted_until,  conversation_user_settings.muted_until),
    last_read_at = COALESCE(p_last_read_at, conversation_user_settings.last_read_at);
END;
$$;

REVOKE ALL ON FUNCTION public.nexora_update_conversation_settings(uuid, boolean, boolean, timestamptz, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nexora_update_conversation_settings(uuid, boolean, boolean, timestamptz, timestamptz)
  TO authenticated;

-- ============================================================================
-- 4. RPC: обновить настройки группы (только admin/owner)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.nexora_update_group_settings(
  p_conversation_id uuid,
  p_title text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_avatar_url text DEFAULT NULL,
  p_can_write boolean DEFAULT NULL,
  p_can_send_files boolean DEFAULT NULL,
  p_can_send_media boolean DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация.' USING errcode = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.conversations
    WHERE id = p_conversation_id AND type = 'group'
  ) THEN
    RAISE EXCEPTION 'Группа не найдена.' USING errcode = 'P0002';
  END IF;

  SELECT cm.role INTO v_role
  FROM public.conversation_members cm
  WHERE cm.conversation_id = p_conversation_id
    AND cm.user_id = v_user_id;

  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Только администраторы могут менять настройки группы.'
      USING errcode = '42501';
  END IF;

  UPDATE public.conversations
  SET
    title           = COALESCE(NULLIF(btrim(p_title), ''), title),
    description     = COALESCE(p_description, description),
    avatar_url      = COALESCE(p_avatar_url, avatar_url),
    can_write       = COALESCE(p_can_write, can_write),
    can_send_files  = COALESCE(p_can_send_files, can_send_files),
    can_send_media  = COALESCE(p_can_send_media, can_send_media)
  WHERE id = p_conversation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.nexora_update_group_settings(uuid, text, text, text, boolean, boolean, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nexora_update_group_settings(uuid, text, text, text, boolean, boolean, boolean)
  TO authenticated;

-- ============================================================================
-- 5. RPC: получить настройки группы с участниками
-- ============================================================================

CREATE OR REPLACE FUNCTION public.nexora_get_group_info(p_conversation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
  v_conversation jsonb;
  v_members jsonb;
  v_creator jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация.' USING errcode = '28000';
  END IF;

  IF NOT public.nexora_is_conversation_member(p_conversation_id) THEN
    RAISE EXCEPTION 'Доступ запрещён.' USING errcode = '42501';
  END IF;

  SELECT jsonb_build_object(
    'id', c.id,
    'title', c.title,
    'description', c.description,
    'avatarUrl', c.avatar_url,
    'createdAt', c.created_at,
    'createdBy', c.created_by,
    'canWrite', c.can_write,
    'canSendFiles', c.can_send_files,
    'canSendMedia', c.can_send_media
  )
  INTO v_conversation
  FROM public.conversations c
  WHERE c.id = p_conversation_id AND c.type = 'group';

  IF v_conversation IS NULL THEN
    RAISE EXCEPTION 'Группа не найдена.' USING errcode = 'P0002';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'userId', cm.user_id,
    'role', cm.role,
    'joinedAt', cm.joined_at,
    'name', p.name,
    'username', p.username,
    'avatarUrl', CASE
      WHEN p.privacy_avatar = 'everyone'
        OR (p.privacy_avatar = 'contacts' AND EXISTS (
          SELECT 1 FROM public.contacts c2
          WHERE c2.owner_id = p.id AND c2.contact_user_id = auth.uid()
        ))
      THEN p.avatar_url ELSE NULL
    END,
    'status', CASE
      WHEN p.privacy_last_seen = 'everyone'
        OR (p.privacy_last_seen = 'contacts' AND EXISTS (
          SELECT 1 FROM public.contacts c2
          WHERE c2.owner_id = p.id AND c2.contact_user_id = auth.uid()
        ))
      THEN p.status ELSE 'offline'
    END,
    'lastSeen', CASE
      WHEN p.privacy_last_seen = 'everyone'
        OR (p.privacy_last_seen = 'contacts' AND EXISTS (
          SELECT 1 FROM public.contacts c2
          WHERE c2.owner_id = p.id AND c2.contact_user_id = auth.uid()
        ))
      THEN p.last_seen ELSE NULL
    END
  ) ORDER BY cm.role ASC, p.name ASC)
  INTO v_members
  FROM public.conversation_members cm
  JOIN public.profiles p ON p.id = cm.user_id
  WHERE cm.conversation_id = p_conversation_id;

  SELECT jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'username', p.username,
    'avatarUrl', CASE
      WHEN p.privacy_avatar = 'everyone'
        OR (p.privacy_avatar = 'contacts' AND EXISTS (
          SELECT 1 FROM public.contacts c2
          WHERE c2.owner_id = p.id AND c2.contact_user_id = auth.uid()
        ))
      THEN p.avatar_url ELSE NULL
    END
  )
  INTO v_creator
  FROM public.conversations c
  JOIN public.profiles p ON p.id = c.created_by
  WHERE c.id = p_conversation_id;

  v_result := jsonb_build_object(
    'conversation', v_conversation,
    'members', COALESCE(v_members, '[]'::jsonb),
    'creator', v_creator
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.nexora_get_group_info(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nexora_get_group_info(uuid)
  TO authenticated;

-- ============================================================================
-- 6. RPC: получить настройки пользователя
-- ============================================================================

CREATE OR REPLACE FUNCTION public.nexora_get_user_settings()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'soundEnabled', us.sound_enabled,
    'pushEnabled', us.push_enabled,
    'messageNotifications', us.message_notifications,
    'callNotifications', us.call_notifications,
    'groupNotifications', us.group_notifications,
    'showPreview', true
  )
  FROM public.user_settings us
  WHERE us.user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.nexora_get_user_settings()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nexora_get_user_settings()
  TO authenticated;

-- ============================================================================
-- 7. RPC: обновить настройки пользователя
-- ============================================================================

CREATE OR REPLACE FUNCTION public.nexora_update_user_settings(
  p_sound_enabled boolean DEFAULT NULL,
  p_push_enabled boolean DEFAULT NULL,
  p_message_notifications boolean DEFAULT NULL,
  p_call_notifications boolean DEFAULT NULL,
  p_group_notifications boolean DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация.' USING errcode = '28000';
  END IF;

  INSERT INTO public.user_settings (
    user_id, sound_enabled, push_enabled,
    message_notifications, call_notifications, group_notifications
  )
  VALUES (
    v_user_id,
    COALESCE(p_sound_enabled, true),
    COALESCE(p_push_enabled, false),
    COALESCE(p_message_notifications, true),
    COALESCE(p_call_notifications, true),
    COALESCE(p_group_notifications, true)
  )
  ON CONFLICT (user_id) DO UPDATE SET
    sound_enabled         = COALESCE(p_sound_enabled, user_settings.sound_enabled),
    push_enabled          = COALESCE(p_push_enabled, user_settings.push_enabled),
    message_notifications = COALESCE(p_message_notifications, user_settings.message_notifications),
    call_notifications    = COALESCE(p_call_notifications, user_settings.call_notifications),
    group_notifications   = COALESCE(p_group_notifications, user_settings.group_notifications);
END;
$$;

REVOKE ALL ON FUNCTION public.nexora_update_user_settings(boolean, boolean, boolean, boolean, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nexora_update_user_settings(boolean, boolean, boolean, boolean, boolean)
  TO authenticated;

-- ============================================================================
-- 8. RPC: загрузить уведомления
-- ============================================================================

CREATE OR REPLACE FUNCTION public.nexora_get_notifications(
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  kind text,
  title text,
  body text,
  payload jsonb,
  is_read boolean,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT n.id, n.kind, n.title, n.body, n.payload, n.is_read, n.created_at
  FROM public.notifications n
  WHERE n.user_id = auth.uid()
  ORDER BY n.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
$$;

REVOKE ALL ON FUNCTION public.nexora_get_notifications(integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nexora_get_notifications(integer)
  TO authenticated;

-- ============================================================================
-- 9. RPC: отметить уведомление прочитанным
-- ============================================================================

CREATE OR REPLACE FUNCTION public.nexora_mark_notification_read(
  p_notification_id uuid
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.notifications
  SET is_read = true
  WHERE id = p_notification_id AND user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.nexora_mark_notification_read(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nexora_mark_notification_read(uuid)
  TO authenticated;

-- ============================================================================
-- 10. RPC: отметить все уведомления прочитанными
-- ============================================================================

CREATE OR REPLACE FUNCTION public.nexora_mark_all_notifications_read()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.notifications
  SET is_read = true
  WHERE user_id = auth.uid() AND is_read = false;
$$;

REVOKE ALL ON FUNCTION public.nexora_mark_all_notifications_read()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nexora_mark_all_notifications_read()
  TO authenticated;

-- ============================================================================
-- 11. RPC: удалить уведомление
-- ============================================================================

CREATE OR REPLACE FUNCTION public.nexora_delete_notification(
  p_notification_id uuid
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  DELETE FROM public.notifications
  WHERE id = p_notification_id AND user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.nexora_delete_notification(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nexora_delete_notification(uuid)
  TO authenticated;

-- ============================================================================
-- 12. RPC: счётчик непрочитанных уведомлений
-- ============================================================================

CREATE OR REPLACE FUNCTION public.nexora_unread_notification_count()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT count(*)::bigint
  FROM public.notifications
  WHERE user_id = auth.uid() AND is_read = false;
$$;

REVOKE ALL ON FUNCTION public.nexora_unread_notification_count()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nexora_unread_notification_count()
  TO authenticated;

-- ============================================================================
-- 13. Обновлённый nexora_create_direct_conversation
-- с initial conversation_user_settings
-- ============================================================================

CREATE OR REPLACE FUNCTION public.nexora_create_direct_conversation(p_other_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_conversation_id uuid;
  v_existing_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация.' USING errcode = '28000';
  END IF;
  IF p_other_user_id IS NULL OR p_other_user_id = v_user_id THEN
    RAISE EXCEPTION 'Выберите другого пользователя.' USING errcode = '22023';
  END IF;

  SELECT c.id INTO v_existing_id
  FROM public.conversations c
  WHERE c.type = 'direct'
    AND EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = c.id AND cm.user_id = v_user_id
    )
    AND EXISTS (
      SELECT 1 FROM public.conversation_members cm
      WHERE cm.conversation_id = c.id AND cm.user_id = p_other_user_id
    )
    AND (SELECT count(*) FROM public.conversation_members cm WHERE cm.conversation_id = c.id) = 2
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  INSERT INTO public.conversations (type, created_by)
  VALUES ('direct', v_user_id)
  RETURNING id INTO v_conversation_id;

  INSERT INTO public.conversation_members (conversation_id, user_id, role)
  VALUES
    (v_conversation_id, v_user_id, 'owner'),
    (v_conversation_id, p_other_user_id, 'member');

  RETURN v_conversation_id;
END;
$$;

-- ============================================================================
-- 14. Обновлённый load_conversations с настройками пользователя
-- ============================================================================

CREATE OR REPLACE FUNCTION public.nexora_load_conversation_settings(
  p_conversation_ids uuid[]
)
RETURNS TABLE (
  conversation_id uuid,
  is_pinned boolean,
  is_archived boolean,
  muted_until timestamptz,
  last_read_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    cus.conversation_id,
    cus.is_pinned,
    cus.is_archived,
    cus.muted_until,
    cus.last_read_at
  FROM public.conversation_user_settings cus
  WHERE cus.user_id = auth.uid()
    AND cus.conversation_id = ANY(COALESCE(p_conversation_ids, ARRAY[]::uuid[]));
$$;

REVOKE ALL ON FUNCTION public.nexora_load_conversation_settings(uuid[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nexora_load_conversation_settings(uuid[])
  TO authenticated;

-- ============================================================================
-- 15. Расширенный nexora_get_profiles для профилей пользователей
-- ============================================================================

CREATE OR REPLACE FUNCTION public.nexora_get_user_profile(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'username', p.username,
    'bio', p.bio,
    'status', CASE
      WHEN p.privacy_last_seen = 'everyone'
        OR (p.privacy_last_seen = 'contacts' AND EXISTS (
          SELECT 1 FROM public.contacts c2
          WHERE c2.owner_id = p.id AND c2.contact_user_id = auth.uid()
        ))
      THEN p.status ELSE 'offline'
    END,
    'lastSeen', CASE
      WHEN p.privacy_last_seen = 'everyone'
        OR (p.privacy_last_seen = 'contacts' AND EXISTS (
          SELECT 1 FROM public.contacts c2
          WHERE c2.owner_id = p.id AND c2.contact_user_id = auth.uid()
        ))
      THEN p.last_seen ELSE NULL
    END,
    'avatarUrl', CASE
      WHEN p.privacy_avatar = 'everyone'
        OR (p.privacy_avatar = 'contacts' AND EXISTS (
          SELECT 1 FROM public.contacts c2
          WHERE c2.owner_id = p.id AND c2.contact_user_id = auth.uid()
        ))
      THEN p.avatar_url ELSE NULL
    END,
    'phone', CASE
      WHEN p.privacy_phone = 'everyone'
        OR (p.privacy_phone = 'contacts' AND EXISTS (
          SELECT 1 FROM public.contacts c2
          WHERE c2.owner_id = p.id AND c2.contact_user_id = auth.uid()
        ))
      THEN p.phone ELSE NULL
    END,
    'createdAt', p.created_at,
    'isContact', EXISTS (
      SELECT 1 FROM public.contacts ct
      WHERE ct.owner_id = auth.uid() AND ct.contact_user_id = p.id
    ),
    'isBlocked', EXISTS (
      SELECT 1 FROM public.user_blocks b
      WHERE b.blocker_id = auth.uid() AND b.blocked_id = p.id
    )
  )
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.id = p_user_id
    AND auth.uid() IS NOT NULL
    AND p.id <> auth.uid()
    AND u.email_confirmed_at IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.nexora_get_user_profile(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nexora_get_user_profile(uuid)
  TO authenticated;

-- ============================================================================
-- 16. Уведомления при добавлении в группу
-- ============================================================================

CREATE OR REPLACE FUNCTION public.nexora_notify_group_added()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_conv_title text;
  v_actor_name text;
BEGIN
  IF NEW.role = 'owner' THEN
    RETURN NEW;
  END IF;

  SELECT c.title INTO v_conv_title
  FROM public.conversations c WHERE c.id = NEW.conversation_id;

  SELECT p.name INTO v_actor_name
  FROM public.conversation_members cm
  JOIN public.profiles p ON p.id = cm.user_id
  WHERE cm.conversation_id = NEW.conversation_id AND cm.role = 'owner'
  LIMIT 1;

  INSERT INTO public.notifications (user_id, kind, title, body, payload)
  VALUES (
    NEW.user_id,
    'group',
    'Добавление в группу',
    'Вы добавлены в группу ' || COALESCE(v_conv_title, ''),
    jsonb_build_object('conversationId', NEW.conversation_id)
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.nexora_notify_group_added()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS nexora_notify_group_added ON public.conversation_members;
CREATE TRIGGER nexora_notify_group_added
  AFTER INSERT ON public.conversation_members
  FOR EACH ROW
  WHEN (NEW.role <> 'owner')
  EXECUTE FUNCTION public.nexora_notify_group_added();

-- ============================================================================
-- 17. Очистка истории чата
-- ============================================================================

CREATE OR REPLACE FUNCTION public.nexora_clear_conversation_history(
  p_conversation_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация.' USING errcode = '28000';
  END IF;

  IF NOT public.nexora_is_conversation_member(p_conversation_id) THEN
    RAISE EXCEPTION 'Доступ запрещён.' USING errcode = '42501';
  END IF;

  UPDATE public.messages
  SET deleted_at = COALESCE(deleted_at, now())
  WHERE conversation_id = p_conversation_id
    AND sender_id = auth.uid()
    AND deleted_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.nexora_clear_conversation_history(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nexora_clear_conversation_history(uuid)
  TO authenticated;

-- ============================================================================
-- 18. Индексы
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_conv_user_settings_user
  ON public.conversation_user_settings(user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications(user_id, is_read, created_at DESC);

COMMIT;
