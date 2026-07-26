import { useEffect, useMemo, useState } from 'react';
import {
  Activity, MessageCircle, FileCheck2, History,
  Loader2, AlertTriangle, CheckCircle2, X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useUiStore, type InspectorTab } from '@/store/useUiStore';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import {
  selectRuntimeExecution,
  type RuntimeExecution,
} from '@/store/workflowSelectors';
import { ClarificationPanel } from './ClarificationPanel';
import { ToolGatePanel } from './ToolGatePanel';
import { getSdlcTaskStatus, type GateItem } from '@/services/api/sdlcApi';

const TABS: Array<{ id: InspectorTab; label: string; icon: React.ReactNode }> = [
  { id: 'questions', label: 'Human questions', icon: <MessageCircle size={12} /> },
  { id: 'review', label: 'Output review', icon: <FileCheck2 size={12} /> },
  { id: 'decisions', label: 'Decision history', icon: <History size={12} /> },
];

interface InspectorPanelProps {
  onReviewResolved?: () => void;
}

export function InspectorPanel({ onReviewResolved }: InspectorPanelProps) {
  const tab = useUiStore((s) => s.inspectorTab);
  const setTab = useUiStore((s) => s.setInspectorTab);
  const sessionId = useUiStore((s) => s.activeSessionId);
  const selectedGateId = useUiStore((s) => s.selectedGateId);
  const setSelectedGateId = useUiStore((s) => s.setSelectedGateId);

  const sessionsMap = useWorkflowStore((s) => s.sessions);
  // Project RuntimeExecution outside the Zustand selector — the selector
  // allocates a fresh object per call and would otherwise create an
  // infinite-render loop.
  //
  // OBS-01.5 — `selectRuntimeExecution` is the canonical runtime-selector
  // entry-point (workflowSelectors.ts routes through runtimeSelectors.ts).
  // The Inspector MUST consume runtime state through this call only; no
  // direct `session.pipelinePhases` / `session.agentStates[i].status` reads
  // are permitted (canonical runtime contract §7 — "No component may derive
  // runtime state independently"). Today's Inspector renders gate state
  // and decisions only — no per-agent runtime visuals — so the runtime
  // field surface here is read for parity with Dashboard and Agent Task.
  const runtime: RuntimeExecution | null = useMemo(
    () => (sessionId ? selectRuntimeExecution({ sessions: sessionsMap } as never, sessionId) : null),
    [sessionsMap, sessionId],
  );

  const gates: GateItem[] = runtime?.session.pendingGates ?? [];
  const activeGate: GateItem | null = useMemo(() => {
    if (!selectedGateId) return null;
    return gates.find((g) => g.id === selectedGateId) ?? null;
  }, [selectedGateId, gates]);

  // Frozen spec §6 — dispatch by PendingGate.kind, NOT by per-role gate type
  // enums. `kind` is the canonical key the backend sends; `type` is a derived
  // presentation hint. Both `kind='question'` (clarification) and
  // `kind='tool'` (HITL_REVIEW / DEV_FILE_GATE) surface under the Human
  // questions tab; `kind='output_review'` and `kind='release'` surface under
  // the Output review tab. Keeping the three-tab layout intact.
  const questionGates = gates.filter((g) => g.kind === 'question' || g.kind === 'tool');
  const reviewGates = gates.filter((g) => g.kind === 'output_review' || g.kind === 'release');

  // Auto-jump to "questions" when a question/tool gate lands.
  useEffect(() => {
    if (activeGate && (activeGate.kind === 'question' || activeGate.kind === 'tool') && tab !== 'questions') {
      setTab('questions');
    }
  }, [activeGate?.id, tab, setTab]);

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-outline-variant/40 bg-surface-container-lowest">
      <nav className="flex shrink-0 flex-wrap items-center gap-1 border-b border-outline-variant/30 px-2 py-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10.5px] font-semibold transition-colors ${
              tab === t.id
                ? 'bg-primary/15 text-primary'
                : 'text-on-surface-variant/80 hover:bg-surface-container hover:text-on-surface'
            }`}
          >
            {t.icon}
            <span>{t.label}</span>
            {t.id === 'questions' && questionGates.length > 0 && (
              <span className="ml-1 rounded-full bg-amber-500/30 px-1.5 text-[9px] font-bold text-amber-400">
                {questionGates.length}
              </span>
            )}
            {t.id === 'review' && reviewGates.length > 0 && (
              <span className="ml-1 rounded-full bg-indigo-500/30 px-1.5 text-[9px] font-bold text-indigo-300">
                {reviewGates.length}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="flex-1 overflow-y-auto p-4">
        {!sessionId && <EmptyState />}
        {sessionId && tab === 'questions' && (
          <QuestionsTab
            sessionId={sessionId}
            gates={questionGates}
            activeGate={activeGate}
            onSelectGate={(id) => setSelectedGateId(id)}
            onResolved={() => { setSelectedGateId(null); onReviewResolved?.(); }}
          />
        )}
        {sessionId && tab === 'review' && (
          <OutputReviewTab
            sessionId={sessionId}
            gates={reviewGates}
            activeGate={reviewGates.find((g) => g.id === selectedGateId) ?? null}
            onSelectGate={(id) => setSelectedGateId(id)}
            onResolved={() => { setSelectedGateId(null); onReviewResolved?.(); }}
          />
        )}
        {sessionId && tab === 'decisions' && <DecisionsTab history={runtime?.session.gateHistory ?? []} />}
      </div>
    </aside>
  );
}

// ── Empty State ──

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center text-on-surface-variant/60">
      <Activity size={28} />
      <p className="mt-2 text-xs">Select a session to inspect its runtime.</p>
    </div>
  );
}

// ── Human Questions ──

function QuestionsTab({
  sessionId,
  gates,
  activeGate,
  onSelectGate,
  onResolved,
}: {
  sessionId: string;
  gates: GateItem[];
  activeGate: GateItem | null;
  onSelectGate: (id: string) => void;
  onResolved: () => void;
}) {
  // Dispatch by gate.kind (frozen spec §6):
  //   kind='question' → ClarificationPanel (existing, AskUserQuestion shape)
  //   kind='tool'     → ToolGatePanel   (HITL_REVIEW / DEV_FILE_GATE)
  // type-specific enums (PO_CLARIFY/DEV_FILE_GATE/...) are still accepted as
  // a fallback for old payloads that arrived before the dispatcher refactor.
  const clarificationGates = gates.filter((g) =>
    g.kind === 'question'
    || g.type === 'PO_CLARIFY' || g.type === 'UX_CLARIFY' || g.type === 'DEV_CLARIFY' || g.type === 'QA_CLARIFY' || g.type === 'AGENT_CLARIFY',
  );
  const toolGates = gates.filter((g) =>
    g.kind === 'tool' || g.type === 'HITL_REVIEW' || g.type === 'DEV_FILE_GATE',
  );
  const dispatchableGates = [...clarificationGates, ...toolGates];
  if (dispatchableGates.length === 0) {
    return <div className="text-[11px] text-on-surface-variant/60">No pending questions. Agents are running autonomously.</div>;
  }
  return (
    <div className="flex flex-col gap-3">
      {dispatchableGates.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {dispatchableGates.map((g) => (
            <button
              key={g.id}
              onClick={() => onSelectGate(g.id)}
              className={`rounded-md px-2 py-1 text-[10px] font-bold ${
                activeGate?.id === g.id
                  ? 'bg-cyan-500/20 text-cyan-300'
                  : 'bg-surface-container text-on-surface-variant/70 hover:text-on-surface'
              }`}
            >
              {g.id.slice(0, 8)} · {g.kind === 'tool' ? 'tool' : 'ask'}
            </button>
          ))}
        </div>
      )}
      {activeGate && (activeGate.kind === 'question' || clarificationGates.some((g) => g.id === activeGate.id)) ? (
        <ClarificationPanel sessionId={sessionId} gate={activeGate} />
      ) : activeGate && (activeGate.kind === 'tool' || toolGates.some((g) => g.id === activeGate.id)) ? (
        <ToolGatePanel sessionId={sessionId} gate={activeGate} onResolved={onResolved} />
      ) : (
        <div className="text-[11px] text-on-surface-variant/60">Select a gate to act on.</div>
      )}
    </div>
  );
}

// ── Output Review ──

function OutputReviewTab({
  sessionId,
  gates,
  activeGate,
  onSelectGate,
  onResolved,
}: {
  sessionId: string;
  gates: GateItem[];
  activeGate: GateItem | null;
  onSelectGate: (id: string) => void;
  onResolved: () => void;
}) {
  if (gates.length === 0) {
    return <div className="text-[11px] text-on-surface-variant/60">No output review requested yet.</div>;
  }
  if (!activeGate && gates.length > 0) {
    onSelectGate(gates[0].id);
    return null;
  }
  if (!activeGate) return null;

  // For per-agent output_review gates, render a slim inline panel that calls
  // the workflow store action directly (no AgentOutputPanel modal needed —
  // the value is showing the gate payload and a quick approve/reject).
  return (
    <OutputReviewInline
      sessionId={sessionId}
      gate={activeGate}
      onResolved={onResolved}
    />
  );
}

function OutputReviewInline({
  sessionId,
  gate,
  onResolved,
}: {
  sessionId: string;
  gate: GateItem;
  onResolved: () => void;
}) {
  const resolveOutputReviewGate = useWorkflowStore((s) => s.resolveOutputReviewGate);
  const releaseDecision = useWorkflowStore((s) => s.releaseDecision);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[] | null>(null);
  const [artifactsLoading, setArtifactsLoading] = useState(false);

  // T3 (B2/B4) — backend writes payload.summary (NOT outputSummary). Spec §6.3
  // says Output Review must render the artifact directly, not as a separate tab,
  // so we fetch the gate's OWN task artifacts here (no more stale "latest completed
  // phase" mismatch from the old ArtifactTab).
  const summary = (gate.payload?.summary as string | null) ?? null;
  const issues = gate.payload?.validationIssues ?? [];
  const isRelease = gate.type === 'FINAL_RELEASE';

  useEffect(() => {
    let cancelled = false;
    if (!gate.taskId || isRelease) {
      setArtifacts(null);
      setArtifactsLoading(false);
      return;
    }
    setArtifactsLoading(true);
    getSdlcTaskStatus(gate.taskId)
      .then((task) => {
        if (cancelled) return;
        setArtifacts(extractArtifacts(task));
      })
      .catch(() => {
        if (!cancelled) setArtifacts([]);
      })
      .finally(() => {
        if (!cancelled) setArtifactsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gate.taskId, isRelease]);

  const submit = async (action: 'approve' | 'reject') => {
    setBusy(action);
    setError(null);
    try {
      if (isRelease) {
        await releaseDecision(
          sessionId,
          action.toUpperCase() as 'APPROVE' | 'REJECT',
          comment.trim() || undefined,
        );
      } else {
        await resolveOutputReviewGate(sessionId, gate.id, action, comment.trim() || undefined);
      }
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-indigo-300">
          <FileCheck2 size={12} />
          {gate.type === 'FINAL_RELEASE' ? 'Release decision' : `${gate.type.replace('_OUTPUT_REVIEW', '')} output review`}
        </span>
        {issues.length > 0 && (
          <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[9px] font-bold text-red-400">
            {issues.length} issue{issues.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {summary && (
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">
            Output summary
          </label>
          <div className="rounded-lg bg-surface-container/60 px-3 py-2 text-[12px] leading-relaxed text-on-surface">{summary}</div>
        </div>
      )}

      {/* Spec §6.3: render the artifact directly. Markdown → react-markdown,
          code diff → monospace, HTML mockups → sandboxed iframe, images →
          <img>. Each artifact is labeled with its type so reviewers know
          what they're looking at. */}
      {!isRelease && (
        <ArtifactSection
          loading={artifactsLoading}
          artifacts={artifacts}
        />
      )}

      {issues.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {issues.map((issue, idx) => (
            <div key={idx} className="flex items-start gap-1.5 rounded-lg border border-red-500/15 bg-red-500/5 p-2 text-[11px] text-red-300">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              <span>{issue.message || issue.rule}</span>
            </div>
          ))}
        </div>
      )}

      <textarea
        rows={2}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Reason for rejection (required to reject)…"
        className="resize-none rounded-lg border border-outline-variant/30 bg-surface-container/60 px-2.5 py-1.5 text-[11px] text-on-surface outline-none focus:border-red-500/40"
      />

      {error && <div className="rounded-md bg-error/10 px-2 py-1 text-[10px] text-error">{error}</div>}

      <div className="flex gap-2">
        <button
          onClick={() => submit('reject')}
          disabled={busy !== null || (!isRelease && !comment.trim())}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-600/10 px-2 py-2 text-[11px] font-bold text-red-400 transition-colors hover:bg-red-600/20 disabled:opacity-40"
        >
          <X size={12} />
          Reject
        </button>
        <button
          onClick={() => submit('approve')}
          disabled={busy !== null}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-2 py-2 text-[11px] font-bold text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
        >
          {busy === 'approve' ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
          Approve
        </button>
      </div>
    </div>
  );
}

// ── Artifact rendering (spec §6.3) ─────────────────────────────────────────

interface Artifact {
  type: string;        // artifactType — e.g. 'prd', 'patch_diff', 'ux_spec'
  text?: string | null;
  json?: unknown;
}

/** Extract a normalized artifact list from a task fetched via getSdlcTaskStatus. */
function extractArtifacts(task: any): Artifact[] {
  const out: Artifact[] = [];
  const artifacts = Array.isArray(task?.artifacts) ? task.artifacts : [];
  // For ux-agent: only show the html_mockup preview. The other UX artifacts
  // (ux_spec / user_flow / wireframe_spec / screens / component_inventory)
  // are spec inputs for DEV — not what reviewers want on the dashboard.
  const isUx = task?.type === 'ux-agent';
  for (const a of artifacts) {
    if (!a || typeof a !== 'object') continue;
    const type = a.type ?? a.artifactType ?? 'artifact';
    if (isUx && type !== 'html_mockup') continue;
    const text = typeof a.contentText === 'string' ? a.contentText : null;
    const json = a.contentJson !== undefined && a.contentJson !== null ? a.contentJson : undefined;
    // Skip empty rows.
    if (!text && json === undefined) continue;
    out.push({ type, text, json });
  }
  return out;
}

const HTML_ARTIFACT_TYPES = new Set(['ux_spec', 'html_mockup', 'wireframe_spec']);
const DIFF_ARTIFACT_TYPES = new Set(['patch_diff', 'mock_code_diff']);
const IMAGE_KEYS = ['image_data', 'image', 'dataUrl', 'screenshot'];

function pickImageUrl(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const rec = json as Record<string, unknown>;
  for (const k of IMAGE_KEYS) {
    const v = rec[k];
    if (typeof v === 'string' && /^data:image\//.test(v)) return v;
    if (Array.isArray(v)) {
      const found = v.find((x) => typeof x === 'string' && /^data:image\//.test(x));
      if (found) return found as string;
    }
  }
  return null;
}

function ArtifactSection({ loading, artifacts }: { loading: boolean; artifacts: Artifact[] | null }) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-on-surface-variant">
        <Loader2 size={11} className="animate-spin" /> Loading artifact…
      </div>
    );
  }
  if (!artifacts || artifacts.length === 0) {
    return (
      <div className="rounded-lg border border-outline-variant/20 bg-surface-container/40 px-3 py-2 text-[11px] text-on-surface-variant/70">
        No artifact content available for this output yet.
      </div>
    );
  }

  // Render each artifact according to its kind. Order so reviewers see the
  // headline content first.
  const priority = ['prd', 'ux_spec', 'html_mockup', 'patch_diff', 'mock_code_diff', 'qa_report', 'architecture_brief'];
  const sorted = [...artifacts].sort((a, b) => {
    const ai = priority.indexOf(a.type);
    const bi = priority.indexOf(b.type);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  return (
    <div className="flex flex-col gap-3">
      {sorted.map((art, idx) => (
        <ArtifactBlock key={`${art.type}-${idx}`} artifact={art} />
      ))}
    </div>
  );
}

function ArtifactBlock({ artifact }: { artifact: Artifact }) {
  const label = artifact.type.replace(/_/g, ' ');
  // 1. HTML mockup → sandboxed iframe (UX agent's prototype is a full HTML doc).
  if (HTML_ARTIFACT_TYPES.has(artifact.type) && artifact.text && /<html/i.test(artifact.text)) {
    return (
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">
          {label} · HTML preview
        </div>
        <iframe
          title={label}
          srcDoc={artifact.text}
          sandbox=""
          className="h-[420px] w-full rounded-lg border border-outline-variant/30 bg-white"
        />
      </div>
    );
  }
  // 2. Code diff → monospace pre.
  if (DIFF_ARTIFACT_TYPES.has(artifact.type) && artifact.text) {
    return (
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">
          {label} · code diff
        </div>
        <pre className="max-h-[420px] overflow-auto whitespace-pre rounded-lg border border-outline-variant/20 bg-black/30 p-3 font-mono text-[10.5px] leading-relaxed text-on-surface">
{artifact.text}
        </pre>
      </div>
    );
  }
  // 3. Image preview → <img> if any field is a data URL.
  const imageUrl = pickImageUrl(artifact.json);
  if (imageUrl) {
    return (
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">
          {label} · image
        </div>
        <img
          src={imageUrl}
          alt={label}
          className="max-h-[420px] max-w-full rounded-lg border border-outline-variant/20 bg-white object-contain"
        />
      </div>
    );
  }
  // 4. Default: Markdown render for text, JSON.stringify for structured content.
  if (artifact.text && artifact.text.trim()) {
    return (
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">
          {label}
        </div>
        <div className="rounded-lg border border-outline-variant/20 bg-surface-container/60 p-3 text-[12px] leading-relaxed text-on-surface">
          <div className="prose prose-invert max-w-none text-[12px] leading-relaxed">
            <ReactMarkdown>{artifact.text}</ReactMarkdown>
          </div>
        </div>
      </div>
    );
  }
  if (artifact.json !== undefined) {
    return (
      <details className="rounded-lg border border-outline-variant/20 bg-surface-container/40">
        <summary className="cursor-pointer px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">
          {label} · structured
        </summary>
        <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap px-3 pb-3 font-mono text-[10.5px] text-on-surface">
{JSON.stringify(artifact.json, null, 2)}
        </pre>
      </details>
    );
  }
  return null;
}

// ── Decision History ──

function DecisionsTab({ history }: { history: import('@/models/SessionState').GateHistoryEntry[] }) {
  if (history.length === 0) {
    return <div className="text-[11px] text-on-surface-variant/60">No decisions made yet.</div>;
  }
  return (
    <ol className="flex flex-col gap-2">
      {history.map((entry, idx) => (
        <li key={`${entry.gateId}_${idx}`} className="rounded-lg border border-outline-variant/20 bg-surface-container/60 p-3">
          <div className="flex items-center justify-between text-[10px]">
            <span className="font-bold uppercase tracking-wider text-on-surface">{entry.agent ?? 'system'}</span>
            <span className="font-mono text-on-surface-variant">
              {new Date(entry.resolvedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px]">
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
              entry.decision === 'approve'
                ? 'bg-emerald-500/15 text-emerald-400'
                : entry.decision === 'reject'
                  ? 'bg-red-500/15 text-red-400'
                  : 'bg-blue-500/15 text-blue-400'
            }`}>{entry.decision}</span>
            <span className="text-on-surface-variant">{entry.type}</span>
          </div>
          {entry.comment && <p className="mt-1 text-[11px] italic text-on-surface-variant">“{entry.comment}”</p>}
        </li>
      ))}
    </ol>
  );
}
