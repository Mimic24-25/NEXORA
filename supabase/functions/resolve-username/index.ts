import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const jsonResponse = (body: Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

const rateLimit = new Map<string, { count: number; startedAt: number }>()

export default async function handler(request: Request) {
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return jsonResponse({ error: 'Service unavailable' }, 503)

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const auth = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-real-ip') ?? 'unknown'
  const now = Date.now()
  if (rateLimit.size > 10_000) {
    for (const [entry, state] of rateLimit) {
      if (now - state.startedAt > 60_000) rateLimit.delete(entry)
    }
  }
  const key = `nexora-login-attempts:${ip.slice(0, 64)}`
  const previous = rateLimit.get(key) ?? { count: 0, startedAt: now }
  if (now - previous.startedAt > 60_000) {
    rateLimit.set(key, { count: 1, startedAt: now })
  } else if (previous.count >= 12) {
    return jsonResponse({ error: 'Too many attempts' }, 429)
  } else {
    rateLimit.set(key, { count: previous.count + 1, startedAt: previous.startedAt })
  }

  const body = await request.json().catch(() => null) as { identifier?: unknown; password?: unknown } | null
  const username = String(body?.identifier ?? '').trim().toLowerCase()
  const password = String(body?.password ?? '')

  if (!/^[a-z0-9_]{3,32}$/.test(username) || password.length < 8 || password.length > 256) {
    return jsonResponse({ error: 'Invalid credentials' }, 400)
  }

  const { data } = await supabase
    .from('profiles')
    .select('email')
    .eq('username', username)
    .maybeSingle()

  if (!data?.email) return jsonResponse({ error: 'Invalid credentials' }, 401)
  const { data: signedIn, error: signInError } = await auth.auth.signInWithPassword({
    email: data.email,
    password,
  })
  if (signInError || !signedIn.session || !signedIn.user?.email_confirmed_at) {
    if (signedIn.session) await auth.auth.signOut()
    return jsonResponse({ error: 'Invalid credentials' }, 401)
  }

  return jsonResponse({
    access_token: signedIn.session.access_token,
    refresh_token: signedIn.session.refresh_token,
  }, 200)
}
