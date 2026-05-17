/** Shared MediaRecorder wrapper: start on construction, resolve a Blob on stop. */
export interface ActiveRecorder {
  stream: MediaStream
  mimeType: string
  stop: () => Promise<Blob>
}

function pickMimeType(candidates: string[]): string {
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c
  }
  return ''
}

export function startRecorder(
  stream: MediaStream,
  candidates: string[],
  bitsPerSecond: number
): ActiveRecorder {
  const mimeType = pickMimeType(candidates)
  const rec = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: bitsPerSecond
  })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  rec.start(1000)

  return {
    stream,
    mimeType: mimeType || 'video/webm',
    stop: () =>
      new Promise<Blob>((resolve) => {
        rec.onstop = () =>
          resolve(new Blob(chunks, { type: mimeType || 'video/webm' }))
        rec.stop()
        stream.getTracks().forEach((t) => t.stop())
      })
  }
}
