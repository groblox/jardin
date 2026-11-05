/** Clock time in the garden's own time zone (falls back to the browser's). */
export function fmtTime(t: number, timeZone?: string): string {
  try {
    return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone });
  } catch {
    return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
}
