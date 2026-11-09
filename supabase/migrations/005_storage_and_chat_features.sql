
-- NEXORA 005: Storage, messages, groups, privacy and chat features
-- Требует успешно применённые миграции 001–004.
-- Идемпотентная миграция: не удаляет пользовательские сообщения,
-- профили, чаты и другие пользовательские данные.

BEGIN;

-- ============================================================================
-- 0. Новые колонки
-- ============================================================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS forward_of uuid
  REFERENCES public.messages(id) ON DELETE SET NULL;

-- ============================================================================
-- 1. Реакции
-- ============================================================================

CREATE OR REPLACE FUNCTION public.nexora_add_reaction(
  p_message_id uuid,
  p_emoji text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_conversation_id uuid;
  v_reaction_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация.' USING errcode = '28000';
  END IF;

  IF p_message_id IS NULL
     OR p_emoji IS NULL
     OR btrim(p_emoji) = ''
     OR length(p_emoji) > 20 THEN
    RAISE EXCEPTION 'Некорректная реакция.' USING errcode = '22023';
  END IF;

  SELECT m.conversation_id
  INTO v_conversation_id
  FROM public.messages m
  WHERE m.id = p_message_id
    AND m.deleted_at IS NULL
    AND m.message_type <> 'system';

  IF v_conversation_id IS NULL THEN
    RAISE EXCEPTION 'Сообщение не найдено.' USING errcode = 'P0002';
  END IF;

  IF NOT public.nexora_is_conversation_member(v_conversation_id) THEN
    RAISE EXCEPTION 'Доступ запрещён.' USING errcode = '42501';
  END IF;

  INSERT INTO public.message_reactions (message_id, user_id, emoji)
  VALUES (p_message_id, v_user_id, p_emoji)
  ON CONFLICT (message_id, user_id, emoji)
  DO UPDATE SET created_at = now()
  RETURNING id INTO v_reaction_id;

  RETURN v_reaction_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.nexora_remove_reaction(
  p_message_id uuid,
  p_emoji text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_conversation_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация.' USING errcode = '28000';
  END IF;

  SELECT m.conversation_id
  INTO v_conversation_id
  FROM public.messages m
  WHERE m.id = p_message_id;

  IF v_conversation_id IS NULL THEN
    RAISE EXCEPTION 'Сообщение не найдено.' USING errcode = 'P0002';
  END IF;

  IF NOT public.nexora_is_conversation_member(v_conversation_id) THEN
    RAISE EXCEPTION 'Доступ запрещён.' USING errcode = '42501';
  END IF;

  DELETE FROM public.message_reactions
  WHERE message_id = p_message_id
    AND user_id = auth.uid()
    AND emoji = p_emoji;
END;
$$;

CREATE OR REPLACE FUNCTION public.nexora_get_message_reactions(
  p_message_id uuid
)
RETURNS TABLE (
  emoji text,
  count bigint,
  user_ids uuid[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_conversation_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация.' USING errcode = '28000';
  END IF;

  SELECT m.conversation_id
  INTO v_conversation_id
  FROM public.messages m
  WHERE m.id = p_message_id;

  IF v_conversation_id IS NULL THEN
    RAISE EXCEPTION 'Сообщение не найдено.' USING errcode = 'P0002';
  END IF;

  IF NOT public.nexora_is_conversation_member(v_conversation_id) THEN
    RAISE EXCEPTION 'Доступ запрещён.' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT
    mr.emoji,
    count(*)::bigint,
    array_agg(mr.user_id ORDER BY mr.created_at)
  FROM public.message_reactions mr
  WHERE mr.message_id = p_message_id
  GROUP BY mr.emoji
  ORDER BY count(*) DESC;
END;
$$;

-- ============================================================================
-- 2. Редактирование и удаление сообщений
-- ============================================================================

CREATE OR REPLACE FUNCTION public.nexora_edit_message(
  p_message_id uuid,
  p_new_content text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_conversation_id uuid;
  v_updated_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация.' USING errcode = '28000';
  END IF;

  IF p_new_content IS NULL OR btrim(p_new_content) = '' THEN
    RAISE EXCEPTION 'Содержимое не может быть пустым.' USING errcode = '22023';
  END IF;

  IF length(p_new_content) > 10000 THEN
    RAISE EXCEPTION 'Максимум 10000 символов.' USING errcode = '22001';
  END IF;

  SELECT m.conversation_id
  INTO v_conversation_id
  FROM public.messages m
  WHERE m.id = p_message_id;

  IF v_conversation_id IS NULL THEN
    RAISE EXCEPTION 'Сообщение не найдено.' USING errcode = 'P0002';
  END IF;

  IF NOT public.nexora_is_conversation_member(v_conversation_id) THEN
    RAISE EXCEPTION 'Доступ запрещён.' USING errcode = '42501';
  END IF;

  UPDATE public.messages
  SET content = p_new_content,
      edited_at = now()
  WHERE id = p_message_id
    AND sender_id = auth.uid()
    AND deleted_at IS NULL
    AND message_type <> 'system'
  RETURNING id INTO v_updated_id;

  IF v_updated_id IS NULL THEN
    RAISE EXCEPTION 'Нельзя изменить это сообщение.' USING errcode = '42501';
  END IF;

  RETURN v_updated_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.nexora_delete_message(
  p_message_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_conversation_id uuid;
  v_deleted_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация.' USING errcode = '28000';
  END IF;

  SELECT m.conversation_id
  INTO v_conversation_id
  FROM public.messages m
  WHERE m.id = p_message_id;

  IF v_conversation_id IS NULL THEN
    RAISE EXCEPTION 'Сообщение не найдено.' USING errcode = 'P0002';
  END IF;

  IF NOT public.nexora_is_conversation_member(v_conversation_id) THEN
    RAISE EXCEPTION 'Доступ запрещён.' USING errcode = '42501';
  END IF;

  UPDATE public.messages
  SET deleted_at = COALESCE(deleted_at, now())
  WHERE id = p_message_id
    AND sender_id = auth.uid()
    AND message_type <> 'system'
  RETURNING id INTO v_deleted_id;

  IF v_deleted_id IS NULL THEN
    RAISE EXCEPTION 'Нельзя удалить это сообщение.' USING errcode = '42501';
  END IF;

  RETURN v_deleted_id;
END;
$$;

-- ============================================================================
-- 3. Ответы и пересылка
-- ============================================================================

CREATE OR REPLACE FUNCTION public.nexora_reply_to_message(
  p_message_id uuid,
  p_content text,
  p_conversation_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_source_conv_id uuid;
  v_new_message_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация.' USING errcode = '28000';
  END IF;

  IF p_content IS NULL OR btrim(p_content) = ''
     OR length(p_content) > 10000 THEN
    RAISE EXCEPTION 'Некорректный текст ответа.' USING errcode = '22023';
  END IF;

  IF p_message_id IS NULL OR p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'Не указано сообщение или чат.' USING errcode = '22023';
  END IF;

  SELECT m.conversation_id
  INTO v_source_conv_id
  FROM public.messages m
  WHERE m.id = p_message_id
    AND m.deleted_at IS NULL
    AND m.message_type <> 'system';

  IF v_source_conv_id IS NULL THEN
    RAISE EXCEPTION 'Исходное сообщение недоступно.' USING errcode = 'P0002';
  END IF;

  IF v_source_conv_id <> p_conversation_id THEN
    RAISE EXCEPTION 'Ответ возможен только в исходном чате.' USING errcode = '42501';
  END IF;

  IF NOT public.nexora_is_conversation_member(v_source_conv_id) THEN
    RAISE EXCEPTION 'Доступ запрещён.' USING errcode = '42501';
  END IF;

  INSERT INTO public.messages (
    conversation_id, sender_id, content, reply_to
  )
  VALUES (
    p_conversation_id, v_user_id, p_content, p_message_id
  )
  RETURNING id INTO v_new_message_id;

  RETURN v_new_message_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.nexora_forward_message(
  p_message_id uuid,
  p_target_conversation_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_source_conv_id uuid;
  v_original_content text;
  v_new_message_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация.' USING errcode = '28000';
  END IF;

  IF p_message_id IS NULL OR p_target_conversation_id IS NULL THEN
    RAISE EXCEPTION 'Не указано сообщение или чат.' USING errcode = '22023';
  END IF;

  SELECT m.conversation_id, m.content
  INTO v_source_conv_id, v_original_content
  FROM public.messages m
  WHERE m.id = p_message_id
    AND m.deleted_at IS NULL
    AND m.message_type <> 'system';

  IF v_source_conv_id IS NULL OR v_original_content IS NULL THEN
    RAISE EXCEPTION 'Сообщение нельзя переслать.' USING errcode = 'P0002';
  END IF;

  IF length(v_original_content) > 10000 THEN
    RAISE EXCEPTION 'Сообщение слишком длинное.' USING errcode = '22001';
  END IF;

  IF NOT public.nexora_is_conversation_member(v_source_conv_id)
     OR NOT public.nexora_is_conversation_member(p_target_conversation_id) THEN
    RAISE EXCEPTION 'Доступ к чату запрещён.' USING errcode = '42501';
  END IF;

  INSERT INTO public.messages (
    conversation_id, sender_id, content, forward_of
  )
  VALUES (
    p_target_conversation_id, v_user_id, v_original_content, p_message_id
  )
  RETURNING id INTO v_new_message_id;

  RETURN v_new_message_id;
END;
$$;

-- ============================================================================
-- 4. Поиск сообщений
-- ============================================================================

CREATE OR REPLACE FUNCTION public.nexora_search_messages(
  p_conversation_id uuid,
  p_search text DEFAULT '',
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  content text,
  message_type text,
  created_at timestamptz,
  edited_at timestamptz,
  deleted_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    m.id,
    m.conversation_id,
    m.sender_id,
    m.content,
    m.message_type,
    m.created_at,
    m.edited_at,
    m.deleted_at
  FROM public.messages m
  WHERE auth.uid() IS NOT NULL
    AND p_conversation_id IS NOT NULL
    AND m.conversation_id = p_conversation_id
    AND public.nexora_is_conversation_member(p_conversation_id)
    AND m.deleted_at IS NULL
    AND (
      NULLIF(btrim(p_search), '') IS NULL
      OR m.content ILIKE '%' || left(btrim(p_search), 150) || '%'
    )
  ORDER BY m.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
$$;

-- ============================================================================
-- 5. Индикаторы набора текста
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.typing_indicators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL
    REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL
    REFERENCES public.profiles(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, user_id)
);

ALTER TABLE public.typing_indicators ENABLE ROW LEVEL SECURITY;

-- Удаляем только политики NEXORA с известными именами.
DROP POLICY IF EXISTS typing_indicators_select_member
  ON public.typing_indicators;
DROP POLICY IF EXISTS typing_indicators_manage_own
  ON public.typing_indicators;
DROP POLICY IF EXISTS nexora_typing_select_member
  ON public.typing_indicators;
DROP POLICY IF EXISTS nexora_typing_insert_own_member
  ON public.typing_indicators;
DROP POLICY IF EXISTS nexora_typing_delete_own
  ON public.typing_indicators;
DROP POLICY IF EXISTS nexora_typing_update_own_member
  ON public.typing_indicators;

CREATE POLICY nexora_typing_select_member
ON public.typing_indicators
FOR SELECT TO authenticated
USING (
  public.nexora_is_conversation_member(conversation_id)
);

CREATE POLICY nexora_typing_insert_own_member
ON public.typing_indicators
FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND public.nexora_is_conversation_member(conversation_id)
);

CREATE POLICY nexora_typing_update_own_member
ON public.typing_indicators
FOR UPDATE TO authenticated
USING (
  user_id = auth.uid()
  AND public.nexora_is_conversation_member(conversation_id)
)
WITH CHECK (
  user_id = auth.uid()
  AND public.nexora_is_conversation_member(conversation_id)
);

CREATE POLICY nexora_typing_delete_own
ON public.typing_indicators
FOR DELETE TO authenticated
USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.typing_indicators TO authenticated;

-- ============================================================================
-- 6. Приватное хранилище файлов
-- ============================================================================

-- Создаём приватный bucket, если его ещё нет.
INSERT INTO storage.buckets (id, name, public)
VALUES ('nexora-media', 'nexora-media', false)
ON CONFLICT (id) DO NOTHING;

-- Если bucket уже существовал как публичный, делаем его приватным.
UPDATE storage.buckets
SET public = false
WHERE id = 'nexora-media';

-- Доступ к объекту разрешён:
-- 1. Владельцу собственной папки.
-- 2. Участнику чата, если объект зарегистрирован в message_attachments
--    и storage_path точно совпадает с именем объекта.

CREATE OR REPLACE FUNCTION public.nexora_storage_can_read(
  p_bucket_id text,
  p_name text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND p_bucket_id = 'nexora-media'
    AND p_name IS NOT NULL
    AND (
      (storage.foldername(p_name))[1] = auth.uid()::text
      OR EXISTS (
        SELECT 1
        FROM public.message_attachments ma
        JOIN public.messages m
          ON m.id = ma.message_id
        JOIN public.conversation_members cm
          ON cm.conversation_id = m.conversation_id
        WHERE ma.storage_path = p_name
          AND cm.user_id = auth.uid()
          AND m.deleted_at IS NULL
          AND m.message_type <> 'system'
          AND (storage.foldername(p_name))[1] = m.sender_id::text
      )
    );
$$;

-- Удаляем старые политики с именами миграции 005,
-- чтобы старая широкая SELECT-политика не осталась активной.
DROP POLICY IF EXISTS nexora_storage_insert_own
  ON storage.objects;
DROP POLICY IF EXISTS nexora_storage_select_chat
  ON storage.objects;
DROP POLICY IF EXISTS nexora_storage_update_own
  ON storage.objects;
DROP POLICY IF EXISTS nexora_storage_delete_own
  ON storage.objects;

CREATE POLICY nexora_storage_insert_own
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'nexora-media'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY nexora_storage_select_chat
ON storage.objects
FOR SELECT TO authenticated
USING (
  public.nexora_storage_can_read(bucket_id, name)
);

CREATE POLICY nexora_storage_update_own
ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'nexora-media'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'nexora-media'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY nexora_storage_delete_own
ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'nexora-media'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- ============================================================================
-- 7. Групповые чаты
-- ============================================================================

CREATE OR REPLACE FUNCTION public.nexora_create_group_conversation(
  p_title text,
  p_member_ids uuid[],
  p_avatar_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_conversation_id uuid;
  v_member_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация.' USING errcode = '28000';
  END IF;

  IF p_title IS NULL OR btrim(p_title) = ''
     OR length(p_title) > 100 THEN
    RAISE EXCEPTION 'Название группы должно содержать до 100 символов.'
      USING errcode = '22023';
  END IF;

  v_member_count := COALESCE(cardinality(p_member_ids), 0);

  IF v_member_count > 99 THEN
    RAISE EXCEPTION 'В группе может быть не более 100 участников.'
      USING errcode = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_member_ids, ARRAY[]::uuid[])) AS x(uid)
    WHERE x.uid IS NULL
  ) THEN
    RAISE EXCEPTION 'Некорректный список участников.'
      USING errcode = '22023';
  END IF;

  INSERT INTO public.conversations (
    type, title, avatar_url, created_by
  )
  VALUES (
    'group', btrim(p_title), p_avatar_url, v_user_id
  )
  RETURNING id INTO v_conversation_id;

  INSERT INTO public.conversation_members (
    conversation_id, user_id, role
  )
  VALUES (
    v_conversation_id, v_user_id, 'owner'
  );

  INSERT INTO public.conversation_members (
    conversation_id, user_id, role
  )
  SELECT
    v_conversation_id, x.uid, 'member'
  FROM (
    SELECT DISTINCT uid
    FROM unnest(COALESCE(p_member_ids, ARRAY[]::uuid[])) AS t(uid)
    WHERE uid IS NOT NULL
      AND uid <> v_user_id
  ) x
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  RETURN v_conversation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.nexora_add_group_members(
  p_conversation_id uuid,
  p_user_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_current_count integer;
  v_new_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация.' USING errcode = '28000';
  END IF;

  IF p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'Не указана группа.' USING errcode = '22023';
  END IF;

  IF COALESCE(cardinality(p_user_ids), 0) > 100 THEN
    RAISE EXCEPTION 'Слишком много участников.' USING errcode = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = p_conversation_id
      AND c.type = 'group'
  ) THEN
    RAISE EXCEPTION 'Группа не найдена.' USING errcode = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.conversation_members cm
    WHERE cm.conversation_id = p_conversation_id
      AND cm.user_id = v_user_id
      AND cm.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Недостаточно прав.' USING errcode = '42501';
  END IF;

  SELECT count(*)::integer
  INTO v_current_count
  FROM public.conversation_members
  WHERE conversation_id = p_conversation_id;

  SELECT count(DISTINCT x.uid)::integer
  INTO v_new_count
  FROM unnest(COALESCE(p_user_ids, ARRAY[]::uuid[])) AS x(uid)
  WHERE x.uid IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.conversation_members cm
      WHERE cm.conversation_id = p_conversation_id
        AND cm.user_id = x.uid
    );

  IF v_current_count + v_new_count > 100 THEN
    RAISE EXCEPTION 'В группе может быть не более 100 участников.'
      USING errcode = '22023';
  END IF;

  INSERT INTO public.conversation_members (
    conversation_id, user_id, role
  )
  SELECT DISTINCT p_conversation_id, x.uid, 'member'
  FROM unnest(COALESCE(p_user_ids, ARRAY[]::uuid[])) AS x(uid)
  WHERE x.uid IS NOT NULL
  ON CONFLICT (conversation_id, user_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.nexora_remove_group_member(
  p_conversation_id uuid,
  p_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_actor_role text;
  v_target_role text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация.' USING errcode = '28000';
  END IF;

  IF p_user_id IS NULL OR p_user_id = v_user_id THEN
    RAISE EXCEPTION 'Некорректный участник.' USING errcode = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.conversations
    WHERE id = p_conversation_id AND type = 'group'
  ) THEN
    RAISE EXCEPTION 'Группа не найдена.' USING errcode = 'P0002';
  END IF;

  SELECT role INTO v_actor_role
  FROM public.conversation_members
  WHERE conversation_id = p_conversation_id
    AND user_id = v_user_id;

  SELECT role INTO v_target_role
  FROM public.conversation_members
  WHERE conversation_id = p_conversation_id
    AND user_id = p_user_id;

  IF v_actor_role IS NULL OR v_target_role IS NULL THEN
    RAISE EXCEPTION 'Участник не найден.' USING errcode = 'P0002';
  END IF;

  IF v_actor_role = 'owner' THEN
    DELETE FROM public.conversation_members
    WHERE conversation_id = p_conversation_id
      AND user_id = p_user_id;
  ELSIF v_actor_role = 'admin' AND v_target_role = 'member' THEN
    DELETE FROM public.conversation_members
    WHERE conversation_id = p_conversation_id
      AND user_id = p_user_id;
  ELSE
    RAISE EXCEPTION 'Недостаточно прав для удаления участника.'
      USING errcode = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.nexora_leave_group(
  p_conversation_id uuid
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

  IF NOT EXISTS (
    SELECT 1
    FROM public.conversations
    WHERE id = p_conversation_id AND type = 'group'
  ) THEN
    RAISE EXCEPTION 'Группа не найдена.' USING errcode = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.conversation_members
    WHERE conversation_id = p_conversation_id
      AND user_id = v_user_id
      AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Передайте владение группой перед выходом.'
      USING errcode = '42501';
  END IF;

  DELETE FROM public.conversation_members
  WHERE conversation_id = p_conversation_id
    AND user_id = v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.nexora_promote_member(
  p_conversation_id uuid,
  p_user_id uuid,
  p_new_role text
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

  IF p_new_role IS NULL
     OR p_new_role NOT IN ('owner', 'admin', 'member') THEN
    RAISE EXCEPTION 'Недопустимая роль.' USING errcode = '22023';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Не указан участник.' USING errcode = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.conversations
    WHERE id = p_conversation_id AND type = 'group'
  ) THEN
    RAISE EXCEPTION 'Группа не найдена.' USING errcode = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.conversation_members
    WHERE conversation_id = p_conversation_id
      AND user_id = v_user_id
      AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Только владелец может менять роли.'
      USING errcode = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.conversation_members
    WHERE conversation_id = p_conversation_id
      AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Участник не найден.' USING errcode = 'P0002';
  END IF;

  IF p_user_id = v_user_id AND p_new_role <> 'owner' THEN
    RAISE EXCEPTION 'Нельзя лишить себя владения без передачи другому участнику.'
      USING errcode = '42501';
  END IF;

  IF p_new_role = 'owner' AND p_user_id <> v_user_id THEN
    UPDATE public.conversation_members
    SET role = 'member'
    WHERE conversation_id = p_conversation_id
      AND user_id = v_user_id;

    UPDATE public.conversation_members
    SET role = 'owner'
    WHERE conversation_id = p_conversation_id
      AND user_id = p_user_id;
  ELSE
    UPDATE public.conversation_members
    SET role = p_new_role
    WHERE conversation_id = p_conversation_id
      AND user_id = p_user_id;
  END IF;
END;
$$;

-- ============================================================================
-- 8. Блокировка пользователей
-- ============================================================================

CREATE OR REPLACE FUNCTION public.nexora_block_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация.' USING errcode = '28000';
  END IF;

  IF p_user_id IS NULL OR p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Нельзя заблокировать себя.' USING errcode = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Пользователь не найден.' USING errcode = 'P0002';
  END IF;

  INSERT INTO public.user_blocks (blocker_id, blocked_id)
  VALUES (auth.uid(), p_user_id)
  ON CONFLICT (blocker_id, blocked_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.nexora_unblock_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация.' USING errcode = '28000';
  END IF;

  DELETE FROM public.user_blocks
  WHERE blocker_id = auth.uid()
    AND blocked_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.nexora_get_blocked_users()
RETURNS TABLE (
  id uuid,
  name text,
  username text,
  avatar_url text,
  bio text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    ub.blocked_id,
    p.name,
    p.username,
    CASE
      WHEN p.privacy_avatar = 'everyone'
        OR (
          p.privacy_avatar = 'contacts'
          AND EXISTS (
            SELECT 1
            FROM public.contacts c
            WHERE c.owner_id = p.id
              AND c.contact_user_id = auth.uid()
          )
        )
      THEN p.avatar_url
      ELSE NULL
    END,
    p.bio
  FROM public.user_blocks ub
  JOIN public.profiles p ON p.id = ub.blocked_id
  WHERE ub.blocker_id = auth.uid()
  ORDER BY p.name;
$$;

-- ============================================================================
-- 9. Контакты
-- ============================================================================

CREATE OR REPLACE FUNCTION public.nexora_add_contact(
  p_contact_user_id uuid
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

  IF p_contact_user_id IS NULL
     OR p_contact_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Некорректный пользователь.' USING errcode = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.user_blocks b
    WHERE (b.blocker_id = auth.uid() AND b.blocked_id = p_contact_user_id)
       OR (b.blocker_id = p_contact_user_id AND b.blocked_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Нельзя добавить заблокированного пользователя в контакты.'
      USING errcode = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_contact_user_id
  ) THEN
    RAISE EXCEPTION 'Пользователь не найден.' USING errcode = 'P0002';
  END IF;

  INSERT INTO public.contacts (owner_id, contact_user_id)
  VALUES (auth.uid(), p_contact_user_id)
  ON CONFLICT (owner_id, contact_user_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.nexora_remove_contact(
  p_contact_user_id uuid
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

  DELETE FROM public.contacts
  WHERE owner_id = auth.uid()
    AND contact_user_id = p_contact_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.nexora_get_contacts()
RETURNS TABLE (
  id uuid,
  name text,
  username text,
  avatar_url text,
  bio text,
  phone text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    ct.contact_user_id,
    p.name,
    p.username,
    CASE
      WHEN p.privacy_avatar = 'everyone'
        OR (
          p.privacy_avatar = 'contacts'
          AND EXISTS (
            SELECT 1
            FROM public.contacts c2
            WHERE c2.owner_id = p.id
              AND c2.contact_user_id = ct.owner_id
          )
        )
      THEN p.avatar_url
      ELSE NULL
    END,
    p.bio,
    CASE
      WHEN p.privacy_phone = 'everyone'
        OR (
          p.privacy_phone = 'contacts'
          AND EXISTS (
            SELECT 1
            FROM public.contacts c2
            WHERE c2.owner_id = p.id
              AND c2.contact_user_id = ct.owner_id
          )
        )
      THEN p.phone
      ELSE NULL
    END
  FROM public.contacts ct
  JOIN public.profiles p ON p.id = ct.contact_user_id
  WHERE ct.owner_id = auth.uid()
  ORDER BY p.name;
$$;

-- ============================================================================
-- 10. Статус пользователя
-- ============================================================================

CREATE OR REPLACE FUNCTION public.nexora_update_status(
  p_status text,
  p_last_seen timestamptz DEFAULT NULL
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

  IF p_status IS NULL OR p_status NOT IN ('online', 'offline') THEN
    RAISE EXCEPTION 'Недопустимый статус.' USING errcode = '22023';
  END IF;

  UPDATE public.profiles
  SET status = p_status,
      last_seen = LEAST(COALESCE(p_last_seen, now()), now())
  WHERE id = auth.uid();
END;
$$;

-- ============================================================================
-- 11. Поиск профилей
-- ============================================================================

CREATE OR REPLACE FUNCTION public.nexora_search_profiles(
  p_search text DEFAULT ''
)
RETURNS TABLE (
  id uuid,
  name text,
  username text,
  avatar_url text,
  bio text,
  status text,
  last_seen timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p.id,
    p.name,
    p.username,
    CASE
      WHEN p.privacy_avatar = 'everyone'
        OR (
          p.privacy_avatar = 'contacts'
          AND EXISTS (
            SELECT 1
            FROM public.contacts sc
            WHERE sc.owner_id = p.id
              AND sc.contact_user_id = auth.uid()
          )
        )
      THEN p.avatar_url
      ELSE NULL
    END,
    p.bio,
    CASE
      WHEN p.privacy_last_seen = 'everyone'
        OR (
          p.privacy_last_seen = 'contacts'
          AND EXISTS (
            SELECT 1
            FROM public.contacts sc
            WHERE sc.owner_id = p.id
              AND sc.contact_user_id = auth.uid()
          )
        )
      THEN p.status
      ELSE 'offline'
    END,
    CASE
      WHEN p.privacy_last_seen = 'everyone'
        OR (
          p.privacy_last_seen = 'contacts'
          AND EXISTS (
            SELECT 1
            FROM public.contacts sc
            WHERE sc.owner_id = p.id
              AND sc.contact_user_id = auth.uid()
          )
        )
      THEN p.last_seen
      ELSE NULL
    END
  FROM public.profiles p
  JOIN auth.users subject ON subject.id = p.id
  JOIN auth.users viewer ON viewer.id = auth.uid()
  WHERE auth.uid() IS NOT NULL
    AND viewer.email_confirmed_at IS NOT NULL
    AND subject.email_confirmed_at IS NOT NULL
    AND p.id <> auth.uid()
    AND NULLIF(btrim(p_search), '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_blocks b
      WHERE (b.blocker_id = auth.uid() AND b.blocked_id = p.id)
         OR (b.blocker_id = p.id AND b.blocked_id = auth.uid())
    )
    AND (
      p.name ILIKE '%' || left(btrim(p_search), 100) || '%'
      OR p.username ILIKE '%' || left(btrim(p_search), 100) || '%'
      OR (
        p.phone IS NOT NULL
        AND (
          p.privacy_phone = 'everyone'
          OR (
            p.privacy_phone = 'contacts'
            AND EXISTS (
              SELECT 1
              FROM public.contacts pc
              WHERE pc.owner_id = p.id
                AND pc.contact_user_id = auth.uid()
            )
          )
        )
        AND regexp_replace(p.phone, '[^0-9]', '', 'g')
          ILIKE '%' || regexp_replace(left(btrim(p_search), 100), '[^0-9]', '', 'g') || '%'
      )
    )
  ORDER BY p.name
  LIMIT 50;
$$;

-- ============================================================================
-- 12. Удаление старого RPC удаления аккаунта
-- ============================================================================
-- Удаление аккаунта выполняется серверной Edge Function delete-account.
-- Пользовательские данные здесь не удаляются.

DROP FUNCTION IF EXISTS public.nexora_delete_account();

-- ============================================================================
-- 13. Права доступа к RPC
-- ============================================================================

REVOKE ALL ON FUNCTION public.nexora_add_reaction(uuid, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nexora_remove_reaction(uuid, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nexora_get_message_reactions(uuid)
  FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.nexora_edit_message(uuid, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nexora_delete_message(uuid)
  FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.nexora_reply_to_message(uuid, text, uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nexora_forward_message(uuid, uuid)
  FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.nexora_search_messages(uuid, text, integer)
  FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.nexora_storage_can_read(text, text)
  FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.nexora_create_group_conversation(text, uuid[], text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nexora_add_group_members(uuid, uuid[])
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nexora_remove_group_member(uuid, uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nexora_leave_group(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nexora_promote_member(uuid, uuid, text)
  FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.nexora_block_user(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nexora_unblock_user(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nexora_get_blocked_users()
  FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.nexora_add_contact(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nexora_remove_contact(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nexora_get_contacts()
  FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.nexora_update_status(text, timestamptz)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nexora_search_profiles(text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.nexora_add_reaction(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.nexora_remove_reaction(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.nexora_get_message_reactions(uuid)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.nexora_edit_message(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.nexora_delete_message(uuid)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.nexora_reply_to_message(uuid, text, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.nexora_forward_message(uuid, uuid)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.nexora_search_messages(uuid, text, integer)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.nexora_storage_can_read(text, text)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.nexora_create_group_conversation(text, uuid[], text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.nexora_add_group_members(uuid, uuid[])
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.nexora_remove_group_member(uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.nexora_leave_group(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.nexora_promote_member(uuid, uuid, text)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.nexora_block_user(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.nexora_unblock_user(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.nexora_get_blocked_users()
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.nexora_add_contact(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.nexora_remove_contact(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.nexora_get_contacts()
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.nexora_update_status(text, timestamptz)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.nexora_search_profiles(text)
  TO authenticated;

COMMIT;