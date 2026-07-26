import { useEffect, useState } from 'react';
import { Check, Loader2, MessageSquare, Sparkles } from 'lucide-react';
import type { ClarificationQuestion, GateItem } from '@/services/api/sdlcApi';
import { useWorkflowStore } from '@/store/useWorkflowStore';

interface ClarificationPanelProps {
  sessionId: string;
  gate: GateItem;
  onResolved?: () => void;
}

/**
 * Single clarification question component. Reused by the right Inspector
 * (Agent Tasks page) and the OverviewPage HITL section. Per requirement:
 * only ONE clarification/question component exists in the app.
 *
 * Submission goes through `useWorkflowStore.resolveClarification` — that
 * store action performs a pure HTTP call; the resulting state change is
 * delivered by SSE.
 */
export function ClarificationPanel({ sessionId, gate, onResolved }: ClarificationPanelProps) {
  const resolveClarification = useWorkflowStore((s) => s.resolveClarification);

  const questions: ClarificationQuestion[] = gate.payload?.questions ?? [];
  const firstQ = questions[0];

  const suggestedAnswer =
    firstQ?.options?.[0]?.description ?? firstQ?.options?.[0]?.label ?? firstQ?.header ?? '';

  const [editableAnswer, setEditableAnswer] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setEditableAnswer('');
  }, [gate?.id]);

  if (!firstQ) return null;

  const submit = async () => {
    setSubmitting(true);
    try {
      await resolveClarification(sessionId, gate.id, { [firstQ.question]: editableAnswer || suggestedAnswer });
      onResolved?.();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4">
      <div className="flex items-center gap-2">
        <MessageSquare size={14} className="text-cyan-400" />
        <span className="text-xs font-bold uppercase tracking-wide text-cyan-300">Human Question</span>
      </div>

      <div>
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">
          Question
        </label>
        <div className="rounded-lg bg-surface-container/60 px-3 py-2 text-sm text-on-surface">{firstQ.question}</div>
      </div>

      <div>
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">
          Suggested answer
        </label>
        <div className="flex items-start gap-2 rounded-lg bg-surface-container/60 px-3 py-2 text-sm text-on-surface">
          <Sparkles size={12} className="mt-0.5 shrink-0 text-cyan-400" />
          <span className="flex-1">{suggestedAnswer || '—'}</span>
          <button
            onClick={() => setEditableAnswer(suggestedAnswer)}
            disabled={!suggestedAnswer}
            className="shrink-0 rounded bg-primary/15 px-2 py-1 text-[10px] font-bold text-primary transition-colors hover:bg-primary/25 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Apply
          </button>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">
          Your answer
        </label>
        <textarea
          value={editableAnswer}
          onChange={(e) => setEditableAnswer(e.target.value)}
          rows={3}
          placeholder={suggestedAnswer || 'Type your answer…'}
          className="w-full resize-none rounded-lg bg-surface-container/60 px-3 py-2 text-sm text-on-surface outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div className="flex justify-end">
        <button
          onClick={submit}
          disabled={submitting || (!editableAnswer && !suggestedAnswer)}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-on-primary transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          Submit
        </button>
      </div>
    </div>
  );
}
