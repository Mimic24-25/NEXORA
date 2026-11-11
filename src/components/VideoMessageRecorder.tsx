import { Send, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

interface VideoMessageRecorderProps {
  onSend: (blob: Blob, mimeType: string) => void
  onCancel: () => void
}

const MAX_DURATION_SECONDS = 60

export function VideoMessageRecorder({ onSend, onCancel }: VideoMessageRecorderProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const previewVideoRef = useRef<HTMLVideoElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const sendOnStopRef = useRef(false)
  const timerRef = useRef<number | null>(null)

  const [phase, setPhase] = useState<'requesting' | 'recording' | 'preview' | 'error'>('requesting')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const cleanup = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => {
    const initCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } },
          audio: true,
        })
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
        setPhase('recording')
        startRecording(stream)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'NotAllowedError') {
          setError('Доступ к камере запрещён. Разрешите доступ в настройках браузера.')
        } else if (err instanceof DOMException && err.name === 'NotFoundError') {
          setError('Камера не найдена.')
        } else {
          setError('Не удалось включить камеру.')
        }
        setPhase('error')
      }
    }

    void initCamera()
    return cleanup
  }, [cleanup])

  const startRecording = (stream: MediaStream) => {
    const videoTrack = stream.getVideoTracks()[0]
    const settings = videoTrack?.getSettings()
    const isSquare = settings && settings.width === settings.height
    if (!isSquare && videoTrack && settings) {
      const size = Math.min(settings.width ?? 480, settings.height ?? 480)
      const crop = { left: 0, top: 0, width: size, height: size }
      const track = stream.getVideoTracks()[0]
      try {
        track.applyConstraints({ advanced: [{ cropTarget: [crop.left, crop.top] } as MediaTrackConstraintSet] })
      } catch {
        // cropTarget не поддерживается — используем CSS clip
      }
    }

    const mimeType = MediaRecorder.isTypeSupported('video/mp4')
      ? 'video/mp4'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? 'video/webm;codecs=vp8,opus'
        : MediaRecorder.isTypeSupported('video/webm')
          ? 'video/webm'
          : ''

    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    mediaRecorderRef.current = recorder
    chunksRef.current = []

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    recorder.onstop = () => {
      const actualType = recorder.mimeType || 'video/webm'
      const blob = new Blob(chunksRef.current, { type: actualType })

      if (sendOnStopRef.current) {
        sendOnStopRef.current = false
        cleanup()
        onSend(blob, actualType)
        onCancel()
        return
      }

      setPreviewUrl(URL.createObjectURL(blob))
      setPhase('preview')
      cleanup()
    }

    recorder.start()

    timerRef.current = window.setInterval(() => {
      setElapsed((prev) => {
        if (prev + 1 >= MAX_DURATION_SECONDS) {
          stopRecording()
          return MAX_DURATION_SECONDS
        }
        return prev + 1
      })
    }, 1000)
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const handleSend = () => {
    if (!previewUrl) return
    fetch(previewUrl)
      .then((res) => res.blob())
      .then((blob) => {
        onSend(blob, blob.type || 'video/webm')
        cleanup()
      })
  }

  const handleSendWhileRecording = () => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    sendOnStopRef.current = true
    stopRecording()
  }

  const handleRetake = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setPhase('requesting')
    setElapsed(0)

    const initCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } },
          audio: true,
        })
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
        setPhase('recording')
        startRecording(stream)
      } catch {
        setError('Не удалось включить камеру.')
        setPhase('error')
      }
    }
    void initCamera()
  }

  const handleCancel = () => {
    sendOnStopRef.current = false
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    cleanup()
    onCancel()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="relative w-full max-w-sm">
        {/* Timer */}
        {phase === 'recording' ? (
          <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full bg-red-500 px-4 py-1 text-sm font-medium text-white">
            {Math.floor(elapsed / 60)}:{(elapsed % 60).toString().padStart(2, '0')}
          </div>
        ) : null}

        {/* Cancel button */}
        <button
          onClick={handleCancel}
          className="absolute right-2 top-2 z-10 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
        >
          <X size={20} />
        </button>

        {phase === 'error' ? (
          <div className="rounded-2xl bg-slate-900 p-6 text-center">
            <p className="text-sm text-red-300">{error}</p>
            <button onClick={handleCancel} className="mt-4 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950">
              Закрыть
            </button>
          </div>
        ) : phase === 'preview' && previewUrl ? (
          <div className="flex flex-col items-center gap-4">
            <div className="relative aspect-square w-64 overflow-hidden rounded-full border-4 border-cyan-500/50">
              <video
                ref={previewVideoRef}
                src={previewUrl}
                autoPlay
                loop
                playsInline
                className="h-full w-full object-cover"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleRetake}
                className="rounded-full bg-white/10 p-3 text-white hover:bg-white/20"
                title="Переснять"
              >
                <Trash2 size={20} />
              </button>
              <button
                onClick={handleSend}
                className="rounded-full bg-cyan-500 p-3 text-slate-950 hover:bg-cyan-400"
                title="Отправить"
              >
                <Send size={20} />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div className="relative aspect-square w-64 overflow-hidden rounded-full border-4 border-red-500/50">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full object-cover"
              />
            </div>
            {phase === 'requesting' ? (
              <p className="text-sm text-slate-300">Включаем камеру…</p>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <p className="text-sm text-slate-400">Запись видео…</p>
                <button
                  type="button"
                  onClick={handleSendWhileRecording}
                  className="inline-flex items-center gap-2 rounded-full bg-cyan-500 px-6 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-cyan-500/20 transition hover:bg-cyan-400"
                >
                  <Send size={16} />
                  Отправить
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
