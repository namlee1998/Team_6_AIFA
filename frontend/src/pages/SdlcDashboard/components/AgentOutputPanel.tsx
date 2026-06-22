import { useEffect, useState } from 'react';
import { X, Check, RefreshCw, AlertTriangle, Monitor, Layers, GitBranch, FileCode2, FileDiff, CheckCircle2, XCircle, ExternalLink } from 'lucide-react';
import { getSdlcTaskStatus, resolveOutputReviewGate, openFile, type GateItem } from '@/services/api/sdlcApi';

interface TaskArtifact {
  id: string;
  type: string;
  title: string;
  contentText: string | null;
  contentJson: unknown | null;
}

interface ScreenDef {
  name: string;
  route?: string;
  components?: string[];
}

interface UxArtifacts {
  ux_spec?: string;
  wireframe_spec?: string;
  screens?: ScreenDef[];
  component_inventory?: Record<string, { type?: string; action?: string; validation?: string; [key: string]: unknown }>;
  user_flow?: Array<{ step?: number; action?: string; expected?: string }>;
}

interface DevArtifacts {
  implementation_plan?: string;
  patch_diff?: string;
  mock_code_diff?: string;
  changed_files?: string[];
  build_result?: { build_ok?: boolean; tests_ran?: boolean; output?: string };
  self_test_report?: string;
  linked_ac_ids?: string[];
  risk_classification?: { level?: string };
}

interface AgentOutputPanelProps {
  agent: 'PO' | 'UX' | 'DEV' | 'QA';
  gate?: GateItem;
  taskId: string;
  onClose: () => void;
  onResolved: () => void;
}

const AGENT_LABEL: Record<string, string> = {
  PO: 'Product Owner', UX: 'UI/UX Designer', DEV: 'Developer', QA: 'Quality Assurance',
};

// ── Wireframe Component Renderer ────────────────────────────────────────────

function renderComponent(name: string, meta: { type?: string; action?: string; validation?: string } = {}) {
  const t = (meta.type || '').toLowerCase();
  const n = name.toLowerCase();

  if (t === 'button' || n.includes('button') || n.includes('btn') || n.includes('submit')) {
    const isDestructive = n.includes('delete') || n.includes('cancel');
    const isPrimary = n.includes('login') || n.includes('submit') || n.includes('confirm') || n.includes('register') || n.includes('save');
    return (
      <button
        key={name}
        className={`px-4 py-2 rounded-lg text-xs font-semibold cursor-default select-none ${
          isDestructive ? 'bg-red-500/20 border border-red-500/40 text-red-300' :
          isPrimary ? 'bg-blue-500/30 border border-blue-500/50 text-blue-200' :
          'bg-white/10 border border-white/20 text-white/70'
        }`}
        title={meta.action || name}
      >
        {name.replace(/([A-Z])/g, ' $1').trim()}
      </button>
    );
  }

  if (t === 'input' || n.includes('input') || n.includes('field') || n.includes('email') || n.includes('password') || n.includes('username')) {
    const isPassword = n.includes('password');
    return (
      <div key={name} className="flex flex-col gap-1 w-full">
        <label className="text-[9px] font-semibold text-white/50 uppercase tracking-wider">
          {name.replace(/([A-Z])/g, ' $1').trim()}
        </label>
        <div className="w-full h-7 rounded-md border border-white/15 bg-white/5 px-2 flex items-center">
          <span className="text-[10px] text-white/25 font-mono">
            {isPassword ? '••••••••' : meta.validation || `Enter ${name.replace(/([A-Z])/g, ' $1').trim().toLowerCase()}...`}
          </span>
        </div>
      </div>
    );
  }

  if (n.includes('link') || n.includes('anchor') || t === 'link') {
    return (
      <span key={name} className="text-[10px] text-blue-400 underline cursor-default select-none">
        {name.replace(/([A-Z])/g, ' $1').trim()}
      </span>
    );
  }

  if (n.includes('checkbox') || n.includes('toggle') || t === 'checkbox') {
    return (
      <div key={name} className="flex items-center gap-2">
        <div className="w-3.5 h-3.5 rounded border border-white/30 bg-white/5 flex-shrink-0" />
        <span className="text-[10px] text-white/60">{name.replace(/([A-Z])/g, ' $1').trim()}</span>
      </div>
    );
  }

  if (n.includes('text') || n.includes('label') || n.includes('heading') || n.includes('title')) {
    return (
      <div key={name} className="w-3/4 h-2.5 rounded-full bg-white/15" title={name} />
    );
  }

  if (n.includes('divider') || n.includes('separator')) {
    return <hr key={name} className="border-white/10 w-full" />;
  }

  // Default: generic block
  return (
    <div key={name} className="w-full h-6 rounded-md border border-white/10 bg-white/5 flex items-center px-2">
      <span className="text-[9px] text-white/30">{name.replace(/([A-Z])/g, ' $1').trim()}</span>
    </div>
  );
}

function UxWireframePreview({ uxData }: { uxData: UxArtifacts }) {
  const screens = uxData.screens || [];
  const inventory = uxData.component_inventory || {};
  const userFlow = uxData.user_flow || [];
  const [activeScreen, setActiveScreen] = useState(0);

  return (
    <div className="flex flex-col gap-3">
      {/* Section: Screens Tabs */}
      {screens.length > 0 && (
        <div className="bg-[#0f1117] rounded-xl border border-white/8 overflow-hidden">
          {/* Tabs */}
          {screens.length > 1 && (
            <div className="flex border-b border-white/8 overflow-x-auto">
              {screens.map((screen, idx) => (
                <button
                  key={idx}
                  onClick={() => setActiveScreen(idx)}
                  className={`px-3 py-2 text-[10px] font-semibold whitespace-nowrap flex items-center gap-1.5 transition-colors ${
                    idx === activeScreen
                      ? 'text-blue-300 border-b-2 border-blue-400 bg-blue-500/5'
                      : 'text-white/40 hover:text-white/70'
                  }`}
                >
                  <Monitor size={10} />
                  {screen.name || `Screen ${idx + 1}`}
                </button>
              ))}
            </div>
          )}

          {/* Wireframe Phone Mockup */}
          {screens[activeScreen] && (
            <div className="p-4 flex flex-col items-center">
              <div className="w-[200px] rounded-2xl border-2 border-white/15 bg-[#161922] overflow-hidden shadow-2xl">
                {/* Phone top bar */}
                <div className="h-5 bg-black/40 flex items-center justify-between px-3">
                  <div className="text-[7px] text-white/30">9:41</div>
                  <div className="flex gap-1">
                    <div className="w-2 h-1 rounded-sm bg-white/30" />
                    <div className="w-1.5 h-1 rounded-sm bg-white/20" />
                  </div>
                </div>
                {/* Screen route label */}
                {screens[activeScreen].route && (
                  <div className="px-3 py-1 bg-white/4 border-b border-white/6">
                    <span className="text-[8px] text-white/25 font-mono">{screens[activeScreen].route}</span>
                  </div>
                )}
                {/* Components */}
                <div className="p-3 flex flex-col gap-2.5 min-h-[200px]">
                  <div className="text-[10px] font-bold text-white/60 text-center pb-1">
                    {screens[activeScreen].name}
                  </div>
                  {(screens[activeScreen].components || []).map((compName) =>
                    renderComponent(compName, inventory[compName] || {})
                  )}
                  {(screens[activeScreen].components || []).length === 0 && (
                    <div className="flex-1 flex items-center justify-center">
                      <span className="text-[9px] text-white/20">No components defined</span>
                    </div>
                  )}
                </div>
              </div>
              <p className="text-[9px] text-white/25 mt-2">
                {screens[activeScreen].name} · {(screens[activeScreen].components || []).length} components
              </p>
            </div>
          )}
        </div>
      )}

      {/* Section: User Flow */}
      {userFlow.length > 0 && (
        <div className="bg-[#0f1117] rounded-xl border border-white/8 p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <GitBranch size={11} className="text-purple-400" />
            <span className="text-[9px] font-bold uppercase tracking-wider text-white/50">User Flow</span>
          </div>
          <div className="flex flex-col gap-2">
            {userFlow.map((step, idx) => (
              <div key={idx} className="flex gap-2 items-start">
                <div className="w-5 h-5 rounded-full bg-purple-500/20 border border-purple-500/30 flex-shrink-0 flex items-center justify-center">
                  <span className="text-[8px] font-bold text-purple-300">{step.step ?? idx + 1}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-white/80 leading-snug">{step.action}</p>
                  {step.expected && (
                    <p className="text-[9px] text-white/35 mt-0.5">→ {step.expected}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Section: Component Inventory */}
      {Object.keys(inventory).length > 0 && (
        <div className="bg-[#0f1117] rounded-xl border border-white/8 p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Layers size={11} className="text-emerald-400" />
            <span className="text-[9px] font-bold uppercase tracking-wider text-white/50">Component Inventory</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(inventory).map(([name, meta]) => (
              <div
                key={name}
                className="px-2 py-1 rounded-md bg-white/5 border border-white/10 flex items-center gap-1"
                title={JSON.stringify(meta)}
              >
                <span className="text-[8px] text-emerald-300/70 font-mono">{(meta as { type?: string }).type || '?'}</span>
                <span className="text-[9px] text-white/60">{name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* UX Spec text (collapsed) */}
      {uxData.ux_spec && (
        <details className="bg-[#0f1117] rounded-xl border border-white/8 overflow-hidden">
          <summary className="px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-white/40 cursor-pointer hover:text-white/60 list-none flex items-center justify-between">
            <span>UX Specification (raw)</span>
            <span className="text-[8px]">▾</span>
          </summary>
          <pre className="px-3 pb-3 text-[10px] text-white/50 whitespace-pre-wrap leading-relaxed font-mono max-h-[200px] overflow-y-auto">
            {uxData.ux_spec}
          </pre>
        </details>
      )}
    </div>
  );
}

// ── DEV Code Diff Viewer ────────────────────────────────────────────────────

function renderDiffLine(line: string, idx: number) {
  if (line.startsWith('+++') || line.startsWith('---')) {
    return (
      <div key={idx} className="px-2 py-0.5 text-white/50 font-mono text-[9px] bg-white/3">
        {line}
      </div>
    );
  }
  if (line.startsWith('+')) {
    return (
      <div key={idx} className="px-2 py-0.5 bg-emerald-500/10 border-l-2 border-emerald-500/60 font-mono text-[9.5px] text-emerald-300">
        {line}
      </div>
    );
  }
  if (line.startsWith('-')) {
    return (
      <div key={idx} className="px-2 py-0.5 bg-red-500/10 border-l-2 border-red-500/50 font-mono text-[9.5px] text-red-300">
        {line}
      </div>
    );
  }
  if (line.startsWith('@@')) {
    return (
      <div key={idx} className="px-2 py-0.5 bg-blue-500/10 font-mono text-[9px] text-blue-300/70">
        {line}
      </div>
    );
  }
  return (
    <div key={idx} className="px-2 py-0.5 font-mono text-[9.5px] text-white/50">
      {line || '\u00a0'}
    </div>
  );
}

function DevDiffViewer({ devData, projectId }: { devData: DevArtifacts; projectId?: string | null }) {
  const diff = devData.patch_diff || devData.mock_code_diff || '';
  const files = devData.changed_files || [];
  const buildOk = devData.build_result?.build_ok !== false;
  const testsRan = devData.build_result?.tests_ran === true;
  const riskLevel = devData.risk_classification?.level || 'LOW';

  const handleOpenFile = async (file: string) => {
    if (!projectId) return;
    try {
      await openFile(projectId, file);
    } catch (e) {
      console.error('Failed to open file:', e);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Build Status */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-bold ${
          buildOk ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300' : 'bg-red-500/15 border border-red-500/30 text-red-300'
        }`}>
          {buildOk ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
          Build {buildOk ? 'PASS' : 'FAIL'}
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-bold ${
          testsRan ? 'bg-blue-500/15 border border-blue-500/30 text-blue-300' : 'bg-white/5 border border-white/10 text-white/30'
        }`}>
          <CheckCircle2 size={10} />
          Tests {testsRan ? 'Ran' : 'Skipped'}
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-bold ${
          riskLevel === 'HIGH' ? 'bg-orange-500/15 border border-orange-500/30 text-orange-300' : 'bg-white/5 border border-white/10 text-white/40'
        }`}>
          Risk: {riskLevel}
        </div>
      </div>

      {/* Changed Files */}
      {files.length > 0 && (
        <div className="bg-[#0f1117] rounded-xl border border-white/8 p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <FileCode2 size={11} className="text-amber-400" />
            <span className="text-[9px] font-bold uppercase tracking-wider text-white/50">Changed Files ({files.length})</span>
          </div>
          <div className="flex flex-col gap-1">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1 rounded-md bg-white/3 border border-white/6 group hover:bg-white/5 transition-colors">
                <span className="text-emerald-400 text-[9px] font-bold shrink-0">M</span>
                <span className="text-[9.5px] text-white/60 font-mono truncate flex-1" title={f}>{f}</span>
                {projectId && (
                  <button 
                    onClick={() => handleOpenFile(f)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-blue-400 hover:text-blue-300 transition-opacity bg-blue-500/10 rounded"
                    title="Open in IDE"
                  >
                    <ExternalLink size={10} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Code Diff */}
      {diff && (
        <div className="bg-[#0c0e14] rounded-xl border border-white/8 overflow-hidden">
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/6 bg-[#0f1117]">
            <FileDiff size={11} className="text-blue-400" />
            <span className="text-[9px] font-bold uppercase tracking-wider text-white/50">Code Diff</span>
          </div>
          <div className="overflow-y-auto max-h-[300px] flex flex-col">
            {diff.split('\n').map((line, idx) => renderDiffLine(line, idx))}
          </div>
        </div>
      )}

      {/* Linked ACs */}
      {(devData.linked_ac_ids || []).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {(devData.linked_ac_ids || []).map((ac, i) => (
            <span key={i} className="px-2 py-0.5 rounded-md bg-purple-500/10 border border-purple-500/20 text-[9px] text-purple-300 font-mono">
              {ac}
            </span>
          ))}
        </div>
      )}

      {/* Implementation Plan (collapsed) */}
      {devData.implementation_plan && (
        <details className="bg-[#0f1117] rounded-xl border border-white/8 overflow-hidden">
          <summary className="px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-white/40 cursor-pointer hover:text-white/60 list-none flex items-center justify-between">
            <span>Implementation Plan</span>
            <span className="text-[8px]">▾</span>
          </summary>
          <pre className="px-3 pb-3 text-[10px] text-white/50 whitespace-pre-wrap leading-relaxed font-mono max-h-[200px] overflow-y-auto">
            {devData.implementation_plan}
          </pre>
        </details>
      )}
    </div>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────────

export default function AgentOutputPanel({ agent, gate, taskId, onClose, onResolved }: AgentOutputPanelProps) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<TaskArtifact[]>([]);
  const [uxData, setUxData] = useState<UxArtifacts | null>(null);
  const [devData, setDevData] = useState<DevArtifacts | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!taskId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    getSdlcTaskStatus(taskId)
      .then((task) => {
        if (cancelled) return;
        setSummary(task?.result?.summary || gate?.payload.outputSummary || null);
        if (task?.projectId) setProjectId(task.projectId);
        const arts: TaskArtifact[] = Array.isArray(task?.artifacts) ? task.artifacts : [];
        setArtifacts(arts);

        // For UX agent: try to extract structured UX data from agentOutput or artifacts
        if (agent === 'UX') {
          let extracted: UxArtifacts = {};
          // Try from agentOutput on the task result
          const agentOut = (task as { agentOutput?: unknown })?.agentOutput;
          if (agentOut && typeof agentOut === 'object') {
            extracted = agentOut as UxArtifacts;
          } else {
            // Fallback: reconstruct from individual artifacts
            for (const art of arts) {
              if (art.type === 'screens' && art.contentJson) extracted.screens = art.contentJson as ScreenDef[];
              if (art.type === 'ux_spec' && art.contentText) extracted.ux_spec = art.contentText;
              if (art.type === 'user_flow' && art.contentJson) extracted.user_flow = art.contentJson as UxArtifacts['user_flow'];
              if (art.type === 'component_inventory' && art.contentJson) extracted.component_inventory = art.contentJson as UxArtifacts['component_inventory'];
              if (art.type === 'wireframe_spec' && art.contentText) extracted.wireframe_spec = art.contentText;
            }
          }
          setUxData(extracted);
        }

        // For DEV agent: extract diff and build info
        if (agent === 'DEV') {
          let devExtracted: DevArtifacts = {};
          const agentOut = (task as { agentOutput?: unknown })?.agentOutput;
          if (agentOut && typeof agentOut === 'object') {
            devExtracted = agentOut as DevArtifacts;
          } else {
            for (const art of arts) {
              if ((art.type === 'patch_diff' || art.type === 'mock_code_diff') && art.contentText)
                devExtracted.patch_diff = art.contentText;
              if (art.type === 'changed_files' && art.contentJson)
                devExtracted.changed_files = art.contentJson as string[];
              if (art.type === 'implementation_plan' && art.contentText)
                devExtracted.implementation_plan = art.contentText;
              if (art.type === 'build_result' && art.contentJson)
                devExtracted.build_result = art.contentJson as DevArtifacts['build_result'];
              if (art.type === 'linked_ac_ids' && art.contentJson)
                devExtracted.linked_ac_ids = art.contentJson as string[];
              if (art.type === 'risk_classification' && art.contentJson)
                devExtracted.risk_classification = art.contentJson as DevArtifacts['risk_classification'];
            }
          }
          setDevData(devExtracted);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load agent output');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [taskId, gate?.payload.outputSummary, agent]);

  const handleApprove = async () => {
    if (!gate) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await resolveOutputReviewGate(gate.id, 'approve');
      onResolved();
      onClose();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to approve');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!gate || !reason.trim()) return;
    setSubmitting(true);
    setActionError(null);
    try {
      await resolveOutputReviewGate(gate.id, 'reject', reason.trim());
      onResolved();
      onClose();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to reject');
    } finally {
      setSubmitting(false);
    }
  };

  const hasUxPreview = agent === 'UX' && uxData && (
    (uxData.screens && uxData.screens.length > 0) ||
    (uxData.user_flow && uxData.user_flow.length > 0) ||
    Object.keys(uxData.component_inventory || {}).length > 0
  );

  const hasDevPreview = agent === 'DEV' && devData && (
    !!devData.patch_diff || !!devData.mock_code_diff ||
    (devData.changed_files && devData.changed_files.length > 0) ||
    !!devData.implementation_plan
  );

  return (
    <div className="fixed inset-0 z-[1000] flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md h-full bg-surface-container-lowest border-l border-outline-variant shadow-2xl flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-outline-variant shrink-0">
          <div>
            <h2 className="text-sm font-bold text-on-surface">{AGENT_LABEL[agent]} Output</h2>
            <p className="text-[10.5px] text-on-surface-variant mt-0.5">
              {gate ? 'Review the completed output, then approve or reject.' : 'View the generated output artifacts for this agent.'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-variant text-on-surface-variant hover:text-on-surface transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-4">
          {loading && (
            <div className="animate-pulse flex flex-col gap-3">
              <div className="w-full h-16 bg-surface-container-high rounded-xl" />
              <div className="w-full h-32 bg-surface-container-high rounded-xl" />
            </div>
          )}

          {loadError && (
            <div className="flex items-center gap-2 p-3 bg-error/10 border border-error/20 rounded-lg text-error text-[11px]">
              <AlertTriangle size={14} />
              {loadError}
            </div>
          )}

          {!loading && !loadError && (
            <>
              {summary && (
                <div className="p-3 bg-surface-container/60 border border-outline-variant/15 rounded-xl">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-on-surface-variant/70">Summary</span>
                  <p className="text-[11.5px] text-on-surface mt-1 leading-relaxed">{summary}</p>
                </div>
              )}

              {gate?.payload.validationIssues && gate.payload.validationIssues.length > 0 && (
                <div className="p-3 bg-red-500/5 border border-red-500/15 rounded-xl">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-red-400">Validation Issues</span>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {gate.payload.validationIssues.map((issue, idx) => (
                      <li key={idx} className="text-[10.5px] text-red-300 leading-relaxed">{issue.message || issue.rule}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* UX Wireframe Preview */}
              {hasUxPreview && uxData && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2 px-0.5">
                    <Monitor size={11} className="text-blue-400" />
                    <span className="text-[9px] font-bold uppercase tracking-wider text-white/50">Wireframe Preview</span>
                  </div>
                  <UxWireframePreview uxData={uxData} />
                </div>
              )}

              {/* DEV Code Diff Viewer */}
              {hasDevPreview && devData && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2 px-0.5">
                    <FileDiff size={11} className="text-amber-400" />
                    <span className="text-[9px] font-bold uppercase tracking-wider text-white/50">Code Changes</span>
                  </div>
                  <DevDiffViewer devData={devData} projectId={projectId} />
                </div>
              )}

              {/* Other agents (PO/QA): raw artifact list */}
              {!hasUxPreview && !hasDevPreview && (
                <>
                  {artifacts.length === 0 && !summary ? (
                    <p className="text-[11px] text-on-surface-variant/70 text-center py-6">No artifacts produced yet.</p>
                  ) : (
                    artifacts.map((artifact) => (
                      <div key={artifact.id} className="p-3 bg-surface-container/40 border border-outline-variant/15 rounded-xl">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-on-surface-variant/70">{artifact.title}</span>
                        {artifact.contentText ? (
                          <pre className="mt-1.5 text-[10.5px] text-on-surface whitespace-pre-wrap leading-relaxed max-h-[260px] overflow-y-auto custom-scrollbar font-mono">{artifact.contentText}</pre>
                        ) : artifact.contentJson ? (
                          <pre className="mt-1.5 text-[10px] text-on-surface-variant whitespace-pre-wrap leading-relaxed max-h-[260px] overflow-y-auto custom-scrollbar font-mono">{JSON.stringify(artifact.contentJson, null, 2)}</pre>
                        ) : null}
                      </div>
                    ))
                  )}
                </>
              )}
            </>
          )}
        </div>

        {gate && (
          <div className="p-4 border-t border-outline-variant shrink-0 flex flex-col gap-2">
            {actionError && (
              <div className="p-2 bg-error/10 border border-error/20 rounded-lg text-error text-[10.5px]">{actionError}</div>
            )}

            {showRejectForm ? (
              <>
                <textarea
                  autoFocus
                  placeholder="Reason for rejection (required)..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  className="w-full bg-black/30 border border-outline-variant/20 rounded-lg px-3 py-2 text-[11px] text-on-surface placeholder:text-on-surface-variant/40 resize-none outline-none focus:border-red-500/40 transition-colors"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowRejectForm(false); setReason(''); }}
                    disabled={submitting}
                    className="flex-1 py-2 rounded-lg border border-outline-variant/20 text-on-surface-variant hover:bg-surface-variant text-[11px] font-semibold transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleReject}
                    disabled={submitting || !reason.trim()}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-red-600/90 hover:bg-red-500 disabled:bg-surface-container-high disabled:cursor-not-allowed text-white text-[11px] font-bold transition-colors"
                  >
                    {submitting ? <RefreshCw size={12} className="animate-spin" /> : <X size={12} />}
                    Confirm Reject
                  </button>
                </div>
              </>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => setShowRejectForm(true)}
                  disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-red-600/10 border border-red-500/20 hover:bg-red-600/20 text-red-400 text-[11.5px] font-bold transition-colors disabled:opacity-50"
                >
                  <X size={13} />
                  Reject
                </button>
                <button
                  onClick={handleApprove}
                  disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-surface-container-high text-white text-[11.5px] font-bold transition-colors"
                >
                  {submitting ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
                  Approve
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
