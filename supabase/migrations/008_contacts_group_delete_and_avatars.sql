-- NEXORA 008: group deletion, explicit group avatar removal and phone contact matching
BEGIN;

-- Explicit NULL support: COALESCE previously made it impossible to clear a group avatar.
DROP FUNCTION IF EXISTS public.nexora_update_group_settings(uuid, text, text, text, boolean, boolean, boolean);
CREATE OR REPLACE FUNCTION public.nexora_update_group_settings(
  p_conversation_id uuid,
  p_title text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_avatar_url text DEFAULT NULL,
  p_can_write boolean DEFAULT NULL,
  p_can_send_files boolean DEFAULT NULL,
  p_can_send_media boolean DEFAULT NULL,
  p_clear_avatar boolean DEFAULT false
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

  SELECT cm.role INTO v_role
  FROM public.conversation_members cm
  JOIN public.conversations c ON c.id = cm.conversation_id
  WHERE cm.conversation_id = p_conversation_id
    AND cm.user_id = v_user_id
    AND c.type = 'group';

  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Только администраторы могут менять настройки группы.'
      USING errcode = '42501';
  END IF;

  UPDATE public.conversations
  SET
    title = COALESCE(NULLIF(btrim(p_title), ''), title),
    description = COALESCE(p_description, description),
    avatar_url = CASE WHEN p_clear_avatar THEN NULL ELSE COALESCE(p_avatar_url, avatar_url) END,
    can_write = COALESCE(p_can_write, can_write),
    can_send_files = COALESCE(p_can_send_files, can_send_files),
    can_send_media = COALESCE(p_can_send_media, can_send_media)
  WHERE id = p_conversation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.nexora_update_group_settings(uuid, text, text, text, boolean, boolean, boolean, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nexora_update_group_settings(uuid, text, text, text, boolean, boolean, boolean, boolean)
  TO authenticated;

-- Only the owner can permanently delete the group for every participant.
CREATE OR REPLACE FUNCTION public.nexora_delete_group(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация.' USING errcode = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.conversations c
    JOIN public.conversation_members cm ON cm.conversation_id = c.id
    WHERE c.id = p_conversation_id
      AND c.type = 'group'
      AND cm.user_id = auth.uid()
      AND cm.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Удалить группу может только её владелец.'
      USING errcode = '42501';
  END IF;

  DELETE FROM public.conversations
  WHERE id = p_conversation_id AND type = 'group';
END;
$$;

REVOKE ALL ON FUNCTION public.nexora_delete_group(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nexora_delete_group(uuid) TO authenticated;

-- Match only the numbers explicitly supplied by the signed-in user.
-- Numbers are compared in normalized digits-only form; no phone directory is exposed.
CREATE OR REPLACE FUNCTION public.nexora_match_phone_contacts(p_phone_numbers text[])
RETURNS TABLE (
  id uuid,
  name text,
  username text,
  avatar_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.id,
         p.name,
         p.username,
         CASE
           WHEN p.privacy_avatar = 'everyone'
             OR (p.privacy_avatar = 'contacts' AND EXISTS (
               SELECT 1 FROM public.contacts c
               WHERE c.owner_id = p.id AND c.contact_user_id = auth.uid()
             ))
           THEN p.avatar_url
           ELSE NULL
         END AS avatar_url
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE auth.uid() IS NOT NULL
    AND p.id <> auth.uid()
    AND u.email_confirmed_at IS NOT NULL
    AND p.phone IS NOT NULL
    AND regexp_replace(p.phone, '[^0-9]', '', 'g') <> ''
    AND regexp_replace(p.phone, '[^0-9]', '', 'g') = ANY (
      ARRAY(
        SELECT regexp_replace(COALESCE(x, ''), '[^0-9]', '', 'g')
        FROM unnest(COALESCE(p_phone_numbers, ARRAY[]::text[])) AS x
      )
    )
  LIMIT 500;
$$;

REVOKE ALL ON FUNCTION public.nexora_match_phone_contacts(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nexora_match_phone_contacts(text[]) TO authenticated;

COMMIT;
