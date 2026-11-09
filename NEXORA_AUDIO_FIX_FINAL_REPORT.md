# NEXORA — Финальный отчёт: исправление аудио (Safari ↔ Chrome)

## 1. Первопричины

### 1.1. Аудиозвонки: не слышно собеседника

Две под-причины, которые вместе приводили к тишине (особенно Safari↔Chrome):

**Под-причина A — `ontrack` игнорировал треки из пустого `event.streams`:**
```ts
// БЫЛО (callsService.ts, pc.ontrack):
pc.ontrack = (event) => {
  this.remoteStream = event.streams[0] // Safari → event.streams = []
  // → remoteStream остаётся пустым (без аудиотрека)
  // → ссылка не меняется → React не перерендерит <audio>
  this.options.onRemoteStream(this.remoteStream)
}
```
Safari при SDP-обмене для аудио (без видеотреков) часто не включает атрибут `a=msid` в ответ. В результате `event.streams` оказывается пустым массивом, хотя `event.track` содержит валидный аудиотрек. Код брал `streams[0]` (undefined) → remoteStream без трека.

**Под-причина B — broadcast до статуса SUBSCRIBED:**
```ts
// БЫЛО (answer()):
this.joinChannel()
this.broadcast('nexora-call-accept', { userId }) // ← сразу, без await
```
Supabase Realtime не доставляет `channel.send()` до получения статуса `SUBSCRIBED`. При мгновенном ответе (собеседник уже на странице) accept/offer/ICE терялись, соединение не устанавливалось.

### 1.2. Голосовые сообщения: «Не удалось воспроизвести запись»

Запись всегда шла в `audio/webm` (Opus):
```ts
// БЫЛО:
const mediaRecorder = new MediaRecorder(stream) // Chrome→audio/webm, Safari→audio/mp4
// ...
const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType })
const extension = 'webm' // ← захардкожено
```

Safari не поддерживает воспроизведение `audio/webm` (кодек Opus). При попытке `audio.play()` браузер бросает `NotSupportedError` (MEDIA_ERR_SRC_NOT_SUPPORTED, код 4).

Дополнительная проблема: signed URL из Supabase Storage истекает через 7 дней (`604800` секунд). При повторном воспроизведении старая ссылка могла вернуть 403.

---

## 2. Изменённые файлы

### 2.1 `src/services/callsService.ts` (534 строки)

| # | Что изменено | Как было | Стало |
|---|-------------|----------|-------|
| 1 | **ontrack — сбор треков** | `this.remoteStream = event.streams[0]` | `const allTracks = [...this.remoteStream.getTracks()]; allTracks.push(event.track); this.remoteStream = new MediaStream(allTracks)` |
| 2 | **Broadcast-очередь** | `channel.send()` всегда напрямую | Если `!channelReady` → `pendingBroadcasts.push()`; при SUBSCRIBED → `flushPendingBroadcasts()` |
| 3 | **Promise подписки** | `joinChannel()` — void | `this.channelJoined: Promise<void>` — resolve на SUBSCRIBED |
| 4 | **answer() ждёт подписки** | `joinChannel()` → сразу `broadcast()` | `await this.channelJoined` → `broadcast()` |

#### Детали ontrack:
```ts
pc.ontrack = (event) => {
  const track = event.track
  // Safari может вернуть event.streams пустым (без a=msid в SDP).
  // Создаём новый MediaStream на каждое событие — так React перерендерится,
  // а Safari обновит воспроизведение (не игнорирует добавленные треки).
  const allTracks = [...this.remoteStream.getTracks()]
  if (!allTracks.some((t) => t.id === track.id)) allTracks.push(track)
  this.remoteStream = new MediaStream(allTracks)
  this.options.onRemoteStream(this.remoteStream)
}
```

#### Детали broadcast-очереди:
```ts
private broadcast(event: string, payload: Record<string, unknown>): void {
  if (!this.channelReady) {
    this.pendingBroadcasts.push({ event, payload })
    return
  }
  this.channel.send({ type: 'broadcast', event, payload })
}

private flushPendingBroadcasts(): void {
  if (!this.channel || !this.channelReady) return
  const queued = this.pendingBroadcasts.splice(0)
  for (const item of queued) {
    this.channel.send({ type: 'broadcast', event: item.event, payload: item.payload })
  }
}
```

#### Детали Promise подписки:
```ts
.subscribe((status) => {
  if (status === 'SUBSCRIBED') {
    this.channelReady = true
    this.flushPendingBroadcasts()
    resolve()
  }
  if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
    resolve() // Не вешаем answer() навсегда
  }
})
```

### 2.2 `src/pages/DashboardPage.tsx` (2311 строк)

| # | Что изменено | Как было | Стало |
|---|-------------|----------|-------|
| 1 | **Запись: MIME-тип** | `new MediaRecorder(stream)` | `new MediaRecorder(stream, { mimeType })` где `mimeType = pickAudioMimeType()` |
| 2 | **pickAudioMimeType()** | не существовал | Порядок: `audio/mp4` → `audio/mp4;codecs=mp4a.40.2` → `audio/webm;codecs=opus` → `audio/webm` |
| 3 | **Blob с фактическим MIME** | `{ type: 'audio/webm' }` | `{ type: mediaRecorder.mimeType || recorderMimeRef.current }`, передаётся в `sendVoiceMessage(..., actualType)` |
| 4 | **Аудио-элемент в оверлее** | не рендерился в audio-режиме | `<audio ref={remoteAudioRef} autoPlay playsInline />` — всегда рендерится |
| 5 | **Эффект привязки аудио** | не существовал | `if (mode==='audio' && remoteStream) { audio.srcObject = remoteStream; tryPlay() }` |
| 6 | **Попытка play() на connected** | не было | `setTimeout(() => tryPlayRemoteAudioRef.current(), 150)` при статусе `'connected'` |
| 7 | **Кнопка «Включить звук»** | не было | Кнопка при `callAudioBlocked && mode==='audio'` |
| 8 | **handleVoicePlay** | не было | Пытается play() → если NotAllowedError → сообщение; если ошибка доступа → обновляет signed URL; если формат → describeAudioError |
| 9 | **describeAudioError** | не было | Распознаёт коды ошибок: 4 (формат), 3 (декодирование), 2 (сеть/URL), 1 (прервано) |
| 10 | **storagePathFromSignedUrl** | не было | Парсит `/object/sign/nexora-media/` из signed URL для обновления ссылки |
| 11 | **onError в голосовых** | не было | `<audio onError>` → `describeAudioError(element)` |
| 12 | **closeCallOverlay** | не сбрасывал callAudioBlocked | Добавлен `setCallAudioBlocked(false)` |

#### Детали pickAudioMimeType:
```ts
const pickAudioMimeType = (): string => {
  const candidates = [
    'audio/mp4',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/webm;codecs=opus',
    'audio/webm'
  ]
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return ''
}
```

#### Детали handleVoicePlay:
```ts
const handleVoicePlay = async (message: ChatMessage) => {
  // 1. play() → если NotAllowedError → «нажмите ещё раз»
  // 2. Иначе ошибка доступа → getFileUrl(storagePath) → обновить src → play
  // 3. describeAudioError(audio, lastError) → понятное сообщение
}
```

### 2.3 `src/services/chatService.ts` (895 строк)

| # | Что изменено | Как было | Стало |
|---|-------------|----------|-------|
| 1 | **sendVoiceMessage** | без параметра MIME (всегда webm) | 4-й параметр `mimeType: string = 'audio/webm'` (дефолт для совместимости со старыми вызовами) |
| 2 | **Расширение из MIME** | `'webm'` (захардкожено) | `mimeType.includes('mp4') ? 'm4a' : mimeType.includes('ogg') ? 'ogg' : 'webm'` |
| 3 | **upload contentType** | `'audio/webm'` | `mimeType` (фактический) |
| 4 | **ALLOWED_MIME_TYPES** | без mp4 | Добавлены `audio/mp4, audio/aac, audio/x-m4a, audio/flac` |

#### Детали sendVoiceMessage:
```ts
export const sendVoiceMessage = async (
  conversationId, senderId, audioBlob, mimeType = 'audio/webm'
) => {
  const extension = mimeType.includes('mp4') ? 'm4a'
    : mimeType.includes('ogg') ? 'ogg'
    : 'webm'
  const storagePath = `${user.id}/${conversationId}/voice_${Date.now()}.${extension}`
  // ...
  await client.storage.from('nexora-media')
    .upload(storagePath, audioBlob, { contentType: mimeType })
}
```

---

## 3. Результаты проверок

| Проверка | Результат |
|----------|-----------|
| `npx tsc -b` | ✅ **0 ошибок** |
| `npm run build` | ✅ **успех** — 603.36 KB JS / 169.32 KB gzip, CSS 20.82 KB |
| `npm run lint` (oxlint) | ✅ **14 warnings / 0 errors** (pre-existing, не блокирующие) |
| Тесты | ⚠️ В проекте нет тестов (npm test не определён) |

### Предупреждения сборки (не блокирующие):
1. **Chunk > 500 KB** — `index-CUPXboYB.js` (603 KB). Рекомендуется code-splitting (dynamic import) — не критично.
2. **INEFFECTIVE_DYNAMIC_IMPORT** — `chatService` импортирован динамически (для `sendFileMessage`/`sendVoiceMessage`) и статически (для типов). Не влияет на работу.

---

## 4. Что осталось проверить вручную

### 4.1 Аудиозвонки Safari ↔ Chrome

1. **Откройте NEXORA в двух браузерах** (Chrome и Safari) с двумя разными аккаунтами.
2. **Убедитесь, что bucket `nexora-media` создан** на Supabase.
3. **Начните аудиозвонок** из Chrome в Safari (и наоборот).
4. **Ожидаемый результат:**
   - Обе стороны слышат друг друга.
   - Статус проходит: `ringing` → `connecting` → `connected` → `ended`.
   - В Safari на оверлее звонка может появиться кнопка «Включить звук собеседника» — нажмите.
5. **Откройте консоль браузера (F12) и проверьте:**
   - `ontrack: received track id=... kind=audio enabled=true muted=false readyState=live`
   - Нет ошибок `NotReadableError`, `NotAllowedError`, `Failed to set remote offer`.

### 4.2 Голосовые сообщения

1. **Запишите голосовое в Chrome** → оно сохранится как `.m4a` (AAC в MP4) при поддержке `audio/mp4`, или `.webm` (Opus) — при её отсутствии.
2. **Запишите голосовое в Safari** → оно сохранится как `.m4a` (AAC в MP4).
3. **Воспроизведите в Safari:**
   - `.m4a` → воспроизводится без ошибок ✅
   - `.webm` → появится сообщение: *«Браузер не поддерживает формат этой записи (например, webm в Safari). Новые голосовые сохраняются в mp4.»* — это ожидаемое поведение (Safari физически не декодирует Opus в WebM).
4. **Воспроизведите в Chrome:**
   - `.m4a` → воспроизводится ✅
   - `.webm` → воспроизводится ✅
5. **Проверьте обновление ссылки:**
   - Отправьте голосовое → закройте страницу → откройте через 7+ дней → нажмите воспроизведение → ссылка обновится автоматически.

### 4.3 Видео звонки

1. **Видеозвонок Safari ↔ Chrome** → видео и звук должны работать без двойного воспроизведения (звук идёт через `<video>`, `<audio>` не используется).

---

## 5. Ограничения

- **Safari↔Chrome кросс-браузерный тест в данном окружении невозможен.** Проверка требует двух запущенных браузеров с двумя аккаунтами и микрофонами.
- **Старые голосовые в `.webm` в Safari неиграбельны** — это физическое ограничение Safari (нет декодера Opus). Новые записи идут в `.m4a`.
- **TURN-сервер отсутствует** — за симметричным NAT (корпоративные сети, мобильный интернет) соединение может не установиться. Для продакшена нужен TURN (например, daily.co или self-hosted coturn).
- **Signed URL истекает через 7 дней** — `handleVoicePlay` пытается обновить ссылку при воспроизведении, но если обновление не помогает (проблема с RLS/сетью), пользователь увидит сообщение об ошибке.

---

## 6. Итог

| Проблема | Первопричина | Фикс | Статус |
|---------|-------------|------|--------|
| Нет звука в аудио (Safari↔Chrome) | `event.streams=[]` в ontrack | Сбор треков в новый MediaStream | ✅ |
| Потеря сигнала (offer/answer/ICE) | send() до SUBSCRIBED | Очередь + await channelJoined | ✅ |
| «Не удалось воспроизвести» в Safari | webm/opus не поддерживается | Запись в mp4/AAC + diagnostics | ✅ |
| Истёкшие signed URL | 7-дневный expiry | Обновление ссылки при ошибке | ✅ |
