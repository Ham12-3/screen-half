/**
 * Shared MediaRecorder wrapper. Each chunk is handed to `onChunk` the moment
 * it is produced (which streams it to disk) — nothing is buffered in memory,
 * so recording length is bounded by disk, not RAM. `stop()` resolves once the
 * final chunk has been flushed.
 */
export interface ActiveRecorder {
  stream: MediaStream
  mimeType: string
  stop: () => Promise<void>
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
  bitsPerSecond: number,
  onChunk: (chunk: ArrayBuffer) => Promise<void>
): ActiveRecorder {
  const mimeType = pickMimeType(candidates)
  const rec = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: bitsPerSecond
  })

  // Serialize chunk writes: each ondataavailable extends the chain, so chunks
  // hit disk strictly in arrival order and the next chunk isn't read until the
  // previous write has completed (disk backpressure → flat memory).
  let chain: Promise<void> = Promise.resolve()
  let chainErr: unknown = null

  rec.ondataavailable = (e) => {
    if (e.data.size === 0) return
    const blob = e.data
    chain = chain.then(async () => {
      if (chainErr) return
      try {
        await onChunk(await blob.arrayBuffer())
      } catch (err) {
        chainErr = err
      }
    })
  }
  rec.start(1000)

  return {
    stream,
    mimeType: mimeType || 'video/webm',
    stop: () =>
      new Promise<void>((resolve, reject) => {
        rec.onstop = () => {
          // onstop fires after the final ondataavailable, so awaiting the
          // chain here guarantees every chunk is on disk.
          chain.then(() =>
            chainErr ? reject(chainErr) : resolve()
          )
        }
        rec.stop()
        stream.getTracks().forEach((t) => t.stop())
      })
  }
}
