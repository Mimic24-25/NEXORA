# NEXORA — веб-мессенджер

NEXORA — русскоязычное веб-приложение на React, TypeScript, Vite и Supabase.

## Реализованные функции

- **Регистрация** — имя, никнейм, телефон, Email, пароль + повтор. Валидация всех полей.
- **Подтверждение Email** — блокировка доступа до подтверждения, повторная отправка письма с cooldown.
- **Авторизация** — вход по Email или никнейму. Edge Function `resolve-username` проверяет пароль серверно, Email не покидает сервер.
- **Восстановление пароля** — запрос ссылки по Email, страница задания нового пароля с проверкой сложности и совпадения.
- **Профиль** — редактирование имени, никнейма, телефона, описания. Данные сохраняются в Supabase и синхронизируются с Auth metadata.
- **Личные чаты** — создание через поиск, отправка текста, история с пагинацией (50 сообщений на страницу).
- **Редактирование сообщений** — двойной клик для редактирования, кнопка «Изменить» в контекстном меню.
- **Удаление сообщений** — мягкое удаление (deletedAt), видно всем участникам чата.
- **Ответы на сообщения** — reply-to с превью ответа в интерфейсе.
- **Пересылка сообщений** — выбор целевого чата из списка переписок.
- **Реакции на сообщения** — 6 эмодзи (👍❤️😂😮😢🔥), счётчик, подсчёт пользователей.
- **Поиск по сообщениям** — поиск по текущему чату с фильтрацией в реальном времени.
- **Загрузка файлов** — фото, видео, документы через Supabase Storage (до 25 МБ, проверка MIME-типа).
- **Голосовые сообщения** — запись через MediaRecorder API, отправка как аудиофайл.
- **Realtime** — Supabase Realtime для новых сообщений и обновлений чатов.
- **Поиск пользователей** — по имени, никнейму, номеру телефона (с нормализацией).
- **Блокировка пользователей** — добавление/удаление из списка заблокированных, скрывает из поиска.
- **Групповые чаты** — создание с названием и участниками, роли (owner/admin/member).
- **Настройки** — просмотр аккаунта, список заблокированных, удаление аккаунта с подтверждением.
- **Тема оформления** — тёмная/светлая тема с сохранением в localStorage.
- **Статус онлайн** — обновление при входе/выходе, отображение в чатах и контактах.
- **Контекстное меню сообщений** — реакции, редактирование, удаление, ответ, пересылка, копирование.
- **RLS (Row Level Security)** — все пользовательские таблицы защищены политиками.

## Требования

- Node.js и npm, совместимые с текущими версиями Vite и TypeScript в `package.json`.
- Supabase проект с включённым Email provider.
- Для никнейм-входа — развёрнутая Edge Function `resolve-username`.

## Локальный запуск

```bash
cp .env.example .env
```

Укажите в `.env` только URL проекта и публичный anon/publishable key:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-or-publishable-key
```

Затем:

```bash
npm ci
npm run dev
```

Vite обычно открывает `http://localhost:5173`.

## Supabase подготовка

### 1. Миграции

В Supabase Dashboard → SQL Editor откройте проект разработки и выполните по очереди:

1. `001_create_core_schema.sql` — базовая схема таблиц
2. `002_auth_profiles_chat_security.sql` — RPC-функции и RLS
3. `003_chat_profiles_and_message_deletion.sql` — доп. функции (если ещё не применена)
4. `005_storage_and_chat_features.sql` — реакции, редактирование, файлы, голосовые, группы, блокировки

> **Важно:** Если `003` уже выполнена, не запускайте её повторно. `004_security_hardening.sql` — локальная, не применяйте без проверки на staging.

### 2. Создание Storage Bucket

В Supabase Dashboard → Storage → New Bucket:
- **Name:** `nexora-media`
- **Public:** ❌ (private)
- **File size limit:** 25000000 (25 МБ)

> Миграция 005 автоматически добавляет политики для bucket `nexora-media`, но сам bucket нужно создать вручную.

### 3. Подтверждение Email и SMTP

- **Authentication → Providers → Email:** включите Email provider и Confirm email.
- **Authentication → URL Configuration:** добавьте Redirect URLs:
  - `http://localhost:5173/auth/confirm`
  - `http://localhost:5173/auth/reset-password`
  - `https://ВАШ-ДОМЕН/auth/confirm`
  - `https://ВАШ-ДОМЕН/auth/reset-password`
- **Authentication → SMTP Settings:** настройте SMTP-провайдер для доставки писем.

### 4. Edge Function `resolve-username`

Разверните `supabase/functions/resolve-username/index.ts`:

```bash
supabase functions deploy resolve-username
```

Установите server-side secrets:
- `SUPABASE_URL` — URL проекта
- `SUPABASE_ANON_KEY` — публичный key
- `SUPABASE_SERVICE_ROLE_KEY` — секретный service role key

### 5. Edge Function `delete-account`

Разверните `supabase/functions/delete-account/index.ts`:

```bash
supabase functions deploy delete-account
```

Установите те же server-side secrets, что и для `resolve-username`.

## Команды

```bash
npm run lint      # Проверка кода (oxlint)
npm run build     # Production-сборка
npm run preview   # Просмотр production-сборки локально
```

## Production публикация

1. Настройте production `.env` только публичными переменными.
2. Выполните `npm ci`, `npm run lint`, `npm run build`.
3. Разместите содержимое `dist/` на статическом HTTPS-хостинге с SPA fallback на `index.html`.
4. Добавьте production redirect URL в Supabase Auth.
5. Разверните Edge Functions и храните секреты только в их settings.
6. Проверьте тестовыми аккаунтами регистрацию, вход, чаты, загрузку файлов.

## Не реализовано

- **Видео/аудиозвонки** — WebRTC и LiveKit требуют серверной функции для выдачи токенов, TURN-сервер, STUN.
- **Push-уведомления** — Browser Push требует VAPID ключей и серверной отправки.
- **PWA** — manifest.json и service worker не настроены.
- **Статусы доставки/прочтения** — таблица `message_reads` существует, но UI для отображения галочек не реализован.
- **Закрепление сообщений** — RPC не реализована.
- **Contacts Picker API** — не реализована интеграция с системной адресной книгой.
- **Настройки уведомлений** — UI не реализован (таблица `user_settings` существует).
- **Управление сессиями** — не реализовано.
- **Голосовые — воспроизведение** — кнопка воспроизведения в UI есть, но реальное управление Audio API не реализовано.
