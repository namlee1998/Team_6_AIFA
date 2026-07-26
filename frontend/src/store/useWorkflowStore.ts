/**
 * useWorkflowStore — the SOLE workflow store.
 *
 * Backed by SSE only. Holds one SessionState per sessionId plus coarse
 * connection metadata. NO optimistic mutations after HTTP commands — the
 * backend SSE emits the resulting state change. This is the contract.
 *
 * The reducer is a thin envelope dispatcher; all per-type business mapping
 * lives in store/eventMappers.ts.
 */

import { create } from 'zustand';
import * as sdlcApi from '@/services/api/sdlcApi';
import { subscribe as sseSubscribe } from '@/services/sseClient';
import { getBaseURL } from '@/services/api/client';
import { type SessionState, defaultSessionState } from '@/models/SessionState';
import { applyEnvelope } from '@/store/eventMappers';
import { isEnvelope, type EventEnvelope } from '@/dto/event';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';

export interface WorkflowState {
  // ── Workflow state ──
  sessions: Record<string, SessionState>;
  sseConnections: Record<string, ConnectionStatus>;
  sseAbortControllers: Record<string, AbortController>;

  projectId: string | null;
  isLoading: boolean;

  // ── Actions ──
  startPipeline(projectId: string, repoUrl: string, request: string): Promise<void>;
  setProjectId(id: string | null): void;

  // HTTP commands — DO NOT mutate local state on success; the SSE stream is
  // the authoritative source and will emit the resulting transition.
  resolveGate(sessionId: string, gateId: string, action: 'approve' | 'reject', comment?: string): Promise<void>;
  resolveOutputReviewGate(sessionId: string, gateId: string, action: 'approve' | 'reject', comment?: string): Promise<void>;
  resolveClarification(sessionId: string, gateId: string, answers: Record<string, string>): Promise<void>;
  resolveToolGate(sessionId: string, gateId: string, action: 'approve' | 'reject', comment?: string): Promise<void>;
  releaseDecision(
    sessionId: string,
    decision: 'APPROVE' | 'REJECT',
    comment?: string,
  ): Promise<void>;

  cleanupSession(sessionId: string): void;
  resetAll(): void;

  // ── Internal — invoked by the SSE dispatcher ──
  _subscribeSession(sessionId: string): void;
  _unsubscribeSession(sessionId: string): void;
  _applySseEvent(sessionId: string, envelope: EventEnvelope): void;
}

// ── helpers (pure, kept module-private) ─────────────────────────────────────

// ── store ────────────────────────────────────────────────────────────────────

let lastSeenEnvelopeId: string | null = null;
const seenEnvelopeIds = new Set<string>();
const SEEN_ENVELOPE_LIMIT = 1000;

// Per-session reconnect cursor. Reconnect MUST send Last-Event-ID so the
// server replays only events with sequence > cursor (spec §13.1 step 1,
// §13.4 ordering guarantee).
const lastSeenSequenceBySession = new Map<string, number>();

// Per-session SSE teardown. sseSubscribe returns an unsubscribe function;
// store it here so resetAll / cleanupSession / AbortController.abort() can
// actually close the connection.
const sseUnsubscribeFns = new Map<string, () => void>();

export const useWorkflowStore = create<WorkflowState>((set, get) => {
  const unsubscribe = (sessionId: string) => {
    const ac = get().sseAbortControllers[sessionId];
    if (ac) {
      ac.abort();
    }
    const teardown = sseUnsubscribeFns.get(sessionId);
    if (teardown) {
      teardown();
      sseUnsubscribeFns.delete(sessionId);
    }
    set((s) => {
      const nextConn = { ...s.sseConnections };
      const nextAbort = { ...s.sseAbortControllers };
      delete nextConn[sessionId];
      delete nextAbort[sessionId];
      return { sseConnections: nextConn, sseAbortControllers: nextAbort };
    });
  };

  const openSubscription = (sessionId: string, afterSequence: number) => {
    const baseUrl = getBaseURL().replace(/\/$/, '');
    const url = `${baseUrl}/sdlc/stream/${sessionId}`;

    // sseSubscribe wires the canonical envelope contract directly to the
    // store; the store never sees legacy (event, data) tuples. Forward the
    // reconnect cursor so the server replays only events newer than it.
    const teardown = sseSubscribe(
      url,
      (envelope) => {
        get()._applySseEvent(sessionId, envelope);
      },
      { lastEventId: afterSequence },
    );
    return teardown;
  };

  const subscribe = (sessionId: string) => {
    // If we already have a live subscription, don't open a second one.
    if (get().sseAbortControllers[sessionId]) return;

    set((s) => ({
      sseConnections: { ...s.sseConnections, [sessionId]: 'connecting' },
    }));

    // First-open: no cursor. Reconnect: pass the last seen sequence so the
    // server replays only events with sequence > cursor.
    const afterSequence = lastSeenSequenceBySession.get(sessionId) ?? 0;
    const teardown = openSubscription(sessionId, afterSequence);
    sseUnsubscribeFns.set(sessionId, teardown);

    const abort = new AbortController();
    // Override abort() so callers that invoke `abort.abort()` actually tear
    // down the SSE connection held by sseSubscribe.
    (abort as AbortController & { _teardown?: () => void })._teardown = teardown;
    const wrappedAbort = () => {
      const t = sseUnsubscribeFns.get(sessionId);
      if (t) {
        t();
        sseUnsubscribeFns.delete(sessionId);
      }
      // Mark the AbortController as aborted so callers can introspect.
      try { abort.abort(); } catch { /* noop */ }
    };
    (abort as unknown as { abort: () => void }).abort = wrappedAbort;

    set((s) => ({
      sseAbortControllers: { ...s.sseAbortControllers, [sessionId]: abort },
      sseConnections: { ...s.sseConnections, [sessionId]: 'connected' },
    }));
  };

  return {
    sessions: {},
    sseConnections: {},
    sseAbortControllers: {},
    projectId: null,
    isLoading: false,

    setProjectId: (id) => set({ projectId: id }),

    startPipeline: async (projectId, repoUrl, request) => {
      set({ isLoading: true });
      try {
        const { sessionId, taskId } = await sdlcApi.startPipeline(projectId, repoUrl, request);

        const seed = defaultSessionState({
          sessionId,
          taskId,
          projectId,
          featureRequest: request,
          repoUrl,
        });

        set((s) => ({
          sessions: { ...s.sessions, [sessionId]: seed },
          projectId,
          isLoading: false,
        }));

        // Subscribe to the SSE stream for this session. State mutations
        // happen inside _applySseEvent only.
        get()._subscribeSession(sessionId);
      } catch (err: unknown) {
        const message = (err as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
          || (err instanceof Error ? err.message : 'Failed to start pipeline');
        set({ isLoading: false });
        // Surface the error on every existing session for the project — but
        // only when there is an active attempt. We keep the workflow strictly
        // SSE-driven for runtime data; the error is UI telemetry only.
        // Throw to let the caller show an error toast.
        throw new Error(message);
      }
    },

    resolveGate: async (sessionId, gateId, action, comment) => {
      // Pure HTTP command. NO local mutation — SSE will deliver the resulting
      // gate_resolved event.
      await sdlcApi.resolveGate(gateId, action, comment);
    },

    resolveOutputReviewGate: async (sessionId, gateId, action, comment) => {
      await sdlcApi.resolveOutputReviewGate(gateId, action, comment);
    },

    resolveClarification: async (sessionId, gateId, answers) => {
      await sdlcApi.resolveApproval(gateId, { answers });
    },

    // Tool-gate resolve (HITL_REVIEW / DEV_FILE_GATE, kind='tool'). The
    // backend canonical contract is `POST /approvals/:id` — same endpoint
    // clarification uses; only the body shape differs.
    resolveToolGate: async (sessionId, gateId, action, comment) => {
      await sdlcApi.resolveApproval(gateId, {
        action,
        ...(action === 'reject' ? { comment: comment?.trim() || undefined } : {}),
      });
    },

    releaseDecision: async (sessionId, decision, comment) => {
      const session = get().sessions[sessionId];
      if (!session) return;
      // Producer-side: mint exactly ONE decision_id per user decision
      // invocation (spec §10, idempotency key). Backend validator
      // (releaseManager.js:27) rejects submissions without it. The store
      // owns the user decision workflow; the UI does NOT own idempotency.
      const decisionId = crypto.randomUUID();
      await sdlcApi.releaseDecision(sessionId, decisionId, decision, comment);
    },

    cleanupSession: (sessionId) => {
      get()._unsubscribeSession(sessionId);
      lastSeenSequenceBySession.delete(sessionId);
      set((s) => {
        const next = { ...s.sessions };
        delete next[sessionId];
        return { sessions: next };
      });
    },

    resetAll: () => {
      // Abort all SSE connections.
      const aborts = get().sseAbortControllers;
      Object.values(aborts).forEach((ac) => ac?.abort?.());
      // sseSubscribe owns its own teardown; clear our registry too.
      sseUnsubscribeFns.forEach((t) => t());
      sseUnsubscribeFns.clear();
      lastSeenSequenceBySession.clear();
      set({
        sessions: {},
        sseConnections: {},
        sseAbortControllers: {},
        projectId: null,
        isLoading: false,
      });
    },

    // ── internal ──
    _subscribeSession: subscribe,
    _unsubscribeSession: unsubscribe,

    _applySseEvent: (sessionId, envelope) => {
      // Transport contract: only canonical EventEnvelope is accepted here.
      if (!isEnvelope(envelope)) return;

      // Replay dedup — AgentEvent stores full envelopes, so on reconnect the
      // server may resend an envelope the client already applied live.
      if (seenEnvelopeIds.has(envelope.id)) return;
      seenEnvelopeIds.add(envelope.id);
      lastSeenEnvelopeId = envelope.id;
      if (seenEnvelopeIds.size > SEEN_ENVELOPE_LIMIT) {
        // Bound the dedup set — drop the oldest entry. (Insertion order is
        // preserved in JS Sets.)
        const first = seenEnvelopeIds.values().next().value;
        if (first !== undefined) seenEnvelopeIds.delete(first);
      }

      // Track the highest seen sequence per session for reconnect. Sequence
      // is the canonical ordering metadata (spec §13.4) — the reconnect
      // cursor sent as Last-Event-ID comes from this map.
      const prevSeq = lastSeenSequenceBySession.get(sessionId) ?? 0;
      if (Number.isFinite(envelope.sequence) && envelope.sequence > prevSeq) {
        lastSeenSequenceBySession.set(sessionId, envelope.sequence);
      }

      const session = get().sessions[sessionId];
      if (!session) return;

      set((s) => {
        const current = s.sessions[sessionId];
        if (!current) return {} as Partial<WorkflowState>;
        return {
          sessions: { ...s.sessions, [sessionId]: applyEnvelope(current, envelope) },
        };
      });
    },
  };
});

// ── selector helpers (use with useWorkflowStore(s => ...)) ──

export const selectAllSessions = (s: WorkflowState): SessionState[] =>
  Object.values(s.sessions);

export const selectActiveSessionId = (s: WorkflowState): string | null =>
  // The UI store is the actual source of active session, but a quick
  // fallback returns the latest session if none chosen yet. The actual
  // default lives in useUiStore — callers should compose selectors.
  null;

export const selectAllPendingGates = (s: WorkflowState) =>
  Object.values(s.sessions).flatMap((sess) => sess.pendingGates);

export const selectConnectionStatus = (s: WorkflowState) =>
  Object.values<ConnectionStatus>(s.sseConnections).every((c) => c === 'idle')
    ? ('idle' as ConnectionStatus)
    : Object.values<ConnectionStatus>(s.sseConnections).some((c) => c === 'connected')
      ? ('connected' as ConnectionStatus)
      : ('error' as ConnectionStatus);
