import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const jsonResponse = (body: Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

export default async function handler(request: Request) {
  // Только POST с токеном аутентификации пользователя
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return jsonResponse({ error: 'Service unavailable' }, 503)

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Извлекаём токен пользователя из Authorization заголовка
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const token = authHeader.slice(7)

  // Проверяем токен пользователя через Supabase
  const { data: { user }, error: userError } = await supabase.auth.getUser(token)
  if (userError || !user) {
    return jsonResponse({ error: 'Invalid token' }, 401)
  }

  // Удаляем файлы пользователя из хранилища (путь начинается с <user_id>/).
  // Ошибка очистки не блокирует удаление аккаунта.
  try {
    const userId = user.id
    const { data: topLevel } = await supabase.storage.from('nexora-media').list(userId)
    const paths: string[] = []
    for (const item of topLevel ?? []) {
      if (item.id === null) {
        // Папка переписки: вложенные файлы
        const { data: nested } = await supabase.storage.from('nexora-media').list(`${userId}/${item.name}`)
        for (const file of nested ?? []) {
          if (file.id !== null) paths.push(`${userId}/${item.name}/${file.name}`)
        }
      } else {
        paths.push(`${userId}/${item.name}`)
      }
    }
    if (paths.length > 0) {
      await supabase.storage.from('nexora-media').remove(paths)
    }
  } catch (storageError) {
    console.error('Storage cleanup error (ignored):', storageError)
  }

  // Удаляем профиль: все связанные строки (чаты, сообщения, контакты и т.д.)
  // сходят каскадом по FK "on delete cascade".
  const { error: profileError } = await supabase
    .from('profiles')
    .delete()
    .eq('id', user.id)

  if (profileError) {
    console.error('Profile deletion error:', profileError)
    return jsonResponse({ error: 'Failed to delete profile' }, 500)
  }

  // Удаляем пользователя из auth.users — это автоматически завершает все его сессии.
  const { error: authError } = await supabase.auth.admin.deleteUser(user.id)
  if (authError) {
    console.error('Auth deletion error:', authError)
    return jsonResponse({ error: 'Profile deleted, but auth cleanup failed' }, 207)
  }

  return jsonResponse({ success: true, message: 'Аккаунт успешно удалён.' }, 200)
}
