-- NEXORA 007: notifications for incoming messages + realtime publication
-- Safe to run more than once. Does not alter existing messages or user data.

BEGIN;

CREATE OR REPLACE FUNCTION public.nexora_notify_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sender_name text;
  v_conversation_title text;
  v_body text;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(p.name, ''), NULLIF(p.username, ''), 'Новое сообщение')
    INTO v_sender_name
  FROM public.profiles p
  WHERE p.id = NEW.sender_id;

  SELECT c.title
    INTO v_conversation_title
  FROM public.conversations c
  WHERE c.id = NEW.conversation_id;

  v_body := CASE NEW.message_type
    WHEN 'image' THEN 'Отправил(а) фото'
    WHEN 'video' THEN 'Отправил(а) видео'
    WHEN 'voice' THEN 'Отправил(а) голосовое сообщение'
    WHEN 'file' THEN 'Отправил(а) файл'
    ELSE left(COALESCE(NEW.content, 'Новое сообщение'), 180)
  END;

  INSERT INTO public.notifications (user_id, kind, title, body, payload)
  SELECT
    cm.user_id,
    'message',
    CASE
      WHEN c.type = 'group' THEN COALESCE(NULLIF(c.title, ''), 'Группа')
      ELSE COALESCE(v_sender_name, 'Новое сообщение')
    END,
    CASE
      WHEN c.type = 'group' THEN COALESCE(v_sender_name, 'Участник') || ': ' || v_body
      ELSE v_body
    END,
    jsonb_build_object(
      'conversationId', NEW.conversation_id,
      'messageId', NEW.id
    )
  FROM public.conversation_members cm
  JOIN public.conversations c ON c.id = cm.conversation_id
  LEFT JOIN public.user_settings us ON us.user_id = cm.user_id
  LEFT JOIN public.conversation_user_settings cus
    ON cus.user_id = cm.user_id
   AND cus.conversation_id = NEW.conversation_id
  WHERE cm.conversation_id = NEW.conversation_id
    AND cm.user_id <> NEW.sender_id
    AND COALESCE(us.message_notifications, true) = true
    AND (cus.muted_until IS NULL OR cus.muted_until <= now());

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.nexora_notify_new_message()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS nexora_notify_new_message ON public.messages;
CREATE TRIGGER nexora_notify_new_message
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.nexora_notify_new_message();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END;
$$;

COMMIT;
