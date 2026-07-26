/**
 * Agent Tasks page (formerly "Agent Gate"). Three-column layout:
 *  - LEFT:   SessionRail (session browser)
 *  - CENTER: 5 agent columns (ARCH/PO/UX/DEV/QA) with task lists
 *  - RIGHT:  InspectorPanel (Runtime Log / Tool Calls / Human Questions / …)
 *
 * Workflow data source: useWorkflowStore (SSE-driven). UI source: useUiStore.
 * No polling, no mirrors. Click an agent column → opens Output Review in the
 * right inspector; pending PO_CLARIFY gates auto-switch the inspector to the
 * Human Questions tab via selectRuntimeExecution + ClarificationPanel.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Loader2, Clock,
  User, Palette, Code, ShieldCheck, Bug, Network,
} from 'lucide-react';
import { useUiStore, type InspectorTab } from '@/store/useUiStore';
import { useWorkflowStore, type ConnectionStatus } from '@/store/useWorkflowStore';
import { selectRuntimeExecution } from '@/store/workflowSelectors';
import {
  countCompletedAgents,
  countTotalAgents,
  getRuntimeAnimation,
  getRuntimeIcon,
  getRuntimeVisual,
  selectAgentPhaseEntry,
  type PhaseStatus,
} from '@/store/runtimeSelectors';
import type { AgentKey } from '@/models/SessionState';
import { AGENT_KEYS } from '@/models/SessionState';
import EmptyProjectState from './components/EmptyProjectState';
import FeatureRequestChatbox from './components/FeatureRequestChatbox';
import { SessionRail } from './components/SessionRail';
import { InspectorPanel } from './components/InspectorPanel';
import { useAppStore } from '@/store/useAppStore';

const AGENT_META: Record<AgentKey, { title: string; desc: string; icon: React.ReactNode }> = {
  ARCH: { title: 'Architecture (ARCH)', desc: 'System Design & Routing', icon: <Network size={18} className="text-cyan-400" /> },
  PO:   { title: 'Product Owner (PO)', desc: 'Requirements & Risk', icon: <User size={18} className="text-indigo-400" /> },
  UX:   { title: 'UI/UX Designer (UX)', desc: 'User Flows & Mockups', icon: <Palette size={18} className="text-pink-400" /> },
  DEV:  { title: 'Developer (DEV)', desc: 'Code & Build', icon: <Code size={18} className="text-emerald-400" /> },
  QA:   { title: 'Quality Assurance (QA)', desc: 'Validation', icon: <ShieldCheck size={18} className="text-amber-400" /> },
};

interface TaskItem {
  id: string;
  title: string;
  description: string;
  // The TaskItem status is the canonical PhaseStatus union (see
  // the canonical runtime contract §5.1). It is intentionally
  // the SAME union that the canonical selector exposes — the
  // canonical map (getRuntimeVisual / getRuntimeIcon) is the
  // SINGLE source for both pages.
  status: 'pending' | 'running' | 'gate_pending' | 'awaiting_review' | 'completed' | 'skipped' | 'failed';
}

const TASK_LIST: Record<AgentKey, Array<{ id: string; title: string; description: string }>> = {
  ARCH: [
    { id: 'arch-1', title: 'Detect Architecture', description: 'Read repo tree, config files & detect tech stack.' },
    { id: 'arch-2', title: 'Generate Architecture_Brief.md', description: 'Output routing, modules & constraints.' },
  ],
  PO: [{ id: 'po-1', title: 'Generate PRD', description: 'Create product requirements document.' }],
  UX: [{ id: 'ux-1', title: 'Create HTML Mockup', description: 'Design interactive HTML interface.' }],
  DEV: [
    { id: 'dev-1', title: 'Generate Code Diff', description: 'Create and review code changes.' },
    { id: 'dev-2', title: 'Execute Build', description: 'Run compiler, linter, and tests.' },
  ],
  QA: [{ id: 'qa-1', title: 'Test & Verify', description: 'Create and auto-execute test cases.' }],
};

// OBS-01.4 — Three previously-local CSS maps (TASK_ICON,
// STATUS_DOT_COLOR, COLUMN_BORDER) have been removed. The
// canonical runtime selector in @/store/runtimeSelectors is the
// SINGLE source for runtime colour, border, icon, and badge
// text. AgentTask now reads its visuals from
//   getRuntimeVisual(status)      — colour + border + badge
//   getRuntimeIcon(status)        — icon component
// See runtimeSelectors — OBS-01.3 Dashboard runtime visual
// maps (the canonical source) and §5.2.2 of the canonical
// runtime contract for the cross-page identity invariant.

const TRANSLATED_ERROR: Array<[RegExp, string]> = [
  [/project_id with feature_request\.title/, 'Please select a Project before submitting a new feature request.'],
  [/Failed to start SDLC/, 'Could not start the agent pipeline. Please retry.'],
  [/Failed to check status/, 'Could not refresh status from the server. Reconnecting…'],
  [/Failed to resolve risk/, 'Could not respond to the security gate.'],
  [/Failed to submit final release/, 'Could not submit the release decision.'],
  [/Network Error|Failed to fetch/, 'Network error: cannot reach the backend.'],
];

function translateError(err: string | null): string | null {
  if (!err) return null;
  for (const [re, msg] of TRANSLATED_ERROR) {
    if (re.test(err)) return msg;
  }
  return err;
}

export default function SdlcDashboard() {
  const currentProjectId = useAppStore((s) => s.currentProjectId);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const sessionsMap = useWorkflowStore((s) => s.sessions);
  const connection = useWorkflowStore((s) => {
    const conns = Object.values(s.sseConnections) as ConnectionStatus[];
    if (conns.length === 0) return 'idle' as ConnectionStatus;
    if (conns.some((c) => c === 'error')) return 'error' as ConnectionStatus;
    if (conns.every((c) => c === 'connected')) return 'connected' as ConnectionStatus;
    if (conns.some((c) => c === 'connecting')) return 'connecting' as ConnectionStatus;
    return 'idle' as ConnectionStatus;
  });
  const activeSessionId = useUiStore((s) => s.activeSessionId);
  const setActiveSession = useUiStore((s) => s.setActiveSession);
  const inspectorTab = useUiStore((s) => s.inspectorTab);
  const setInspectorTab = useUiStore((s) => s.setInspectorTab);
  const selectedGateId = useUiStore((s) => s.selectedGateId);
  const setSelectedGateId = useUiStore((s) => s.setSelectedGateId);

  const sessions = useMemo(() => Object.values(sessionsMap), [sessionsMap]);

  // Project RuntimeExecution outside the Zustand selector — the selector
  // allocates a fresh object per call and would otherwise create an
  // infinite-render loop.
  const runtime = useMemo(
    () => (activeSessionId ? selectRuntimeExecution({ sessions: sessionsMap } as never, activeSessionId) : null),
    [sessionsMap, activeSessionId],
  );
  const activeSession = activeSessionId ? sessionsMap[activeSessionId] ?? null : null;

  const focusRequest = searchParams.get('focusRequest') === 'true';
  const deepLinkSessionId = searchParams.get('sessionId');

  // Deep-link: when navigated from elsewhere with ?sessionId=…, switch into it.
  useEffect(() => {
    if (deepLinkSessionId && deepLinkSessionId !== activeSessionId && sessions.find((s) => s.sessionId === deepLinkSessionId)) {
      setActiveSession(deepLinkSessionId);
    }
  }, [deepLinkSessionId, activeSessionId, sessions, setActiveSession]);

  // Open the questions tab when a clarification gate is the only thing waiting.
  // T2 (B1) — every agent can raise a clarification gate (PO/UX/DEV/QA + ARCH
  // emits AGENT_CLARIFY). Match all of them so ARCH/UX/DEV/QA questions also
  // auto-route to the inspector.
  const CLARIFICATION_TYPES = new Set(['PO_CLARIFY', 'UX_CLARIFY', 'DEV_CLARIFY', 'QA_CLARIFY', 'AGENT_CLARIFY']);
  const clarificationGateId = activeSession?.pendingGates.find((g) => CLARIFICATION_TYPES.has(g.type))?.id ?? null;
  useEffect(() => {
    if (clarificationGateId) {
      setInspectorTab('questions');
      setSelectedGateId(clarificationGateId);
    }
  }, [clarificationGateId, setInspectorTab, setSelectedGateId]);

  // Auto-focus the Output Review tab when a *_OUTPUT_REVIEW gate lands and no
  // gate is selected yet — mirrors the clarification gate behavior above so the
  // inspector renders the artifact (e.g. UX html_mockup) without a manual click.
  const reviewGateId = activeSession?.pendingGates.find((g) => g.type?.endsWith('_OUTPUT_REVIEW'))?.id ?? null;
  useEffect(() => {
    if (reviewGateId && !selectedGateId && inspectorTab !== 'review') {
      setInspectorTab('review');
      setSelectedGateId(reviewGateId);
    }
  }, [reviewGateId, selectedGateId, inspectorTab, setInspectorTab, setSelectedGateId]);

  // Auto-focus the Human questions tab when a tool gate (HITL_REVIEW /
  // DEV_FILE_GATE) lands and no gate is selected yet. Without this, the
  // gate sits in pendingGates and the inspector badge counts it, but
  // selectedGateId stays null so ToolGatePanel never renders.
  const toolGateId = activeSession?.pendingGates.find((g) => g.kind === 'tool')?.id ?? null;
  useEffect(() => {
    if (toolGateId && !selectedGateId) {
      setInspectorTab('questions');
      setSelectedGateId(toolGateId);
    }
  }, [toolGateId, selectedGateId, setInspectorTab, setSelectedGateId]);

  // ── Task status derivation per agent column ──
  //
  // OBS-01.4 — The phase status (ps) is already sourced through
  // the canonical selector (phaseStatusFor below). The task-level
  // status is the phase status itself, with the special rule
  // that when the agent is 'running' only the first task is
  // marked running (the others are pending) — this preserves the
  // per-agent progress visualisation. The mapping below is the
  // ONLY derivation of task-level status; every other runtime
  // visual aspect (background, border, icon, badge) is obtained
  // from getRuntimeVisual / getRuntimeIcon.
  const tasksForAgent = (agent: AgentKey, phaseStatus: PhaseStatus): TaskItem[] => {
    const list = TASK_LIST[agent];
    return list.map((t, idx) => {
      let status: TaskItem['status'] = phaseStatus;
      if (phaseStatus === 'running' && idx > 0) {
        // First task of a running agent is the one currently
        // executing; subsequent tasks are pending.
        status = 'pending';
      }
      return { ...t, status };
    });
  };

  const phaseStatusFor = (agent: AgentKey): PhaseStatus => {
    if (!runtime) return 'pending';
    return (runtime.phases.find((p) => p.agent === agent)?.status ?? 'pending') as PhaseStatus;
  };

  const onColumnClick = (agent: AgentKey) => {
    const reviewGate = activeSession?.pendingGates.find((g) => g.type === `${agent}_OUTPUT_REVIEW`);
    if (reviewGate) {
      setSelectedGateId(reviewGate.id);
      setInspectorTab('review');
      return;
    }
    // No pending review gate — open the decisions tab (artifact is now
    // embedded in the Output Review panel per spec §6.3). Runtime log tab
    // is intentionally not in the TABS list anymore.
    setInspectorTab('decisions');
  };

  const translatedError = translateError(activeSession?.error ?? null);
  const sessionStatus = activeSession?.status ?? 'idle';

  if (!currentProjectId) {
    return (
      <main className="flex h-full min-h-0 flex-col overflow-y-auto bg-background p-6 text-on-surface">
        <EmptyProjectState />
      </main>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full">
      {/* ─────────────────────────── LEFT RAIL ─────────────────────────── */}
      <SessionRail onNewSession={() => {
        const params = new URLSearchParams(searchParams);
        params.set('focusRequest', 'true');
        setSearchParams(params);
      }} />

      {/* ─────────────────────────── CENTER ─────────────────────────── */}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background text-on-surface">
        {/* header */}
        <header className="flex items-center justify-between border-b border-outline-variant/20 px-6 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold uppercase tracking-[0.14em] text-on-surface">Agent Tasks</h1>
            <SessionPill status={sessionStatus} connection={connection} />
          </div>
          <div className="flex items-center gap-2">
            {/* T4 (B3): Audit Trail button removed per spec §8.2. Runtime Log is
                the single timeline; the inspector already exposes it. */}
            <button
              onClick={() => {
                const params = new URLSearchParams(searchParams);
                params.set('focusRequest', 'true');
                setSearchParams(params);
              }}
              className="rounded-md bg-primary px-3 py-1 text-[11px] font-bold text-on-primary hover:bg-primary/90"
            >
              New session
            </button>
          </div>
        </header>

        {translatedError && (
          <div className="mx-6 mb-3 mt-3 flex items-center gap-2 rounded-lg border border-error/25 bg-error/10 p-3 text-[12px] text-error">
            <Bug size={13} />
            {translatedError}
          </div>
        )}

        {focusRequest && <FeatureRequestChatbox onClose={() => {
          const params = new URLSearchParams(searchParams);
          params.delete('focusRequest');
          setSearchParams(params);
        }} />}

        {/* center workspace */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
          {!activeSession && sessions.length === 0 && <NoSessionEmptyState onNew={() => {
            const params = new URLSearchParams(searchParams);
            params.set('focusRequest', 'true');
            setSearchParams(params);
          }} />}

          {sessions.length > 0 && !activeSession && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-outline-variant/40 py-16 text-center">
              <Loader2 size={28} className="text-primary/60" />
              <p className="text-sm font-semibold text-on-surface">Pick a session from the left rail</p>
              <p className="text-[11px] text-on-surface-variant/70">Or start a new feature request.</p>
            </div>
          )}

          {activeSession && (
            <>
              <SessionSummaryBar session={activeSession} runtime={runtime} />

              {/* 5 agent columns */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
                {AGENT_KEYS.map((agent) => {
                  const ps = phaseStatusFor(agent);
                  const tasks = tasksForAgent(agent, ps);
                  const meta = AGENT_META[agent];
                  // Read the taskId via the canonical selector entry-point.
                  // The visible status (ps) is already canonical-sourced
                  // via phaseStatusFor / runtime.phases[agent].status.
                  const phase = selectAgentPhaseEntry(activeSession, agent);
                  const canOpenPanel = ps === 'completed' || ps === 'gate_pending' || ps === 'failed';
                  // OBS-01.4 — runtime visuals (border, chip background,
                  // dot color, icon) are read from the canonical
                  // runtime selector. There is no local map.
                  const cardVisual = getRuntimeVisual(ps);

                  return (
                    <div
                      key={agent}
                      data-testid={`agenttask-card-${agent}`}
                      data-runtime-status={ps}
                      onClick={() => canOpenPanel && onColumnClick(agent)}
                      className={`flex flex-col gap-2.5 rounded-xl border bg-surface-container/60 p-4 transition-all ${cardVisual.border} ${canOpenPanel ? 'cursor-pointer hover:border-white/30' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2 border-b border-outline-variant/20 pb-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-container-high/60">
                            {meta.icon}
                          </div>
                          <div className="min-w-0">
                            <h3 className="truncate text-[11px] font-bold uppercase tracking-wider text-on-surface">{agent}</h3>
                            <p className="truncate text-[9px] text-on-surface-variant">{meta.desc}</p>
                          </div>
                        </div>
                        <span
                          data-testid={`agenttask-chip-${agent}`}
                          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider ${cardVisual.background}`}
                        >
                          {cardVisual.badge.replace(/_/g, ' ')}
                        </span>
                      </div>

                      {phase?.duration && (
                        <div className="font-mono text-[9px] font-semibold text-primary">⏱ {phase.duration}</div>
                      )}


                      <div className="flex flex-col gap-1.5">
                        {tasks.map((task) => {
                          // OBS-01.4 — per-task visual from the canonical
                          // runtime selector. Same source as the
                          // card border and the chip above; one
                          // single canonical map drives every
                          // runtime visual.
                          const taskVisual = getRuntimeVisual(task.status);
                          const TaskIcon = getRuntimeIcon(task.status);
                          // OBS-01.6 — per-state animation class is
                          // sourced from the canonical visual map
                          // (canonical contract §5.1.4 — only the
                          // `running` state carries `animate-spin`,
                          // applied to the per-task Loader2 icon).
                          const taskAnimation = getRuntimeAnimation(task.status);
                          return (
                            <div
                              key={task.id}
                              data-testid={`agenttask-task-${agent}-${task.id}`}
                              data-runtime-status={task.status}
                              className={`flex items-start gap-2 rounded-lg border p-2 ${taskVisual.background}`}
                            >
                              <span className="mt-0.5 shrink-0">
                                <TaskIcon size={14} className={`${taskVisual.background.split(' ').find((c) => c.startsWith('text-')) ?? ''} ${taskAnimation}`.trim()} aria-hidden="true" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <span className="block truncate text-[11px] font-semibold text-on-surface">{task.title}</span>
                                <p className="mt-0.5 text-[9.5px] leading-relaxed text-on-surface-variant">
                                  {task.status === 'skipped' ? 'Skipped for this execution path.' : task.description}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </main>

      {/* ─────────────────────────── RIGHT INSPECTOR ─────────────────────────── */}
      {activeSession && <InspectorPanel />}
    </div>
  );
}

// ── Subcomponents ──

function SessionPill({ status, connection }: { status: string; connection: ConnectionStatus }) {
  const color =
    status === 'completed' ? 'bg-emerald-500/15 text-emerald-400'
    : status === 'failed' ? 'bg-red-500/15 text-red-400'
    : status === 'awaiting_approval' || status === 'awaiting_release' ? 'bg-amber-500/15 text-amber-400'
    : status === 'running' ? 'bg-blue-500/15 text-blue-300'
    : 'bg-surface-container text-on-surface-variant/70';
  const connColor =
    connection === 'connected' ? 'bg-emerald-500'
    : connection === 'connecting' ? 'bg-blue-500 animate-pulse'
    : connection === 'error' ? 'bg-red-500'
    : 'bg-on-surface-variant/30';
  return (
    <div className="flex items-center gap-2">
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${color}`}>{status.replace('_', ' ')}</span>
      <span className="flex items-center gap-1 text-[10px] text-on-surface-variant/70">
        <span className={`h-1.5 w-1.5 rounded-full ${connColor}`} />
        {connection}
      </span>
    </div>
  );
}

function SessionSummaryBar({
  session,
  runtime,
}: {
  session: NonNullable<ReturnType<typeof useWorkflowStore.getState>['sessions'][string]>;
  runtime: ReturnType<typeof selectRuntimeExecution>;
}) {
  // T7 (B7) — spec §8.1 Session Summary MUST show:
  //   Repository · Branch · Commit SHA · Pipeline Status · Current Agent
  // plus dashboard cards (Completed Agents / Generated Files / Errors / Warnings).
  // Read the count + total through the canonical selector. No direct
  // read of session.pipelinePhases is permitted (canonical runtime
  // contract §7).
  const completed = countCompletedAgents(session);
  const total = countTotalAgents(session);
  const percent = Math.round((completed / total) * 100);
  const gateCount = session.pendingGates.length;

  const repoUrl = session.repoUrl || session.repoInfo?.repoUrl || null;
  const branch = session.repoInfo?.branch ?? null;
  const commitSha = session.repoInfo?.commitSha ?? null;
  const fileCount = session.repoInfo?.fileCount ?? 0;

  // Errors: derived from runtime events of type 'error' + session.error.
  const errorCount = session.runtimeEvents.filter((e) => e.type === 'error').length
    + (session.error ? 1 : 0);
  // Warnings: derived from gate_audit + rejected gates (non-fatal).
  const warningCount = session.gateHistory.filter((g) => g.decision === 'reject').length;

  const pipelineStatusLabel = (() => {
    if (session.status === 'completed') return 'Completed';
    if (session.status === 'failed') return 'Failed';
    if (session.status === 'awaiting_release') return 'Awaiting Release';
    if (session.status === 'awaiting_approval') return 'Awaiting Approval';
    if (session.status === 'running') return runtime?.currentAgent ? `Running · ${runtime.currentAgent}` : 'Running';
    return 'Pending';
  })();

  const compactHash = commitSha ? commitSha.slice(0, 7) : '—';
  const compactRepo = repoUrl
    ? (() => {
        try {
          const u = new URL(repoUrl);
          return `${u.host}${u.pathname}`.replace(/\.git$/, '');
        } catch {
          return repoUrl;
        }
      })()
    : '—';

  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-4 py-3 text-[11px]">
      {/* Spec §8.1 — the 5 required fields */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-on-surface-variant">
        <span className="flex items-center gap-1.5">
          <span className="font-semibold uppercase tracking-wider text-[9px] text-on-surface-variant/70">Repo</span>
          <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono text-[10px] text-on-surface" title={repoUrl || 'No repository URL'}>
            {compactRepo}
          </code>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="font-semibold uppercase tracking-wider text-[9px] text-on-surface-variant/70">Branch</span>
          <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono text-[10px] text-on-surface">
            {branch || '—'}
          </code>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="font-semibold uppercase tracking-wider text-[9px] text-on-surface-variant/70">SHA</span>
          <code className="rounded bg-surface-container px-1.5 py-0.5 font-mono text-[10px] text-on-surface">
            {compactHash}
          </code>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="font-semibold uppercase tracking-wider text-[9px] text-on-surface-variant/70">Status</span>
          <b className="text-on-surface">{pipelineStatusLabel}</b>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="font-semibold uppercase tracking-wider text-[9px] text-on-surface-variant/70">Agent</span>
          {runtime?.currentAgent ? (
            // OBS-01.4 — runtime visuals (icon, background, animation)
            // come from the canonical runtime selector. No component
            // may hardcode runtime colours outside the canonical map
            // (canonical runtime contract §5.2.3, §7).
            // OBS-01.6 — the animation class (animate-spin on the
            // `running` Loader2 per contract §5.1.4) is also sourced
            // from the canonical map. Same single source for every
            // runtime visual across every page (Dashboard / Agent
            // Task / Inspector / SessionRail).
            (() => {
              const visual = getRuntimeVisual('running');
              const RunningIcon = getRuntimeIcon('running');
              const animation = getRuntimeAnimation('running');
              return (
                <span className="flex items-center gap-1">
                  <RunningIcon size={10} className={`${visual.background} ${animation}`.trim()} aria-hidden="true" />
                  <b className="text-on-surface">{runtime.currentAgent}</b>
                </span>
              );
            })()
          ) : <b className="text-on-surface">—</b>}
        </span>
        <span className="ml-auto flex items-center gap-3">
          <span>{completed}/{total} phases · {percent}%</span>
          <span className={`flex items-center gap-1 ${gateCount > 0 ? 'text-amber-400' : ''}`}>
            <Clock size={10} />
            {gateCount} pending
          </span>
        </span>
      </div>

      {/* Dashboard cards — spec §8.1 "kèm dashboard trạng thái" */}
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryStat label="Completed" value={`${completed}/${total}`} tone="ok" />
        <SummaryStat label="Files" value={String(fileCount)} tone="muted" />
        <SummaryStat label="Errors" value={String(errorCount)} tone={errorCount > 0 ? 'bad' : 'muted'} />
        <SummaryStat label="Warnings" value={String(warningCount)} tone={warningCount > 0 ? 'warn' : 'muted'} />
      </div>
    </div>
  );
}

function SummaryStat({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'warn' | 'bad' | 'muted' }) {
  const toneClass =
    tone === 'ok' ? 'text-emerald-400'
    : tone === 'warn' ? 'text-amber-400'
    : tone === 'bad' ? 'text-red-400'
    : 'text-on-surface';
  return (
    <div className="rounded-md border border-outline-variant/20 bg-surface-container/40 px-2 py-1.5">
      <div className="text-[8px] font-semibold uppercase tracking-wider text-on-surface-variant/70">{label}</div>
      <div className={`font-mono text-sm font-bold ${toneClass}`}>{value}</div>
    </div>
  );
}

function NoSessionEmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-outline-variant/40 py-16 text-center">
      <Network size={28} className="text-on-surface-variant/40" />
      <p className="text-sm font-semibold text-on-surface">Start your first workflow</p>
      <p className="text-[11px] text-on-surface-variant/70">Submit a feature request to begin.</p>
      <button onClick={onNew} className="mt-2 rounded-md bg-primary px-3 py-1.5 text-[11px] font-bold text-on-primary hover:bg-primary/90">
        New session
      </button>
    </div>
  );
}
