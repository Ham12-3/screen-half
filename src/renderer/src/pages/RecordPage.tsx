import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_LAYOUT,
  type CaptureSource,
  type Meta,
  type ProjectFile,
  type RecordingPaths
} from '@shared/types'
import {
  captureScreen,
  recordScreen,
  streamSize
} from '../recording/screenRecorder'
import {
  captureWebcam,
  listDevices,
  recordWebcam
} from '../recording/webcamRecorder'
import type { ActiveRecorder } from '../recording/recorder'

interface Props {
  onRecorded: (project: ProjectFile) => void
}

const FPS = 30

// Recording costs ~8 GB/hour (12 Mbps screen + 6 Mbps webcam). Warn once
// free space drops below roughly an hour of headroom.
const LOW_DISK_BYTES = 8 * 1024 ** 3

type Phase = 'idle' | 'recording' | 'saving'

export function RecordPage({ onRecorded }: Props): JSX.Element {
  const [sources, setSources] = useState<CaptureSource[]>([])
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [sourceId, setSourceId] = useState<string>('')
  const [cameraId, setCameraId] = useState<string>('')
  const [micId, setMicId] = useState<string>('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  const webcamPreviewRef = useRef<HTMLVideoElement>(null)
  const screenRecRef = useRef<ActiveRecorder | null>(null)
  const webcamRecRef = useRef<ActiveRecorder | null>(null)
  const sessionRef = useRef<RecordingPaths | null>(null)
  const screenHandleRef = useRef<number | null>(null)
  const webcamHandleRef = useRef<number | null>(null)
  const diskTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const screenSizeRef = useRef<{ width: number; height: number }>({
    width: 1920,
    height: 1080
  })
  const webcamSizeRef = useRef<{ width: number; height: number }>({
    width: 1280,
    height: 720
  })
  const sourceRef = useRef<CaptureSource | null>(null)
  const t0Ref = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refreshDevices = useCallback(async () => {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      })
      probe.getTracks().forEach((t) => t.stop())
    } catch {
      /* user can still pick a source-only recording */
    }
    const { cameras: c, mics: m } = await listDevices()
    setCameras(c)
    setMics(m)
    if (c[0]) setCameraId((v) => v || c[0].deviceId)
    if (m[0]) setMicId((v) => v || m[0].deviceId)
  }, [])

  useEffect(() => {
    window.api
      .getSources()
      .then((list) => {
        setSources(list)
        const def =
          list.find((s) => s.kind === 'screen' && s.display?.isPrimary) ??
          list.find((s) => s.kind === 'screen') ??
          list[0]
        if (def) setSourceId(def.sourceId)
      })
      .catch((e) => setError(String(e)))
    void refreshDevices()
  }, [refreshDevices])

  const primaryDisplayId = useCallback((): number => {
    const scr =
      sources.find((s) => s.kind === 'screen' && s.display?.isPrimary) ??
      sources.find((s) => s.kind === 'screen')
    return scr?.display?.displayId ?? 0
  }, [sources])

  const checkDisk = useCallback(async () => {
    try {
      const free = await window.api.getFreeDiskBytes()
      if (free < LOW_DISK_BYTES) {
        setWarning(
          `Low disk space: ${(free / 1024 ** 3).toFixed(1)} GB free. ` +
            'Recording uses ~8 GB/hour and will stop if the disk fills.'
        )
      } else {
        setWarning(null)
      }
    } catch {
      /* probing free space is best-effort — never block recording */
    }
  }, [])

  const stopDiskWatch = useCallback(() => {
    if (diskTimerRef.current) {
      clearInterval(diskTimerRef.current)
      diskTimerRef.current = null
    }
    setWarning(null)
  }, [])

  // Clean up timers if the page unmounts mid-recording.
  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (diskTimerRef.current) clearInterval(diskTimerRef.current)
    },
    []
  )

  const start = useCallback(async () => {
    setError(null)
    void checkDisk()
    const source = sources.find((s) => s.sourceId === sourceId)
    if (!source) {
      setError('Pick a screen or window to record.')
      return
    }
    let screenStream: MediaStream | null = null
    let webcamStream: MediaStream | null = null
    try {
      screenStream = await captureScreen(source, FPS)
      webcamStream = await captureWebcam({
        videoDeviceId: cameraId || undefined,
        audioDeviceId: micId || undefined
      })
      if (webcamPreviewRef.current) {
        webcamPreviewRef.current.srcObject = webcamStream
        void webcamPreviewRef.current.play()
      }

      screenSizeRef.current = streamSize(screenStream)
      const wc = webcamStream.getVideoTracks()[0]?.getSettings()
      webcamSizeRef.current = {
        width: wc?.width ?? 1280,
        height: wc?.height ?? 720
      }
      sourceRef.current = source

      // Create the session and open the on-disk streams up front so every
      // MediaRecorder chunk is written straight to disk — nothing is held
      // in RAM, so recording length is bounded by disk, not memory.
      const session = await window.api.createSession()
      sessionRef.current = session
      const screenHandle = await window.api.recordOpen(session.screenPath)
      screenHandleRef.current = screenHandle
      const webcamHandle = await window.api.recordOpen(session.webcamPath)
      webcamHandleRef.current = webcamHandle

      // Screen sources map the cursor to their own display (exact). Window
      // sources have no bounds, so fall back to the primary display.
      const trackDisplayId =
        source.kind === 'screen' && source.display
          ? source.display.displayId
          : primaryDisplayId()
      const track = await window.api.startInputTracking(
        trackDisplayId,
        session.eventsPath
      )
      t0Ref.current = track.t0EpochMs

      screenRecRef.current = recordScreen(screenStream, (chunk) =>
        window.api.recordAppend(screenHandle, chunk)
      )
      webcamRecRef.current = recordWebcam(webcamStream, (chunk) =>
        window.api.recordAppend(webcamHandle, chunk)
      )

      setPhase('recording')
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000)
      diskTimerRef.current = setInterval(() => void checkDisk(), 20000)
    } catch (e) {
      // Don't leave a half-opened device/stream/session running on failure.
      screenStream?.getTracks().forEach((t) => t.stop())
      webcamStream?.getTracks().forEach((t) => t.stop())
      screenRecRef.current = null
      webcamRecRef.current = null
      if (screenHandleRef.current != null) {
        await window.api.recordClose(screenHandleRef.current).catch(() => {})
        screenHandleRef.current = null
      }
      if (webcamHandleRef.current != null) {
        await window.api.recordClose(webcamHandleRef.current).catch(() => {})
        webcamHandleRef.current = null
      }
      await window.api.stopInputTracking().catch(() => {})
      sessionRef.current = null
      const name = (e as DOMException)?.name
      if (name === 'NotReadableError' || name === 'AbortError') {
        setError(
          'Could not start the camera — it looks like another app is ' +
            'using it (Zoom, Teams, Camera, a browser tab, etc.). Close ' +
            'that app, or unplug/replug the webcam, then try again. You ' +
            'can also pick a different camera above.'
        )
      } else if (name === 'NotAllowedError') {
        setError(
          'Camera/microphone permission was denied. Allow access in ' +
            'Windows Settings → Privacy → Camera, then try again.'
        )
      } else {
        setError(`Could not start capture: ${String(e)}`)
      }
    }
  }, [sources, sourceId, cameraId, micId, primaryDisplayId, checkDisk])

  const stop = useCallback(async () => {
    if (!screenRecRef.current || !webcamRecRef.current) return
    setPhase('saving')
    if (timerRef.current) clearInterval(timerRef.current)
    stopDiskWatch()

    try {
      const source = sourceRef.current
      const session = sessionRef.current
      if (!session) throw new Error('No active recording session')

      // Stop the recorders (final chunk is flushed before this resolves),
      // then close the on-disk streams and the input log.
      await Promise.all([
        screenRecRef.current.stop(),
        webcamRecRef.current.stop()
      ])
      await Promise.all([
        screenHandleRef.current != null
          ? window.api.recordClose(screenHandleRef.current)
          : Promise.resolve(),
        webcamHandleRef.current != null
          ? window.api.recordClose(webcamHandleRef.current)
          : Promise.resolve()
      ])
      // events.json was streamed to disk during recording by the tracker.
      const { eventCount } = await window.api.stopInputTracking()
      const durationMs = Date.now() - t0Ref.current

      const meta: Meta = {
        version: 1,
        sessionId: session.sessionId,
        createdAt: new Date().toISOString(),
        recordingStartEpochMs: t0Ref.current,
        durationMs,
        screen: {
          fileName: 'screen.webm',
          mimeType: screenRecRef.current.mimeType,
          width: screenSizeRef.current.width,
          height: screenSizeRef.current.height,
          fps: FPS
        },
        webcam: {
          fileName: 'webcam.webm',
          mimeType: webcamRecRef.current.mimeType,
          width: webcamSizeRef.current.width,
          height: webcamSizeRef.current.height,
          fps: 30
        },
        sourceKind: source?.kind ?? 'screen',
        display: source?.display,
        inputTracked: eventCount > 0
      }
      await window.api.writeJson(session.metaPath, meta)

      const project: ProjectFile = {
        version: 1,
        sessionId: session.sessionId,
        meta,
        trimInMs: 0,
        trimOutMs: durationMs,
        layout: { ...DEFAULT_LAYOUT },
        zoomSegments: []
      }
      await window.api.writeJson(session.projectPath, project)
      screenRecRef.current = null
      webcamRecRef.current = null
      screenHandleRef.current = null
      webcamHandleRef.current = null
      sessionRef.current = null
      setPhase('idle')
      onRecorded(project)
    } catch (e) {
      setError(`Could not save recording: ${String(e)}`)
      setPhase('idle')
    }
  }, [onRecorded, stopDiskWatch])

  const fmt = (s: number): string =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(
      s % 60
    ).padStart(2, '0')}`

  const screensList = sources.filter((s) => s.kind === 'screen')
  const windowsList = sources.filter((s) => s.kind === 'window')

  const renderGrid = (list: CaptureSource[]): JSX.Element => (
    <div className="srcgrid">
      {list.map((s) => (
        <button
          key={s.sourceId}
          className={`srccard${
            s.sourceId === sourceId ? ' srccard--sel' : ''
          }`}
          disabled={phase !== 'idle'}
          onClick={() => setSourceId(s.sourceId)}
          title={s.name}
        >
          {s.thumbnail ? (
            <img src={s.thumbnail} alt={s.name} />
          ) : (
            <div className="srccard__noimg">{s.kind}</div>
          )}
          <span className="srccard__name">{s.name}</span>
        </button>
      ))}
    </div>
  )

  return (
    <div className="page">
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Record</h2>

        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        {warning && (
          <p style={{ color: 'var(--warn, #d08700)' }}>{warning}</p>
        )}

        <div className="field">
          <label>Screens</label>
          {screensList.length ? (
            renderGrid(screensList)
          ) : (
            <p className="muted">No screens found.</p>
          )}
        </div>

        <div className="field">
          <label>Windows</label>
          {windowsList.length ? (
            renderGrid(windowsList)
          ) : (
            <p className="muted">No windows found.</p>
          )}
        </div>

        <div className="row">
          <div className="field">
            <label>Camera</label>
            <select
              value={cameraId}
              disabled={phase !== 'idle'}
              onChange={(e) => setCameraId(e.target.value)}
            >
              {cameras.length === 0 && <option value="">(none)</option>}
              {cameras.map((c, i) => (
                <option key={c.deviceId} value={c.deviceId}>
                  {c.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Microphone</label>
            <select
              value={micId}
              disabled={phase !== 'idle'}
              onChange={(e) => setMicId(e.target.value)}
            >
              {mics.length === 0 && <option value="">(none)</option>}
              {mics.map((m, i) => (
                <option key={m.deviceId} value={m.deviceId}>
                  {m.label || `Mic ${i + 1}`}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="row" style={{ alignItems: 'center' }}>
          {phase === 'idle' && (
            <button className="primary" onClick={start}>
              ● Start recording
            </button>
          )}
          {phase === 'recording' && (
            <>
              <button className="danger" onClick={stop}>
                ■ Stop
              </button>
              <span className="muted">Recording {fmt(elapsed)}</span>
            </>
          )}
          {phase === 'saving' && (
            <span className="muted">Saving recording…</span>
          )}
        </div>

        <div style={{ marginTop: 16 }}>
          <video
            ref={webcamPreviewRef}
            muted
            playsInline
            style={{
              width: 240,
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: '#000',
              display: phase === 'recording' ? 'block' : 'none'
            }}
          />
        </div>

        <p className="hint">
          Pick a whole screen or a single window, plus webcam + mic. Cursor
          activity is logged for auto-zoom. Screen sources zoom exactly;
          for a window the auto-zoom is approximate — nudge it with the
          focus sliders in the editor if needed.
        </p>
      </div>
    </div>
  )
}
