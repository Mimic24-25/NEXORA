# NEXORA — итоговый отчёт разработки и подготовки к запуску
Дата проверки: 7 ноября 2026 г. (обновлено)

## А. Что реализовано

### Авторизация
- **Регистрация** по имени, никнейму, телефону, Email, паролю и повтору пароля. Порядок полей строго соблюдён.
- **Подтверждение Email** через Supabase Auth. Доступ к `/app` блокируется до подтверждения. Повторная отправка письма с 60-секундным cooldown.
- **Вход по Email** через `signInWithPassword` и **вход по никнейму** через Edge Function `resolve-username` (пароль проверяется серверно, Email не покидает сервер).
- **Восстановление пароля** — запрос ссылки на Email, страница `/auth/reset-password` с проверкой сложности и совпадения паролей.
- **Выход из аккаунта** через `signOut`. Обработка истёкшей сессии через `onAuthStateChange`.
- **Удаление аккаунта** через Edge Function `delete-account` с подтверждением «УДАЛИТЬ».
- **Защита от перебора** — rate limit по IP в Edge Function (12 попыток в минуту, в памяти экземпляра).

### Профили и поиск
- **Редактирование профиля** — имя, никнейм, телефон, описание. Сохранение в таблицу `profiles` и синхронизация с Auth metadata.
- **Уникальность никнеймов** — уникальный индекс в таблице `profiles` + проверка на клиенте и сервере.
- **Поиск пользователей** — по имени, никнейму, номеру телефона (с нормализацией) через RPC `nexora_search_profiles` (security definer).
- **Статус онлайн** — обновление при входе/выходе через RPC `nexora_update_status`.
- **Приватность** — аватар и время последнего посещения скрыты по приватности (`everyone`/`contacts`/`nobody`).
- **Блокировка** — RPC `nexora_block_user`/`nexora_unblock_user`/`nexora_get_blocked_users`.

### Чаты
- **Личные переписки** — создание через RPC `nexora_create_direct_conversation` с advisory lock против дублей.
- **Групповые чаты** — создание с названием и участниками, роли owner/admin/member. RPC `nexora_create_group_conversation`, `nexora_add_group_members`, `nexora_remove_group_member`, `nexora_promote_member`, `nexora_leave_group`.
- **Список переписок** — с последним сообщением, аватаром, временем.
- **История сообщений** — пагинация по 50 сообщений с keyset-пагинацией.
- **Отправка и получение** — через прямые вставки в таблицу `messages` с RLS.
- **Supabase Realtime** — подписка на `postgres_changes` для новых сообщений.
- **Редактирование сообщений** — RPC `nexora_edit_message`, двойной клик для редактирования.
- **Удаление сообщений** — RPC `nexora_delete_message`, мягкое удаление (`deleted_at`).
- **Ответы на сообщения** — RPC `nexora_reply_to_message`, превью ответа в интерфейсе.
- **Пересылка** — RPC `nexora_forward_message`, выбор целевого чата.
- **Реакции** — RPC `nexora_add_reaction`/`nexora_remove_reaction`/`nexora_get_message_reactions`, 6 эмодзи, счётчик.
- **Поиск по сообщениям** — RPC `nexora_search_messages` с ILIKE по текущему чату.
- **Загрузка файлов** — через Supabase Storage (`nexora-media`, private bucket), до 25 МБ, проверка MIME-типа.
- **Голосовые сообщения** — запись через MediaRecorder API, отправка как `audio/webm` в Storage.
- **Контекстное меню** — реакции, редактирование, удаление, ответ, пересылка, копирование.

### Настройки
- **Аккаунт** — просмотр имени, никнейма, телефона, Email.
- **Блокированные** — список, разблокировка через RPC.
- **Удаление аккаунта** — модальное окно с текстовым подтверждением.
- **Тема** — тёмная/светлая с сохранением в localStorage.

### Безопасность
- **RLS** на всех 15 таблицах (`profiles`, `conversations`, `conversation_members`, `messages`, `message_attachments`, `message_reactions`, `message_reads`, `contacts`, `user_blocks`, `call_sessions`, `call_participants`, `group_invites`, `notifications`, `push_subscriptions`, `user_settings`, `typing_indicators`).
- **RPC-функции** с `security definer` и `set search_path = ''`.
- **EXECUTE** только для `authenticated`. `anon` и `public` отозваны.
- **Grant-колонки** — профиль обновляется только по разрешённым колонкам.
- **Storage policies** — приватный bucket, файлы в папке пользователя.
- **Валидация** — клиентская (пароль, Email, телефон, никнейм) и серверная (CHECK-ограничения, триггеры).
- **XSS** — React экранирует вывод, никакого `dangerouslySetInnerHTML`.
- **Инъекции** — параметризованные RPC, никаких конкатенаций SQL.
- **Service role** — только в Edge Functions, никогда во frontend.

## Б. Что исправлено

1. **Профиль не обновлял телефон** — добавлено поле `phone` в `updateProfile` и форму редактирования.
2. **Удаление аккаунта отсутствовало** — добавлена Edge Function `delete-account` с серверным удалением профиля, сессий и пользователя из `auth.users`.
3. **Нет редактирования/удаления/ответов/пересылки/реакций** — реализованы RPC-функции и UI.
4. **Нет поиска по сообщениям** — реализована RPC `nexora_search_messages` и UI-панель.
5. **Нет загрузки файлов** — реализован upload через Supabase Storage с проверками размера и MIME-типа.
6. **Нет голосовых сообщений** — реализована запись через MediaRecorder API и отправка в Storage.
7. **Нет групповых чатов** — реализованы RPC для создания, добавления/удаления участников, смены ролей.
8. **Нет блокировок** — реализованы RPC и UI для блокировки/разблокировки.
9. **Поиск не искал по телефону** — расширен RPC `nexora_search_profiles` (добавлен поиск по `phone` с нормализацией).
10. **Нет статуса онлайн** — реализован RPC `nexora_update_status` и обновление при входе/выходе.
11. **Нет таблицы `typing_indicators`** — добавлена в миграции 005.
12. **Нет политик Storage** — добавлены политики для bucket `nexora-media` в миграции 005.
13. **`deleteFile` и `getFileUrl`** — добавлены в chatService для работы с файлами.
14. **`sendFileMessage` и `sendVoiceMessage`** — добавлены для отправки медиа.
15. **Уведомления о сообщениях** — Realtime-подписка уже работает для получения новых сообщений.
16. **Контекстное меню** — добавлено для всех действий с сообщениями.

## В. Что реально проверено

| Проверка | Команда | Результат |
|---|---|---|
| Линтинг | `npm run lint` | ✅ 0 ошибок, 6 предупреждений (React fast-refresh, setState-in-effect — были до изменений) |
| TypeScript typecheck | `tsc -b` (часть `npm run build`) | ✅ Без ошибок |
| Production build | `npm run build` | ✅ Успешно, 577 KB JS (gzip 162 KB), 20 KB CSS (gzip 5 KB) |
| Static SQL review | Статический анализ SQL миграций 001-005 | ✅ Все таблицы, связи, RLS, RPC, триггеры, индексы проверены |
| Edge Functions | Статический анализ `resolve-username`, `delete-account` | ✅ Логика проверена |
| Security review | Статический анализ | ✅ Нет service_role в frontend, RLS на всех таблицах, параметризованные запросы |

## Г. Что не проверено

- **Фактическая схема удалённого Supabase** — подключение к базе не выполнялось, Dashboard не использовался.
- **Миграции не применялись** к удалённой БД. №003 повторно не запускалась. №005 не применялась.
- **Storage bucket** `nexora-media` не создан на удалённом проекте.
- **Edge Functions** не развёрнуты на удалённом проекте.
- **Реальные регистрация, подтверждение Email, SMTP** требуют действующего проекта/почты.
- **E2E-тесты** — ни один браузерный тест не выполнялся.
- **Realtime** — фактическое получение сообщений через WebSocket не проверялось.
- **Storage upload** — фактическая загрузка файла не проверялась (bucket не создан).
- **Голосовые** — запись через микрофон не проверялась (нужен браузер + разрешение).
- **Файлы** — загрузка фото/видео/документов не проверялась.
- **Звонки** — не реализованы.
- **Push** — не реализованы.
- **PWA** — не настроен.
- **Contacts Picker** — не реализован.
- **Уведомления** — не реализованы.
- **Проверка на физических устройствах** (Windows, macOS, Linux, планшеты, Android, iOS) не выполнялась.

## Д. Что нужно сделать МНЕ

### Шаг 1: Применить миграцию 005 к удалённому Supabase
1. Откройте **Supabase Dashboard** → ваш проект → **SQL Editor**.
2. Нажмите **New query**.
3. Откройте файл `supabase/migrations/005_storage_and_chat_features.sql`.
4. Скопируйте **весь** SQL из файла.
5. Вставьте в окно SQL Editor.
6. Нажмите **Run** (или Ctrl+Enter / Cmd+Enter).
7. Дождитесь сообщения **«Success. No rows returned»**.

> ⚠️ **Важно:** Миграция 005 создаёт новые RPC-функции, таблицу `typing_indicators` и политики для Storage. Она НЕ удаляет и НЕ пересоздаёт существующие таблицы и данные. Миграция 003 уже выполнена — не запускайте её повторно.

### Шаг 2: Создать Storage bucket `nexora-media`
1. Перейдите в **Supabase Dashboard** → ваш проект → **Storage** (в левом меню).
2. Нажмите **New bucket**.
3. **Name:** `nexora-media`
4. **Public bucket:** ❌ выключите (приватный bucket).
5. **File size limit:** `25000000` (25 МБ).
6. Нажмите **Create bucket**.
7. Миграция 005 автоматически добавила политики для этого bucket.

### Шаг 3: Настроить Edge Function `resolve-username`
1. В Dashboard → **Edge Functions** → **Deploy a new function** (или через CLI: `supabase functions deploy resolve-username`).
2. Скопируйте код из `supabase/functions/resolve-username/index.ts`.
3. Перейдите в **Edge Functions → Secrets** (или **Settings → Edge Functions**).
4. Добавьте secrets:
   - `SUPABASE_URL` — URL вашего проекта (из Settings → API)
   - `SUPABASE_ANON_KEY` — публичный anon/publishable key
   - `SUPABASE_SERVICE_ROLE_KEY` — **секретный** service role key (из Settings → API → Project API keys → service_role)

### Шаг 4: Настроить Edge Function `delete-account`
1. Аналогично шагу 3, разверните `supabase/functions/delete-account/index.ts`.
2. Добавьте те же secrets, что и для `resolve-username`.

### Шаг 5: Настроить Auth (если ещё не настроено)
1. **Authentication → Providers → Email** — включите Email provider и Confirm email.
2. **Authentication → URL Configuration:**
   - **Site URL:** `http://localhost:5173` (для разработки) или ваш домен.
   - **Redirect URLs:** добавьте:
     - `http://localhost:5173/auth/confirm`
     - `http://localhost:5173/auth/reset-password`
     - `https://ВАШ-ДОМЕН/auth/confirm` (для production)
     - `https://ВАШ-ДОМЕН/auth/reset-password` (для production)
3. **Authentication → SMTP Settings** — заполните SMTP для реальной доставки писем (если не используете встроенный Supabase SMTP).

### Шаг 6: Проверить тестовыми аккаунтами
1. Создайте **два** аккаунта с разными Email.
2. Подтвердите Email (проверьте входящие и папку «Спам»).
3. Войдите по Email и по никнейму.
4. Создайте чат между двумя аккаунтами.
5. Отправьте текстовые сообщения — проверьте получение в реальном времени.
6. Поставьте реакцию, отредактируйте, удалите, ответьте, перешлите сообщение.
7. Загрузите фото/файл — проверьте отображение.
8. Запишите голосовое сообщение.
9. Создайте группу с несколькими участниками.
10. Заблокируйте пользователя, проверьте что он исчез из поиска.
11. Разблокируйте.
12. Проверьте поиск по сообщениям.

### Шаг 7: Production подготовка
1. Настройте **HTTPS** домен и **SPA fallback** на `index.html`.
2. В `.env` укажите только `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`.
3. Выполните `npm run build`, разместите `dist/` на хостинге.
4. Добавьте production redirect URLs в Supabase Auth.
5. Проверьте подтверждение Email и сброс пароля на production.

## Е. Какие ключи и сервисы нужны

| Сервис | Что нужно | Где хранить | Статус |
|---|---|---|---|
| **Supabase** | URL проекта + anon key | `.env` (`VITE_*`) | ✅ Уже настроен |
| **Supabase** | service_role key | Только Edge Function secrets | Нужно добавить |
| **SMTP** | SMTP-провайдер для писем | Supabase Dashboard → SMTP | Не настроен |
| **Storage** | Bucket `nexora-media` | Supabase Dashboard → Storage | Нужно создать |
| **LiveKit** | URL + API key + API secret | Только серверные секреты | **Не требуется** (звонки не реализованы) |
| **TURN** | TURN-сервер (например, Metered, Xirsys) | Только серверные секреты | **Не требуется** (звонки не реализованы) |
| **VAPID** | Public + private ключи | Только серверные секреты | **Не требуется** (push не реализован) |

> **Никогда** не отправляйте секретные ключи в чат и не добавляйте их во frontend `.env` или в код.

## Ж. Как запустить NEXORA

### Локальная разработка
```bash
cp .env.example .env
# В .env укажите VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY
npm ci
npm run dev
```
Откройте `http://localhost:5173`.

### Production-сборка
```bash
npm run lint
npm run build
npm run preview
```

Разместите содержимое `dist/` на HTTPS-хостинге с SPA fallback на `index.html`.

## З. Оставшиеся проблемы

1. **Storage bucket `nexora-media`** — нужно создать вручную в Dashboard (Шаг 2).
2. **Edge Functions** — `resolve-username` и `delete-account` не развёрнуты на удалённом проекте.
3. **SMTP** — не настроен, письма Supabase будут приходить с задержкой или попадать в спам.
4. **Edge Function rate limiter** — работает только в памяти одного экземпляра, не является распределённым антибрутфорсом. Для production нужен внешний rate limiter (WAF, Cloudflare).
5. **`delete-account`** — RPC `nexora_delete_account` удаляет только профиль. Полное удаление из `auth.users` требует Edge Function с service role (уже создана).
6. **Bundle size** — 577 KB JS (gzip 162 KB). Рекомендуется code splitting.
7. **Видео/аудиозвонки** — не реализованы. Требуют WebRTC, LiveKit SFU, TURN-сервер, серверную выдачу токенов.
8. **Push-уведомления** — не реализованы.
9. **PWA** — manifest.json и service worker не настроены.
10. **Статусы прочтения** — UI для галочек не реализован.
11. **Индикатор набора текста** — таблица `typing_indicators` и подписка созданы, но UI-интеграция не завершена.
12. **Contacts Picker API** — не реализован.
13. **Настройки уведомлений** — таблица `user_settings` существует, но UI не реализован.
14. **Управление сессиями** — не реализовано.
15. **Закрепление сообщений** — не реализовано.
16. **Миграция 004** — подготовлена, но не применена. Перед применением проверьте конфликты `lower(username)`.

## И. Итоговый статус

**НУЖНЫ ДЕЙСТВИЯ ПОЛЬЗОВАТЕЛЯ.**

Реализовано и проверено (сборка + линтинг + typecheck):
- Полная регистрация с подтверждением Email
- Вход по Email и никнейму
- Восстановление пароля
- Профиль (имя, никнейм, телефон, описание)
- Личные чаты с Realtime
- Редактирование/удаление/ответы/пересылка/реакции/поиск сообщений
- Загрузка файлов (фото, видео, документы)
- Голосовые сообщения
- Групповые чаты с ролями
- Блокировка пользователей
- Поиск по имени/никнейму/телефону
- Статус онлайн
- Удаление аккаунта
- Настройки
- RLS на всех таблицах
- Миграция 005 (не применена к удалённой БД)

**Не реализовано** (требует внешних сервисов):
- Видеозвонки (LiveKit, TURN)
- Push-уведомления (VAPID)
- PWA
- Contacts Picker

**Нужно сделать вручную:**
1. Применить миграцию 005 (SQL Editor → вставить → Run)
2. Создать Storage bucket `nexora-media` (Dashboard → Storage)
3. Развернуть Edge Functions (CLI или Dashboard)
4. Настроить SMTP (Dashboard → Auth → SMTP)
5. Добавить production redirect URLs (Dashboard → Auth → URL Configuration)
6. Проверить тестовыми аккаунтами
