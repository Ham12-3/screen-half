import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'

// In a packaged app the binary lives in app.asar.unpacked, but ffmpeg-static
// reports the in-asar path — rewrite it so the binary is actually runnable.
if (ffmpegStatic) {
  const bin = (ffmpegStatic as unknown as string).replace(
    'app.asar',
    'app.asar.unpacked'
  )
  ffmpeg.setFfmpegPath(bin)
}

/**
 * Mux a video-only stream and an audio-only stream into one MP4.
 * Used at export to attach the recorded mic track to the rendered
 * (silent) WebCodecs video. Streams are copied where possible; audio is
 * re-encoded to AAC for MP4 compatibility.
 */
export function muxAudioToMp4(args: {
  videoPath: string
  audioPath: string
  outPath: string
}): Promise<string> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(args.videoPath)
      .input(args.audioPath)
      .outputOptions([
        '-map',
        '0:v:0',
        '-map',
        '1:a:0?',
        '-c:v',
        'copy',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-shortest',
        '-movflags',
        '+faststart'
      ])
      .on('end', () => resolve(args.outPath))
      .on('error', (err) => reject(err))
      .save(args.outPath)
  })
}
