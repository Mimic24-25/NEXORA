import { supabase } from '../lib/supabase'
import type { RealtimeChannel } from '@supabase/supabase-js'

// ============================================================================
// Звонки: WebRTC (P2P) + сигналинг через Supabase Realtime Broadcast.
// Внешние сервисы (LiveKit/Twilio) не требуются. Используются публичные
// STUN-серверы; без TURN соединение может не установиться за симметричным NAT.
// ============================================================================

export type CallMode = 'audio' | 'video'

export type CallStatus =
  | 'ringing'
  | 'connecting'
  | 'connected'
  | 'ended'
  | 'declined'
  | 'missed'
  | 'busy'
  | 'failed'
  | 'canceled'

export interface IncomingCallInfo {
  callId: string
  conversationId: string
  mode: CallMode
  fromUserId: string
  fromName: string
}

interface InvitePayload {
  callId: string
  conversationId: string
  mode: CallMode
  fromUserId: string
  fromName: string
}

const RING_TIMEOUT_MS = 35_000

const ICE_CONFIGURATION: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ],
}

const callChannelName = (callId: string) => `nexora-call-${callId}`
const inboxChannelName = (userId: string) => `nexora-inbox-${userId}`

const requireClient = () => {
  if (!supabase) {
    throw new Error('Подключение к Supabase не настроено. Проверьте переменные окружения.')
  }
  return supabase
}

// ----------------------------------------------------------------------------
// Входящие вызовы: персональный inbox-канал пользователя
// ----------------------------------------------------------------------------

export const subscribeIncomingCalls = (
  userId: string,
  handlers: {
    onInvite: (info: IncomingCallInfo) => void
    onCancel: (callId: string) => void
  },
): (() => void) => {
  const client = requireClient()
  const channel = client
    .channel(inboxChannelName(userId))
    .on('broadcast', { event: 'nexora-call-invite' }, (payload) => {
      const data = payload.payload as InvitePayload | undefined
      if (!data?.callId || !data?.conversationId) return
      handlers.onInvite({
        callId: data.callId,
        conversationId: data.conversationId,
        mode: data.mode === 'video' ? 'video' : 'audio',
        fromUserId: data.fromUserId,
        fromName: data.fromName,
      })
    })
    .on('broadcast', { event: 'nexora-call-cancel' }, (payload) => {
      const data = payload.payload as { callId?: string } | undefined
      if (data?.callId) handlers.onCancel(data.callId)
    })
    .subscribe()

  return () => {
    void client.removeChannel(channel)
  }
}

// ----------------------------------------------------------------------------
// Активный вызов
// ----------------------------------------------------------------------------

interface ActiveCallOptions {
  userId: string
  conversationId: string
  peerUserId: string
  peerName: string
  mode: CallMode
  direction: 'outgoing' | 'incoming'
  onStatus: (status: CallStatus) => void
  onLocalStream: (stream: MediaStream) => void
  onRemoteStream: (stream: MediaStream) => void
}

export class ActiveCallSession {
  private readonly options: ActiveCallOptions
  private channel: RealtimeChannel | null = null
  private peerConnection: RTCPeerConnection | null = null
  private localStream: MediaStream | null = null
  private remoteStream = new MediaStream()
  private pendingCandidates: RTCIceCandidateInit[] = []
  private ringTimeout: number | null = null
  private finished = false
  private currentStatus: CallStatus = 'ringing'
  private channelReady = false
  private channelJoined: Promise<void> | null = null
  private pendingBroadcasts: Array<{ event: string; payload: Record<string, unknown> }> = []

  readonly callId: string
  readonly conversationId: string
  readonly peerUserId: string
  readonly peerName: string
  readonly mode: CallMode
  readonly direction: 'outgoing' | 'incoming'

  constructor(options: ActiveCallOptions, callId: string) {
    this.options = options
    this.callId = callId
    this.conversationId = options.conversationId
    this.peerUserId = options.peerUserId
    this.peerName = options.peerName
    this.mode = options.mode
    this.direction = options.direction
  }

  // --- Публичное API -------------------------------------------------------

  /** Инициатор: разбудить собеседника (broadcast invite в его inbox). */
  async startOutgoing(fromName: string): Promise<void> {
    this.joinChannel()
    this.setStatus('ringing')
    this.ringTimeout = window.setTimeout(() => {
      if (!this.finished && this.direction === 'outgoing' && this.currentStatus === 'ringing') {
        this.broadcast('nexora-call-end', {})
        this.finish('missed')
      }
    }, RING_TIMEOUT_MS)

    const client = requireClient()
    const inbox = client.channel(inboxChannelName(this.peerUserId))
    await new Promise<void>((resolve) => {
      inbox.subscribe((status) => {
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') resolve()
      })
    })
    inbox.send({
      type: 'broadcast',
      event: 'nexora-call-invite',
      payload: {
        callId: this.callId,
        conversationId: this.conversationId,
        mode: this.mode,
        fromUserId: this.options.userId,
        fromName,
      } satisfies InvitePayload,
    })
    // Inbox-канал нужен только для доставки приглашения.
    window.setTimeout(() => { void client.removeChannel(inbox) }, 1500)
    void this.persistSession()
  }

  /** Получатель нажал «Ответить». */
  async answer(): Promise<void> {
    this.joinChannel()
    // Ждём SUBSCRIBED, иначе accept потеряется (Realtime не доставляет send() до подписки).
    await this.channelJoined
    this.setStatus('connecting')
    this.broadcast('nexora-call-accept', { userId: this.options.userId })
    try {
      await this.setupPeerConnection()
    } catch {
      this.broadcast('nexora-call-end', {})
      this.finish('failed')
    }
  }

  /** Инициатор получил «accept» — создаём offer. */
  async createOffer(): Promise<void> {
    this.setStatus('connecting')
    try {
      await this.setupPeerConnection()
      const offer = await this.requirePc().createOffer()
      await this.requirePc().setLocalDescription(offer)
      this.broadcast('nexora-call-offer', { sdp: offer.sdp })
    } catch {
      this.broadcast('nexora-call-end', {})
      this.finish('failed')
    }
  }

  hangup(): void {
    if (this.finished) return
    this.broadcast('nexora-call-end', {})
    this.finish(this.direction === 'outgoing' && this.currentStatus === 'ringing' ? 'canceled' : 'ended')
  }

  /** Отклонить «занято», если уже идёт другой разговор. */
  decline(): void {
    this.broadcast('nexora-call-decline', {})
    this.finish('declined')
  }

  setMicEnabled(enabled: boolean): void {
    this.localStream?.getAudioTracks().forEach((track) => { track.enabled = enabled })
  }

  setCameraEnabled(enabled: boolean): void {
    this.localStream?.getVideoTracks().forEach((track) => { track.enabled = enabled })
  }

  destroy(): void {
    this.cleanupPeer()
    this.cleanupChannel()
    this.finished = true
  }

  // --- Внутреннее ----------------------------------------------------------

  private setStatus(status: CallStatus): void {
    this.currentStatus = status
    this.options.onStatus(status)
  }

  private broadcast(event: string, payload: Record<string, unknown>): void {
    if (!this.channel) return
    // До SUBSCRIBED сообщения Realtime теряются — ставим в очередь.
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

  private joinChannel(): void {
    if (this.channel) return
    const client = requireClient()
    this.channelJoined = new Promise<void>((resolve) => {
      const channel = client
        .channel(callChannelName(this.callId))
        .on('broadcast', { event: 'nexora-call-accept' }, (payload) => {
          if (this.direction !== 'outgoing' || this.finished) return
          const data = payload.payload as { userId?: string } | undefined
          if (data?.userId !== this.peerUserId) return
          this.clearRingTimeout()
          void this.createOffer()
        })
        .on('broadcast', { event: 'nexora-call-offer' }, async (payload) => {
          if (this.direction !== 'incoming' || this.finished) return
          const data = payload.payload as { sdp?: string } | undefined
          if (!data?.sdp) return
          const pc = this.peerConnection
          if (!pc || pc.signalingState !== 'stable') return
          await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp })
          await this.flushCandidates()
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          this.broadcast('nexora-call-answer', { sdp: answer.sdp })
        })
        .on('broadcast', { event: 'nexora-call-answer' }, async (payload) => {
          if (this.direction !== 'outgoing' || this.finished) return
          const data = payload.payload as { sdp?: string } | undefined
          if (!data?.sdp) return
          await this.peerConnection?.setRemoteDescription({ type: 'answer', sdp: data.sdp })
          await this.flushCandidates()
        })
        .on('broadcast', { event: 'nexora-call-ice' }, async (payload) => {
          const data = payload.payload as { candidate?: RTCIceCandidateInit } | undefined
          if (!data?.candidate) return
          if (this.peerConnection?.remoteDescription) {
            await this.peerConnection.addIceCandidate(data.candidate).catch(() => {})
          } else {
            this.pendingCandidates.push(data.candidate)
          }
        })
        .on('broadcast', { event: 'nexora-call-end' }, () => {
          if (!this.finished) this.finish('ended')
        })
        .on('broadcast', { event: 'nexora-call-decline' }, () => {
          if (this.direction === 'outgoing' && !this.finished) this.finish('declined')
        })
        .on('broadcast', { event: 'nexora-call-busy' }, () => {
          if (this.direction === 'outgoing' && !this.finished) this.finish('busy')
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            this.channelReady = true
            this.flushPendingBroadcasts()
            resolve()
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            // Не вешаем answer() навсегда — сигналку всё равно не доставить.
            resolve()
          }
        })
      this.channel = channel
    })
  }

  private async setupPeerConnection(): Promise<void> {
    if (this.peerConnection) return
    const stream = await navigator.mediaDevices.getUserMedia(
      this.mode === 'video' ? { audio: true, video: true } : { audio: true },
    )
    this.localStream = stream
    this.options.onLocalStream(stream)

    const pc = new RTCPeerConnection(ICE_CONFIGURATION)
    this.peerConnection = pc

    stream.getTracks().forEach((track) => pc.addTrack(track, stream))
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.broadcast('nexora-call-ice', { candidate: event.candidate.toJSON() })
      }
    }
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
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected' && this.currentStatus !== 'connected') {
        this.setStatus('connected')
        void this.persistParticipant()
      }
      if (pc.connectionState === 'failed' && !this.finished) {
        this.finish('failed')
      }
    }
  }

  private requirePc(): RTCPeerConnection {
    if (!this.peerConnection) throw new Error('PeerConnection не инициализирован')
    return this.peerConnection
  }

  private async flushCandidates(): Promise<void> {
    const pc = this.peerConnection
    if (!pc) return
    const candidates = this.pendingCandidates.splice(0)
    for (const candidate of candidates) {
      await pc.addIceCandidate(candidate).catch(() => {})
    }
  }

  private async persistSession(): Promise<void> {
    try {
      await requireClient()
        .from('call_sessions')
        .insert({
          id: this.callId,
          conversation_id: this.conversationId,
          created_by: this.options.userId,
          mode: this.mode,
          status: 'active',
        })
    } catch {
      // Журнал звонков не критичен для соединения.
    }
  }

  private async persistParticipant(): Promise<void> {
    try {
      await requireClient()
        .from('call_participants')
        .insert({ call_id: this.callId, user_id: this.options.userId, is_camera_on: this.mode === 'video' })
    } catch {
      // Не критично.
    }
  }

  private async persistFinish(status: CallStatus): Promise<void> {
    if (this.direction !== 'outgoing') return
    try {
      const dbStatus = status === 'missed' || status === 'canceled' ? 'missed' : 'ended'
      await requireClient()
        .from('call_sessions')
        .update({ ended_at: new Date().toISOString(), status: dbStatus })
        .eq('id', this.callId)
    } catch {
      // Не критично.
    }
  }

  private finish(status: CallStatus): void {
    if (this.finished) return
    this.finished = true
    this.clearRingTimeout()
    this.setStatus(status === 'canceled' ? 'ended' : status)
    void this.persistFinish(status)
    this.cleanupPeer()
    this.cleanupChannel()
  }

  private clearRingTimeout(): void {
    if (this.ringTimeout !== null) {
      window.clearTimeout(this.ringTimeout)
      this.ringTimeout = null
    }
  }

  private cleanupPeer(): void {
    this.localStream?.getTracks().forEach((track) => track.stop())
    this.localStream = null
    this.peerConnection?.close()
    this.peerConnection = null
    this.remoteStream.getTracks().forEach((track) => track.stop())
    this.remoteStream = new MediaStream()
  }

  private cleanupChannel(): void {
    if (this.channel) {
      void requireClient().removeChannel(this.channel)
      this.channel = null
    }
  }
}

// ----------------------------------------------------------------------------
// Фабрики вызовов
// ----------------------------------------------------------------------------

export const startOutgoingCall = (
  options: Omit<ActiveCallOptions, 'direction'>,
  fromName: string,
): ActiveCallSession => {
  const callId = crypto.randomUUID()
  const session = new ActiveCallSession({ ...options, direction: 'outgoing' }, callId)
  void session.startOutgoing(fromName)
  return session
}

export const acceptIncomingCall = (
  info: IncomingCallInfo,
  userId: string,
  handlers: {
    onStatus: (status: CallStatus) => void
    onLocalStream: (stream: MediaStream) => void
    onRemoteStream: (stream: MediaStream) => void
  },
): ActiveCallSession => {
  const session = new ActiveCallSession(
    {
      userId,
      conversationId: info.conversationId,
      peerUserId: info.fromUserId,
      peerName: info.fromName,
      mode: info.mode,
      direction: 'incoming',
      ...handlers,
    },
    info.callId,
  )
  void session.answer()
  return session
}

/** Отклонить входящий вызов без подключения медиа (busy или decline). */
export const rejectIncomingCall = (info: IncomingCallInfo, kind: 'busy' | 'decline'): void => {
  const client = requireClient()
  const channel = client.channel(callChannelName(info.callId))
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      channel.send({ type: 'broadcast', event: `nexora-call-${kind}`, payload: {} })
      window.setTimeout(() => { void client.removeChannel(channel) }, 1500)
    }
  })
}

export interface CallHistoryEntry {
  id: string
  conversationId: string
  mode: CallMode
  status: string
  startedAt: string
  endedAt: string | null
  createdBy: string | null
}

// История звонков (RLS: только участники переписок).
export const loadCallHistory = async (conversationIds: string[]): Promise<CallHistoryEntry[]> => {
  if (!conversationIds.length) return []
  const { data, error } = await requireClient()
    .from('call_sessions')
    .select('id,conversation_id,mode,status,started_at,ended_at,created_by')
    .in('conversation_id', conversationIds)
    .order('started_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return (data ?? []).map((row: {
    id: string
    conversation_id: string
    mode: string
    status: string
    started_at: string
    ended_at: string | null
    created_by: string | null
  }) => ({
    id: row.id,
    conversationId: row.conversation_id,
    mode: row.mode === 'audio' ? 'audio' : 'video',
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdBy: row.created_by,
  }))
}
