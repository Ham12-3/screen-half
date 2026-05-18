/** Build a URL for the sandboxed `recording://` protocol served by main. */
export function recordingUrl(sessionId: string, file: string): string {
  return `recording://${encodeURIComponent(sessionId)}/${file}`
}
