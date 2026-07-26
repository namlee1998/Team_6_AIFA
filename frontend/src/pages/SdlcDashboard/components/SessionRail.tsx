import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Archive, ArchiveRestore, Layers, GitFork } from 'lucide-react';
import { useWorkflowStore, type ConnectionStatus } from '@/store/useWorkflowStore';
import { useUiStore } from '@/store/useUiStore';
import { AGENT_KEYS, type SessionState } from '@/models/SessionState';
import {
  countCompletedAgents,
  selectAgentPhaseStatus,
  getRuntimeVisual,
} from '@/store/runtimeSelectors';

// OBS-01.10 R-15: removed the local `PHASE_DOT_COLORS` map. The canonical
// runtime selector (`runtimeSelectors.ts`) is the SINGLE source of colour
// mapping per the canonical runtime contract §5.2.2 cross-page identity
// invariant and §7 forbidden pattern "Duplicated CSS mapping". Per-agent
// dots now consume `getRuntimeVisual(status).background` (the same value
// the Dashboard pipeline strip and the Agent Task card border use).

const STATUS_LABEL: Record<SessionState['status'], string> = {
  pending: 'Pending',
  running: 'Running',
  awaiting_approval: 'Awaiting',
  awaiting_release: 'Awaiting Release',
  completed: 'Done',
  failed: 'Failed',
};

const STATUS_BADGE: Record<SessionState['status'], string> = {
  pending: 'bg-surface-container-high/60 text-on-surface-variant',
  running: 'bg-blue-500/15 text-blue-400',
  awaiting_approval: 'bg-amber-500/15 text-amber-400',
  awaiting_release: 'bg-amber-500/15 text-amber-400',
  completed: 'bg-emerald-500/15 text-emerald-400',
  failed: 'bg-error/15 text-error',
};

export interface SessionBrowserEntry {
  session: SessionState;
  active: boolean;
}

interface SessionRailProps {
  onNewSession: () => void;
}

export function SessionRail({ onNewSession }: SessionRailProps) {
  const navigate = useNavigate();
  const sessionsMap = useWorkflowStore((s) => s.sessions);
  const sseConnections = useWorkflowStore((s) => s.sseConnections);
  const activeSessionId = useUiStore((s) => s.activeSessionId);
  const setActiveSession = useUiStore((s) => s.setActiveSession);
  const query = useUiStore((s) => s.sessionBrowserQuery);
  const setQuery = useUiStore((s) => s.setSessionBrowserQuery);
  const showArchived = useUiStore((s) => s.showArchivedSessions);
  const setShowArchived = useUiStore((s) => s.setShowArchivedSessions);

  const allSessions = useMemo(() => Object.values(sessionsMap), [sessionsMap]);

  const visibleSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allSessions
      .filter((sess) => (showArchived ? true : sess.status !== 'completed' && sess.status !== 'failed'))
      .filter((sess) => (q ? sess.featureRequest.toLowerCase().includes(q) : true))
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [allSessions, query, showArchived]);

  const onSelect = (sessionId: string) => {
    setActiveSession(sessionId);
    navigate(`/sdlc/build?sessionId=${sessionId}`);
  };

  return (
    <aside className="flex h-full w-full min-w-0 flex-col gap-3 border-r border-outline-variant/40 bg-surface-container-lowest px-3 py-4">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.16em] text-on-surface-variant/70">Sessions</h2>
        <button
          onClick={onNewSession}
          className="flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary transition-colors hover:bg-primary/20"
        >
          <Plus size={11} />
          New
        </button>
      </div>

      <div className="relative px-1">
        <Search size={12} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/60" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search feature requests…"
          className="w-full rounded-md border border-outline-variant/40 bg-surface-container py-1.5 pl-8 pr-2 text-[11px] text-on-surface placeholder:text-on-surface-variant/40 focus:border-primary/40 focus:outline-none"
        />
      </div>

      <button
        onClick={() => setShowArchived(!showArchived)}
        className="flex items-center gap-2 self-start rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/70 transition-colors hover:bg-surface-container"
      >
        {showArchived ? <ArchiveRestore size={11} /> : <Archive size={11} />}
        {showArchived ? 'Hide archived' : 'Show archived'}
      </button>

      <div className="-mx-1 flex-1 overflow-y-auto px-1">
        {visibleSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-outline-variant/30 px-3 py-8 text-center text-[11px] text-on-surface-variant">
            <Layers size={20} className="opacity-60" />
            <span>No sessions yet</span>
            <button onClick={onNewSession} className="text-[10px] font-bold text-primary hover:underline">
              Start a feature request
            </button>
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {visibleSessions.map((sess) => (
              <SessionCard
                key={sess.sessionId}
                session={sess}
                active={sess.sessionId === activeSessionId}
                connectionStatus={sseConnections[sess.sessionId] ?? 'idle'}
                onSelect={() => onSelect(sess.sessionId)}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function SessionCard({
  session,
  active,
  connectionStatus,
  onSelect,
}: {
  session: SessionState;
  active: boolean;
  connectionStatus: ConnectionStatus;
  onSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // Read the completed-phase count through the canonical selector.
  // The selector is the single owner of runtime state; no consumer
  // may compute `session.pipelinePhases.filter(...).length`
  // directly (canonical runtime contract §7).
  const completedPhases = countCompletedAgents(session);
  const progress = (completedPhases / 5) * 100;
  const pendingCount = session.pendingGates.length;

  return (
    <li>
      <button
        onClick={onSelect}
        onDoubleClick={() => setExpanded((v) => !v)}
        className={`group flex w-full flex-col gap-2 rounded-lg border px-3 py-2.5 text-left transition-all ${
          active
            ? 'border-primary/40 bg-primary/10 shadow-[0_0_0_1px_rgba(99,102,241,0.35)]'
            : 'border-outline-variant/30 bg-surface-container hover:border-outline/60'
        }`}
      >
        <div className="flex items-start justify-between gap-1">
          <span className="flex-1 truncate text-[11.5px] font-semibold text-on-surface" title={session.featureRequest}>
            {session.featureRequest || 'Untitled'}
          </span>
          <ConnectionDot status={connectionStatus} />
        </div>

        <div className="flex items-center justify-between text-[9px] text-on-surface-variant/60">
          <span className={`rounded-full px-1.5 py-0.5 font-bold uppercase tracking-wider ${STATUS_BADGE[session.status]}`}>
            {STATUS_LABEL[session.status]}
          </span>
          <span>
            {completedPhases}/5 agents
          </span>
        </div>

        <div className="h-1 w-full overflow-hidden rounded-full bg-surface-container-high/40">
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>

        <div className="grid grid-cols-5 gap-1">
          {AGENT_KEYS.map((k) => {
            // Read the per-agent status through the canonical
            // selector. The selector is the single source of
            // runtime state; this consumer MUST NOT read
            // session.pipelinePhases directly.
            const status = selectAgentPhaseStatus(session, k);
            // OBS-01.10 R-15: dots consume the canonical runtime visual
            // (the same source Dashboard pipeline strip and Agent Task
            // card border use). Cross-page identity is enforced by
            // construction per contract §5.2.2.
            const dotClass = getRuntimeVisual(status).background;
            return (
              <span
                key={k}
                className={`flex items-center justify-center rounded text-[8px] font-bold ${dotClass}`}
                title={`${k} · ${status}`}
              >
                {k}
              </span>
            );
          })}
        </div>

        {pendingCount > 0 && (
          <div className="flex items-center justify-between text-[10px] text-amber-400">
            <span className="font-semibold">{pendingCount} pending gate{pendingCount > 1 ? 's' : ''}</span>
            <GitFork size={10} />
          </div>
        )}

        {expanded && (
          <div className="text-[10px] text-on-surface-variant/80">
            session <code className="font-mono">{session.sessionId.slice(0, 12)}…</code>
          </div>
        )}
      </button>
    </li>
  );
}

function ConnectionDot({ status }: { status: ConnectionStatus }) {
  if (status === 'connected') {
    return <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" title="SSE connected" />;
  }
  if (status === 'connecting') {
    return <span className="h-1.5 w-1.5 animate-spin rounded-full bg-blue-500" title="Connecting" />;
  }
  if (status === 'error') {
    return <span className="h-1.5 w-1.5 rounded-full bg-error" title="Connection error" />;
  }
  return <span className="h-1.5 w-1.5 rounded-full bg-on-surface-variant/30" title="Idle" />;
}
