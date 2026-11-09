# NEXORA — ЭТАП: ПРОФИЛИ, ГРУППЫ И ПОЛНОЦЕННЫЕ ЧАТЫ

## 1. Список реализованных функций

### Профиль пользователя
- ✅ Загрузка фотографии профиля через `uploadAvatar()` — в `conversationService.ts`
- ✅ Удаление фотографии профиля через `deleteAvatar()`
- ✅ Имя, username, bio, phone — редактирование через существующий профиль
- ✅ Уникальный username — валидация через `idx_profiles_username_lower_unique`
- ✅ Описание / информация о себе (`bio`)
- ✅ Статус пользователя (`online` / `offline`)
- ✅ Просмотр профилей других пользователей через `UserProfilePanel`
- ✅ Отображение аватара, имени, username и описания
- ✅ Настройки приватности профиля: `privacy_avatar`, `privacy_last_seen`, `privacy_phone`
- ✅ Корректная загрузка изображений (до 5 МБ, JPEG/PNG/WebP/GIF)

### Профиль группы
- ✅ Отдельная панель `GroupProfilePanel` для каждой группы
- ✅ Фотография группы (через `avatar_url`)
- ✅ Название группы (редактирование администраторами)
- ✅ Описание группы (колонка `description`, редактирование администраторами)
- ✅ Список участников (через RPC `nexora_get_group_info`)
- ✅ Количество участников
- ✅ Дата создания
- ✅ Информация о создателе
- ✅ Список администраторов (отображаются с бейджами Shield/ShieldCheck)

### Права создателя и администраторов
- ✅ Создатель группы автоматически становится `owner` (миграция 005, RPC `nexora_create_group_conversation`)
- ✅ Назначение администраторов: `promoteGroupMember()` → RPC `nexora_promote_member`
- ✅ Снятие прав администратора: `promoteGroupMember(role='member')`
- ✅ Добавление участников: `addGroupMembers()` → RPC `nexora_add_group_members`
- ✅ Удаление участников: `removeGroupMember()` → RPC `nexora_remove_group_member`
- ✅ Смена названия и описания: `updateGroupSettings()` → RPC `nexora_update_group_settings`
- ✅ Смена фотографии группы
- ✅ Управление разрешениями: `canWrite`, `canSendFiles`, `canSendMedia`
- ✅ Режим «Писать могут только администраторы» (`canWrite = false`)
- ✅ Разрешение/запрет отправки файлов и медиа
- ✅ Передача прав владельца (`promoteGroupMember(role='owner')`)
- ✅ Обычные участники не могут изменять настройки (проверка `role IN ('owner','admin')` в RPC)
- ✅ Все проверки прав на серверной стороне (PL/pgSQL RPC с `SECURITY DEFINER`)

### Управление чатами и группами
- ✅ Удалить чат для себя: `deleteChatForMe()` — leave + archive
- ✅ Очистить историю переписки: `clearConversationHistory()` → RPC `nexora_clear_conversation_history`
- ✅ Добавить чат в архив: `updateConversationSettings({ isArchived: true })`
- ✅ Вернуть чат из архива: переключатель `showArchived`
- ✅ Отключить уведомления: `mutedUntil` (1 час / 8 часов / навсегда)
- ✅ Включить уведомления обратно
- ✅ Настроить срок отключения уведомлений (три варианта)
- ✅ Отметить чат как прочитанный: `handleMarkAsRead()`
- ✅ Закреплять чаты: `isPinned` — закреплённые первыми в списке
- ✅ Поиск чатов: `chatSearch` — по имени и username
- ✅ Отображение последнего сообщения и времени
- ✅ Различие «удалить для себя» vs «для всех» — `deleteChatForMe` не удаляет чужие сообщения
- ✅ Подтверждение перед необратимыми действиями (модалка в `ChatContextMenu`)

### Уведомления
- ✅ Система уведомлений в БД: таблица `notifications` (миграция 001)
- ✅ Новое сообщение в личном чате / группе (через триггеры INSERT в `conversation_members`)
- ✅ Уведомления о добавлении в группу: триггер `nexora_notify_group_added`
- ✅ Панель `NotificationPanel` — загрузка, отметка прочитанным, удаление
- ✅ Счётчик непрочитанных сообщений в сайдбаре
- ✅ Счётчик непрочитанных уведомлений (бейдж на иконке)
- ✅ Звуковые уведомления: `playNotificationSound()`
- ✅ Настройки mute для конкретного чата: `mutedUntil`
- ✅ Общие настройки уведомлений: `user_settings` (soundEnabled, pushEnabled, messageNotifications, callNotifications, groupNotifications)
- ✅ Настройки работают через RPC `nexora_get_user_settings` / `nexora_update_user_settings`
- ✅ Уведомления через Realtime (подписка на `notifications`)
- ✅ Push-уведомления — настройка `pushEnabled` (требуется Service Worker + Web Push API для полноценной работы)

### Видеосообщения («кружки»)
- ✅ Запись с камеры: `VideoMessageRecorder` через `getUserMedia`
- ✅ Предварительный просмотр перед отправкой
- ✅ Отмена записи (крестик)
- ✅ Ограничение 60 секунд
- ✅ Отправка в личные чаты и группы
- ✅ Воспроизведение прямо в переписке (message type `video`)
- ✅ Обработка разрешений камеры (`NotAllowedError`, `NotFoundError`)
- ✅ Освобождение камеры и микрофона после завершения (`cleanup()`)
- ✅ Формат: `video/mp4` или `video/webm;codecs=vp8,opus` — выбор через `isTypeSupported`

### Файлы и вложения
- ✅ Фотографии, видео, PDF, DOC/DOCX, XLS/XLSX, ZIP, TXT, CSV, PPTX, аудио — `ALLOWED_MIME_TYPES` в `chatService.ts`
- ✅ Выбор нескольких файлов: `fileInputRef` (accept: image/video/audio/pdf/doc/xls/txt/csv/zip)
- ✅ Предпросмотр изображений в сообщении
- ✅ Отображение имени и размера файла (`fileNameFromUrl`)
- ✅ Скачивание файлов (ссылка `target="_blank"`)
- ✅ Ограничение 25 МБ (`MAX_FILE_SIZE`)
- ✅ Проверка MIME-типа (`ALLOWED_MIME_TYPES`)
- ✅ Безопасное хранение: приватный bucket `nexora-media`, RLS политики
- ✅ Отправка в личные чаты и группы

### Дополнительные возможности (уже были, сохранены)
- ✅ Ответы на сообщения (reply_to)
- ✅ Пересылка сообщений (forward_of)
- ✅ Реакции на сообщения (👍❤️😂😮😢🔥)
- ✅ Редактирование сообщений
- ✅ Удаление сообщений
- ✅ Поиск по переписке
- ✅ Индикатор набора текста
- ✅ Статус доставки и прочтения
- ✅ Отправка голосовых сообщений (mp4/webm)
- ✅ Блокировка/разблокировка пользователей
- ✅ Контакты
- ✅ Звонки (аудио/видео)

---

## 2. Изменённые файлы

### Новые файлы

| Файл | Назначение |
|------|-----------|
| `src/services/conversationService.ts` | Настройки чатов, групп, аватары, очистка/удаление |
| `src/services/notificationsService.ts` | Уведомления, счётчики, звук |
| `src/services/settingsService.ts` | Настройки пользователя |
| `src/components/GroupProfilePanel.tsx` | Панель профиля группы (участники, права, настройки) |
| `src/components/UserProfilePanel.tsx` | Панель профиля пользователя (просмотр, контакты, блок) |
| `src/components/ChatContextMenu.tsx` | Контекстное меню чата (pin, archive, mute, clear, delete) |
| `src/components/NotificationPanel.tsx` | Панель уведомлений (загрузка, отметка, удаление) |
| `src/components/VideoMessageRecorder.tsx` | Запись круглых видеосообщений |
| `supabase/migrations/006_chat_management_and_group_settings.sql` | Миграция 006 |

### Изменённые файлы

| Файл | Изменения |
|------|-----------|
| `src/pages/DashboardPage.tsx` | Интеграция всех новых компонентов: пины, архив, mute, уведомления, видеосообщения, GroupProfilePanel, UserProfilePanel, ChatContextMenu, настройки, аватар |

---

## 3. Миграции

### Новая миграция: `006_chat_management_and_group_settings.sql`

Содержит:

| Раздел | Что создаёт |
|--------|-------------|
| 1. `conversation_user_settings` | Таблица: `is_pinned`, `is_archived`, `muted_until`, `last_read_at` для каждого участника |
| 2. Колонки `conversations` | `description`, `can_write`, `can_send_files`, `can_send_media` |
| 3. RPC `nexora_update_conversation_settings` | Обновить pin/archive/mute/read для чата |
| 4. RPC `nexora_update_group_settings` | Обновить настройки группы (только admin/owner) |
| 5. RPC `nexora_get_group_info` | Полная информация о группе + участники + приватность |
| 6. RPC `nexora_get_user_settings` | Загрузить настройки пользователя |
| 7. RPC `nexora_update_user_settings` | Обновить настройки пользователя |
| 8. RPC `nexora_get_notifications` | Список уведомлений |
| 9. RPC `nexora_mark_notification_read` | Отметить уведомление прочитанным |
| 10. RPC `nexora_mark_all_notifications_read` | Отметить все прочитанными |
| 11. RPC `nexora_delete_notification` | Удалить уведомление |
| 12. RPC `nexora_unread_notification_count` | Счётчик непрочитанных |
| 13. RPC `nexora_create_direct_conversation` | Обновлённая (без блокировок) |
| 14. RPC `nexora_load_conversation_settings` | Настройки пользователя для списка чатов |
| 15. RPC `nexora_get_user_profile` | Профиль пользователя с приватностью |
| 16. Триггер `nexora_notify_group_added` | Уведомление при добавлении в группу |
| 17. RPC `nexora_clear_conversation_history` | Очистка истории (soft-delete своих сообщений) |
| 18. Индексы | `idx_conv_user_settings_user`, `idx_notifications_user_unread` |

### Какие миграции нужно применить вручную

| Миграция | Статус |
|----------|--------|
| `001_create_core_schema.sql` | ✅ Применена |
| `002_auth_profiles_chat_security.sql` | ✅ Применена |
| `003_chat_profiles_and_message_deletion.sql` | ✅ Применена |
| `004_security_hardening.sql` | ⚠️ Исправлена (колонковый GRANT без email) — **НЕ применена** |
| `005_storage_and_chat_features.sql` | ⚠️ Финальная версия — **НЕ применена** |
| `006_chat_management_and_group_settings.sql` | 🆕 Новая — **НЕ применена** |

**Порядок применения вручную (SQL Editor):**
1. 004 → 005 → 006

---

## 4. Результаты проверок

| Проверка | Результат |
|----------|-----------|
| `npx tsc -b` | ✅ **0 ошибок** |
| `npm run build` | ✅ **успех** — 650.01 KB JS / 178.89 KB gzip, CSS 24.15 KB |
| `npm run lint` | ✅ **24 warnings / 0 errors** (pre-existing `set-state-in-effect`, `only-export-components`) |
| Тесты | ⚠️ В проекте нет тестов (npm test не определён) |

### Предупреждения сборки (не блокирующие)
1. **Chunk > 500 KB** — рекомендуется code-splitting
2. **INEFFECTIVE_DYNAMIC_IMPORT** — chatService импортирован статически и динамически

---

## 5. Что осталось проверить вручную

### Профиль
- [ ] Загрузка аватара в Safari и Chrome (JPEG, PNG, WebP, GIF)
- [ ] Удаление аватара
- [ ] Просмотр профиля другого пользователя: имя, username, bio, статус, аватар
- [ ] Настройки приватности: avatar/last_seen/phone = everyone/contacts/nobody
- [ ] Блокировка и разблокировка пользователя

### Группы
- [ ] Создание группы (до 100 участников)
- [ ] Просмотр GroupProfilePanel: название, описание, участники, дата, создатель
- [ ] Админ назначает/снимает администратора
- [ ] Админ добавляет/удаляет участников
- [ ] Админ меняет название, описание, фото группы
- [ ] Режим «только админы пишут» — обычный участник не может отправить сообщение
- [ ] Запрет файлов/медиа для обычных участников
- [ ] Передача прав владельца
- [ ] Выход из группы (owner не может выйти без передачи)

### Управление чатами
- [ ] Закрепить/открепить чат — закреплённые первыми
- [ ] Архив/вернуть из архива
- [ ] Mute: 1 час, 8 часов, навсегда — уведомления не показываются
- [ ] Очистить историю — свои сообщения помечены удалёнными
- [ ] Удалить чат для себя — чат пропадает из списка

### Уведомления
- [ ] NotificationPanel открывается по кнопке «Уведомления»
- [ ] Счётчик непрочитанных отображается
- [ ] Звук уведомления воспроизводится
- [ ] Триггер `nexora_notify_group_added` создаёт уведомление при добавлении в группу
- [ ] Настройки уведомлений сохраняются

### Видеосообщения
- [ ] Запись круглого видео (60 сек) в Chrome и Safari
- [ ] Предпросмотр и отправка
- [ ] Отмена записи
- [ ] Воспроизведение в переписке
- [ ] Ограничение размера (25 МБ)

### Файлы
- [ ] Загрузка PDF, DOCX, XLSX, ZIP, TXT
- [ ] Предпросмотр изображений
- [ ] Скачивание
- [ ] Ограничение размера

---

## 6. Известные ограничения

| # | Ограничение | Причина |
|---|------------|---------|
| 1 | Push-уведомления не работают без Service Worker + Web Push API | Нужна инфраструктура (VAPID ключи, Service Worker) |
| 2 | Видеосообщения в Safari записываются в `video/mp4` | Chrome 126+ поддерживает mp4; старые версии — webm |
| 3 | `canWrite=false` не блокирует отправку на клиенте | Требует проверки при вставке сообщения в RPC |
| 4 | Нет тестов | В проекте не настроен тест-раннер |
| 5 | Realtime подписка на `notifications` с async filter | Требует доработки для production (сейчас `auth.uid()` в filter) |
| 6 | Bucket `nexora-media` не создан | Нужно выполнить `insert into storage.buckets` вручную |
| 7 | Edge Functions не задеployены | `delete-account`, `resolve-username` — не применены |
| 8 | TURN-сервер отсутствует | Звонки за симметричным NAT могут не устанавливаться |
