import { useState } from 'react';
import { Check, Loader2, Shield, X } from 'lucide-react';
import { useWorkflowStore } from '@/store/useWorkflowStore';
import type { GateItem } from '@/services/api/sdlcApi';

interface ToolGatePanelProps {
  sessionId: string;
  gate: GateItem;
  onResolved?: () => void;
}

/**
 * Renders a HITL_REVIEW / DEV_FILE_GATE gate (kind='tool'). The agent is
 * paused on a tool call (Bash/Write/Edit/...) and is awaiting an explicit
 * human approve/reject before resuming in-place.
 *
 * The backend canonical contract is `POST /approvals/:id { action, comment }`,
 * served by `useWorkflowStore.resolveApproval`. That endpoint is shared by
 * every gate kind — this panel does NOT introduce a new contract.
 */
export function ToolGatePanel({ sessionId, gate, onResolved }: ToolGatePanelProps) {
  const resolveToolGate = useWorkflowStore((s) => s.resolveToolGate);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toolName = (gate.payload?.tool || gate.payload?.toolName || 'tool').toString();
  const filePath = gate.payload?.path || gate.payload?.file_path || gate.payload?.display?.filePath || null;
  const reason = gate.payload?.reason || gate.payload?.category || '';
  const diff = gate.payload?.diff || gate.payload?.display?.diffPreview || '';

  const submit = async (action: 'approve' | 'reject') => {
    setBusy(action);
    setError(null);
    try {
      await resolveToolGate(sessionId, gate.id, action, comment);
      onResolved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex items-center gap-2">
        <Shield size={14} className="text-amber-400" />
        <span className="text-xs font-bold uppercase tracking-wide text-amber-300">Tool approval</span>
        <span className="ml-auto rounded-full bg-amber-500/20 px-2 py-0.5 text-[9px] font-bold text-amber-300">
          {gate.role || 'agent'}
        </span>
      </div>

      <div>
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">
          Tool
        </label>
        <div className="rounded-lg bg-surface-container/60 px-3 py-2 font-mono text-sm text-on-surface">{toolName}</div>
      </div>

      {filePath && (
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">
            Path
          </label>
          <div className="rounded-lg bg-surface-container/60 px-3 py-2 font-mono text-[12px] text-on-surface break-all">{filePath}</div>
        </div>
      )}

      {reason && (
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">
            Reason
          </label>
          <div className="rounded-lg bg-surface-container/60 px-3 py-2 text-sm text-on-surface">{reason}</div>
        </div>
      )}

      {diff && (
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">
            Diff preview
          </label>
          <pre className="max-h-[280px] overflow-auto whitespace-pre rounded-lg border border-outline-variant/20 bg-black/30 p-3 font-mono text-[10.5px] leading-relaxed text-on-surface">
{diff}
          </pre>
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
          disabled={busy !== null || !comment.trim()}
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
          {busy === 'approve' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          Approve
        </button>
      </div>
    </div>
  );
}
