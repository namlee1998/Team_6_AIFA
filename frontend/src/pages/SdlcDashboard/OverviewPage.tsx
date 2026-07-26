import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity, Clock, GitFork, AlertCircle, CheckCircle2, XCircle, Loader2,
  ChevronRight, MessageSquare, Shield, FileCheck2, Rocket, Layers,
} from 'lucide-react';
import { useUiStore, type InspectorTab } from '@/store/useUiStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import { AGENT_KEYS, type SessionState } from '@/models/SessionState';
import type * as api from '@/services/api/sdlcApi';
import { ClarificationPanel } from './components/ClarificationPanel';
import {
  countCompletedAgents,
  getRuntimeAnimation,
  getRuntimeIcon,
  getRuntimeVisual,
  selectAgentPhaseStatus,
  selectRuntimeStatus,
} from '@/store/runtimeSelectors';

/**
 * OverviewPage — runtime monitoring of all running workflows.
 *
 * Requirements:
 *  - Shows pipeline progress + current agent + pending approvals.
 *  - DOES NOT display the runtime log; that lives only in the Agent Tasks
 *    right Inspector.
 *  - Reads ONLY from useWorkflowStore. No polling. No mirrors.
 *  - One ClarificationPanel (reused) per pending PO_CLARIFY gate.
 */
export function OverviewPage() {
  const navigate = useNavigate();
  // Read raw maps; derived data via useMemo. Selector functions that allocate
  // fresh objects (`Object.values`, `selectAllSessions`) would otherwise
  // return a new reference each render and create a render loop.
  const sessionsMap = useWorkflowStore((s) => s.sessions);
  const connection = useWorkflowStore((s) => {
    const conns = Object.values(s.sseConnections) as ('idle' | 'connecting' | 'connected' | 'error')[];
    if (conns.length === 0) return 'idle';
    if (conns.some((c) => c === 'error')) return 'error';
    if (conns.every((c) => c === 'connected')) return 'connected';
    if (conns.some((c) => c === 'connecting')) return 'connecting';
    return 'idle';
  });
  const sessions = useMemo(() => Object.values(sessionsMap), [sessionsMap]);
  const setActiveSession = useUiStore((s) => s.setActiveSession);
  const setSelectedGateId = useUiStore((s) => s.setSelectedGateId);
  const setInspectorTab = useUiStore((s) => s.setInspectorTab);
  const [focusGateId, setFocusGateId] = useState<string | null>(null);

  const stats = useMemo(() => {
    const pendingApprovals = sessions.reduce(
      (acc, s) => acc + s.pendingGates.length,
      0,
    );
    const runningSessions = sessions.filter(
      (s) => s.status === 'running' || s.status === 'awaiting_approval',
    ).length;
    const completedToday = sessions.filter(
      (s) => s.status === 'completed',
    ).length;
    return { pendingApprovals, runningSessions, completedToday, total: sessions.length };
  }, [sessions]);

  const onSelectSession = (sessionId: string, tab: InspectorTab = 'questions') => {
    setActiveSession(sessionId);
    setInspectorTab(tab);
    navigate(`/sdlc/build?sessionId=${sessionId}`);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 overflow-y-auto bg-surface-container-low px-6 py-5">
      <Header
        connection={connection}
        stats={stats}
        onNew={() => useUiStore.getState().openFeatureRequestForm()}
      />

      {sessions.length === 0 && <EmptyState />}

      {sessions.length > 0 && (
        <div className="flex flex-col gap-6">
          {sessions.map((sess) => (
            <SessionMonitorCard
              key={sess.sessionId}
              session={sess}
              focusGateId={focusGateId}
              onFocusGate={(gateId) => {
                setFocusGateId(gateId);
                onSelectSession(sess.sessionId, 'questions');
                setSelectedGateId(gateId);
              }}
              onOpenSession={() => onSelectSession(sess.sessionId)}
              onOpenQuestions={() => onSelectSession(sess.sessionId, 'questions')}
              onOpenReview={() => onSelectSession(sess.sessionId, 'review')}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Subcomponents ──

function Header({
  connection,
  stats,
  onNew,
}: {
  connection: 'idle' | 'connecting' | 'connected' | 'error';
  stats: { pendingApprovals: number; runningSessions: number; completedToday: number; total: number };
  onNew: () => void;
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-outline-variant/30 pb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-on-surface">Workflow Overview</h1>
          <ConnectionPill status={connection} />
        </div>
        <button
          onClick={onNew}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-bold text-on-primary transition-colors hover:bg-primary/90"
        >
          <Layers size={13} />
          New Session
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total sessions" value={stats.total} icon={<Layers size={12} />} />
        <Stat label="Running" value={stats.runningSessions} icon={<Activity size={12} />} accent="blue" />
        <Stat label="Pending approvals" value={stats.pendingApprovals} icon={<Clock size={12} />} accent={stats.pendingApprovals > 0 ? 'amber' : 'default'} />
        <Stat label="Completed" value={stats.completedToday} icon={<CheckCircle2 size={12} />} accent="green" />
      </div>
    </header>
  );
}

function Stat({
  label, value, icon, accent = 'default',
}: {
  label: string; value: number; icon: React.ReactNode;
  accent?: 'default' | 'blue' | 'amber' | 'green';
}) {
  const valueColor =
    accent === 'blue' ? 'text-blue-400'
    : accent === 'amber' ? 'text-amber-400'
    : accent === 'green' ? 'text-emerald-400'
    : 'text-on-surface';
  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/70">
        {icon}
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${valueColor}`}>{value}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-outline-variant/30 bg-surface-container-lowest py-12">
      <Activity size={28} className="text-on-surface-variant/40" />
      <p className="text-sm font-semibold text-on-surface">No workflows yet</p>
      <p className="text-[11px] text-on-surface-variant/60">
        Submit a feature request from the toolbar to start a new AIFA workflow.
      </p>
    </div>
  );
}

function SessionMonitorCard({
  session,
  focusGateId,
  onFocusGate,
  onOpenSession,
  onOpenQuestions,
  onOpenReview,
}: {
  session: SessionState;
  focusGateId: string | null;
  onFocusGate: (gateId: string) => void;
  onOpenSession: () => void;
  onOpenQuestions: () => void;
  onOpenReview: () => void;
}) {
  const completed = countCompletedAgents(session);
  const percent = Math.round((completed / 5) * 100);
  // currentAgent / reviewingAgent come from the canonical selector.
  // The selector is the single owner of runtime derivations
  // (canonical runtime contract §7 — "No component may compute
  // currentAgent independently"). The selector preserves byte-
  // identical behaviour to the prior inline derivation.
  const { currentAgent: runningAgent, reviewingAgent } = useMemo(
    () => selectRuntimeStatus(session),
    [session],
  );
  const focusedGate: api.GateItem | null = focusGateId
    ? session.pendingGates.find((g) => g.id === focusGateId) ?? null
    : null;

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <SessionStatusIcon status={session.status} />
            <h2 className="truncate text-[14px] font-bold text-on-surface" title={session.featureRequest}>
              {session.featureRequest || 'Untitled'}
            </h2>
            <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono text-[10px] text-on-surface-variant">
              {session.sessionId.slice(0, 8)}
            </code>
          </div>
          <p className="mt-0.5 text-[11px] text-on-surface-variant/60">
            {session.repoUrl || 'no repo'} · created {new Date(session.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <button
          onClick={onOpenSession}
          className="flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary transition-colors hover:bg-primary/20"
        >
          Open
          <ChevronRight size={11} />
        </button>
      </header>

      {/* Pipeline phase strip */}
      <div>
        <div className="mb-1 flex items-center justify-between text-[10px] text-on-surface-variant/60">
          <span>Pipeline progress</span>
          <span className="font-mono tabular-nums">{completed}/5 · {percent}%</span>
        </div>
        <div className="grid grid-cols-5 gap-1">
          {AGENT_KEYS.map((key) => {
            // OBS-01.3 — Dashboard pipeline strip renders every per-agent
            // runtime state via the canonical visual map. No
            // component may hardcode runtime colours outside the
            // canonical map (canonical runtime contract §5.2.3,
            // §7 — duplicated CSS mapping is FORBIDDEN).
            const status = selectAgentPhaseStatus(session, key);
            const visual = getRuntimeVisual(status);
            const Icon = getRuntimeIcon(status);
            // OBS-01.6 — runtime animation class is sourced from
            // the canonical visual map. No inline `animate-*` class
            // is permitted on the icon (canonical contract §7,
            // §5.1.4 — only `running` may carry `animate-spin`,
            // applied to the Loader2 icon via the canonical map).
            const animation = getRuntimeAnimation(status);
            return (
              <div
                key={key}
                data-testid={`dashboard-pipeline-cell-${key}`}
                data-runtime-status={status}
                title={`${key} · ${visual.badge}`}
                className={`flex flex-col items-center gap-0.5 rounded-md border ${visual.border} py-1 text-[9px] font-bold uppercase tracking-wider ${visual.background}`}
              >
                <Icon size={10} className={animation} aria-hidden="true" />
                <span>{key}</span>
                <span className="font-mono">{visual.glyph}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Current agent + tool line */}
      <div className="flex flex-wrap items-center gap-4 text-[11px] text-on-surface-variant">
        {runningAgent && (() => {
          // OBS-01.3 / OBS-01.6 — read the canonical runtime visual
          // for the running-agent indicator, including the canonical
          // animation class. No inline colour/icon/animation
          // classes are permitted (canonical runtime contract §7).
          // The contract §5.1.4 reserves `animate-spin` for the
          // `running` state's Loader2; OBS-01.6 routes it through
          // the canonical map rather than hardcoding it.
          const visual = getRuntimeVisual('running');
          const RunningIcon = getRuntimeIcon('running');
          const animation = getRuntimeAnimation('running');
          return (
            <div className="flex items-center gap-1.5">
              <RunningIcon size={11} className={`${visual.background} ${animation}`.trim()} aria-hidden="true" />
              <span><b className="text-on-surface">{runningAgent}</b> {visual.badge.toLowerCase()}</span>
              {session.agentStates[runningAgent].currentAction && (
                <span className="text-on-surface-variant/60">— {session.agentStates[runningAgent].currentAction}</span>
              )}
            </div>
          );
        })()}
        {reviewingAgent && (() => {
          const visual = getRuntimeVisual('awaiting_review');
          const ReviewIcon = getRuntimeIcon('awaiting_review');
          return (
            <div className="flex items-center gap-1.5">
              <ReviewIcon size={11} className={visual.background} aria-hidden="true" />
              <span><b className="text-on-surface">{reviewingAgent}</b> {visual.badge.toLowerCase()}</span>
            </div>
          );
        })()}
      </div>

      {/* Pending gates */}
      {session.pendingGates.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-400">
            <AlertCircle size={12} />
            {session.pendingGates.length} gate{session.pendingGates.length > 1 ? 's' : ''} pending
          </div>
          <ul className="flex flex-col gap-1.5">
            {session.pendingGates.map((gate) => (
              <li key={gate.id} className="flex items-center justify-between gap-2">
                <GateBadge gate={gate} />
                <div className="flex items-center gap-1.5">
                  {gate.type === 'PO_CLARIFY' && (
                    <button
                      onClick={() => onFocusGate(gate.id)}
                      className="flex items-center gap-1 rounded-md bg-cyan-500/15 px-2 py-0.5 text-[10px] font-bold text-cyan-300 hover:bg-cyan-500/25"
                    >
                      <MessageSquare size={10} />
                      Answer
                    </button>
                  )}
                  {(gate.type.endsWith('_OUTPUT_REVIEW') || gate.type === 'FINAL_RELEASE') && (
                    <button
                      onClick={onOpenReview}
                      className="flex items-center gap-1 rounded-md bg-indigo-500/15 px-2 py-0.5 text-[10px] font-bold text-indigo-300 hover:bg-indigo-500/25"
                    >
                      <FileCheck2 size={10} />
                      Review
                    </button>
                  )}
                  {gate.type === 'DEV_FILE_GATE' && (
                    <span className="flex items-center gap-1 text-[10px] text-on-surface-variant">
                      <Shield size={10} />
                      tool approval
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Focused clarification — only renders when the user clicked "Answer" */}
      {focusedGate && focusedGate.type === 'PO_CLARIFY' && (
        <div className="flex flex-col gap-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">
            Answering question
          </div>
          <ClarificationPanel
            sessionId={session.sessionId}
            gate={focusedGate}
            onResolved={() => onFocusGate('')}
          />
        </div>
      )}

      {/* Decisions summary */}
      {session.gateHistory.length > 0 && (
        <div className="flex items-center gap-1.5 text-[10px] text-on-surface-variant/70">
          <GitFork size={10} />
          {session.gateHistory.length} decision{session.gateHistory.length > 1 ? 's' : ''} recorded · last:
          {' '}<span className="font-bold uppercase">{session.gateHistory.at(-1)?.decision}</span>
          <span className="font-mono">
            {new Date(session.gateHistory.at(-1)!.resolvedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      )}

      {/* Help hint if no question is focused but clarifications exist */}
      {!focusGateId && session.pendingGates.some((g) => g.type === 'PO_CLARIFY') && (
        <button
          onClick={onOpenQuestions}
          className="self-start text-[10px] font-semibold text-primary hover:underline"
        >
          Open all pending questions →
        </button>
      )}
    </article>
  );
}

function SessionStatusIcon({ status }: { status: SessionState['status'] }) {
  if (status === 'running') return <Loader2 size={13} className="animate-spin text-blue-400" />;
  if (status === 'completed') return <CheckCircle2 size={13} className="text-emerald-400" />;
  if (status === 'failed') return <XCircle size={13} className="text-red-400" />;
  if (status === 'awaiting_approval') return <Clock size={13} className="text-amber-400" />;
  return <Activity size={13} className="text-on-surface-variant/60" />;
}

function GateBadge({ gate }: { gate: api.GateItem }) {
  if (gate.type === 'PO_CLARIFY') {
    return <span className="flex items-center gap-1.5 text-[11px] text-on-surface"><MessageSquare size={11} className="text-cyan-400" /> PO Clarification</span>;
  }
  if (gate.type === 'DEV_FILE_GATE') {
    return <span className="flex items-center gap-1.5 text-[11px] text-on-surface"><Shield size={11} className="text-purple-400" /> Tool Approval</span>;
  }
  if (gate.type === 'FINAL_RELEASE') {
    return <span className="flex items-center gap-1.5 text-[11px] text-on-surface"><Rocket size={11} className="text-emerald-400" /> Release Decision</span>;
  }
  if (gate.type.endsWith('_OUTPUT_REVIEW')) {
    const agent = gate.type.replace('_OUTPUT_REVIEW', '');
    return <span className="flex items-center gap-1.5 text-[11px] text-on-surface"><FileCheck2 size={11} className="text-indigo-400" /> {agent} Output Review</span>;
  }
  return <span className="text-[11px] text-on-surface">{gate.type}</span>;
}

function ConnectionPill({ status }: { status: 'idle' | 'connecting' | 'connected' | 'error' }) {
  const cfg: Record<typeof status, { dot: string; label: string }> = {
    idle:       { dot: 'bg-on-surface-variant/40', label: 'Idle' },
    connecting: { dot: 'bg-blue-500 animate-pulse', label: 'Connecting' },
    connected:  { dot: 'bg-emerald-500 animate-pulse', label: 'Live' },
    error:      { dot: 'bg-red-500', label: 'Disconnected' },
  };
  const c = cfg[status];
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-surface-container px-2 py-0.5 text-[10px] font-bold text-on-surface-variant">
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

export default OverviewPage;
