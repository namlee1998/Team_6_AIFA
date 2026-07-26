// Single SSE transport for the FE.
//
// Responsibilities:
//   - open fetch() with Accept: text/event-stream
//   - parse SSE frames: read `data:` lines, accumulate, blank line → JSON.parse
//   - validate that the parsed object is a canonical EventEnvelope
//   - invoke onEnvelope(envelope)
//   - return an unsubscribe function
//
// No payload conversion. No gate conversion. No compatibility layer.

import { isEnvelope, type EventEnvelope } from '@/dto/event';

export interface SseClientOptions {
  /** Optional Last-Event-ID cursor for reconnect. */
  lastEventId?: number;
  /** Optional abort signal. */
  signal?: AbortSignal;
}

export type Unsubscribe = () => void;

/**
 * Subscribe to `url`. Each canonical envelope read from the stream is passed
 * to `onEnvelope`. Returns an unsubscribe function that aborts the fetch.
 */
export function subscribe(
  url: string,
  onEnvelope: (envelope: EventEnvelope) => void,
  options: SseClientOptions = {},
): Unsubscribe {
  const ctrl = new AbortController();
  if (options.signal) {
    if (options.signal.aborted) ctrl.abort();
    else options.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }

  const headers: Record<string, string> = { Accept: 'text/event-stream' };
  if (Number.isFinite(options.lastEventId) && (options.lastEventId ?? 0) > 0) {
    headers['Last-Event-ID'] = String(options.lastEventId);
  }

  let aborted = false;
  (async () => {
    try {
      const res = await fetch(url, { method: 'GET', headers, signal: ctrl.signal });
      if (!res.ok || !res.body) {
        // Surface the failure so the store can flag connection status.
        // eslint-disable-next-line no-console
        console.warn('[sseClient] non-OK or empty body', { url, status: res.status });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let dataLines: string[] = [];
      let currentId: number | null = null;

      const flush = () => {
        if (dataLines.length === 0) return;
        const text = dataLines.join('\n');
        dataLines = [];
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          // Discard malformed frame; keep the stream open.
          // eslint-disable-next-line no-console
          console.warn('[sseClient] malformed JSON frame', { text: text.slice(0, 200) });
          return;
        }
        if (!isEnvelope(parsed)) {
          // eslint-disable-next-line no-console
          console.warn('[sseClient] frame rejected (not a canonical envelope)');
          return;
        }
        onEnvelope(parsed);
      };

      while (!aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const rawLine = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          // SSE strips trailing CR; trim only the trailing one if present.
          const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
          if (line === '') {
            flush();
            currentId = null;
            continue;
          }
          if (line.startsWith(':')) continue; // comment / heartbeat
          const colon = line.indexOf(':');
          const field = colon === -1 ? line : line.slice(0, colon);
          let value = colon === -1 ? '' : line.slice(colon + 1);
          if (value.startsWith(' ')) value = value.slice(1);
          if (field === 'data') dataLines.push(value);
          else if (field === 'id') {
            const n = Number(value);
            if (Number.isFinite(n)) currentId = n;
          }
          // 'event:' is intentionally ignored — every frame carries the full
          // canonical envelope, including its `type` discriminator.
        }
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      // eslint-disable-next-line no-console
      console.warn('[sseClient] stream error', { url, error: (err as Error).message });
    }
  })();

  return () => {
    aborted = true;
    ctrl.abort();
  };
}