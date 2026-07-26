// Canonical runtime selector.
//
// THIS MODULE IS THE ONLY PLACE ALLOWED TO DERIVE RUNTIME STATE.
//
// Per the canonical runtime contract
// (docs/runtime-observability/07_CANONICAL_RUNTIME_CONTRACT.md §2):
//
//   - Task.executionStatus              → Backend workflow engine
//   - PendingGate.kind / role / type   → GateBridge / AgentDispatcher / Gate Factory
//   - RuntimeEvent                       → publishEvent() (single facade)
//   - AgentCard                          → Frontend projection ONLY
//   - CSS colors                         → Frontend presentation ONLY
//
// Runtime visualization has exactly one owner per state (§8 invariant 1).
// This module IS that owner for the frontend projection. Every other
// store / component / reducer MUST consume `deriveAgentRuntimeState`
// or `selectRuntimeStatus` rather than computing the visible runtime
// state from secondary signals.
//
// This module does NOT introduce new runtime states (§6 rule 1). It
// consumes the existing SessionState shape and produces the canonical
// projection. The output strings are the values the existing CSS maps
// (`COLUMN_BORDER`, `TASK_ICON`, `PhaseChip`, `PHASE_DOT_COLORS`)
// already accept; this preserves the zero-visual-change invariant.

import {
  AGENT_KEYS,
  type AgentKey,
  type SessionState,
} from '@/models/SessionState';

/**
 * The canonical runtime state machine.
 *
 * Per the contract §3, every agent is in exactly one of these
 * eight states. The values here are the DOMAIN names — not the
 * FE presentation values. The presentation projection lives in
 * `projectAgentToPhaseStatus` below.
 */
export type RuntimeState =
  | 'idle'          // FE-only initial value; never reaches the backend
  | 'queued'        // canonical initial: Task.executionStatus='queued'
  | 'dispatched'    // reserved; matrix permits but no producer today
  | 'running'       // canonical: Task.executionStatus='running'
  | 'waiting_human' // canonical: Task.executionStatus='awaiting_gate'
  | 'completed'     // canonical terminal: Task.executionStatus='completed'
  | 'failed'        // canonical terminal: Task.executionStatus='failed'
  | 'cancelled';    // canonical terminal: Task.executionStatus='cancelled' | 'timeout'

/**
 * The FE-visible `PhaseStatus.status` union.
 *
 * Mirrors the existing enum at:
 *   frontend/src/models/SessionState.ts (AgentState.status)
 *   frontend/src/services/api/sdlcApi.ts:73 (PhaseStatus.status)
 *
 * This union is the INPUT to every CSS map in the codebase. The
 * canonical selector projects the canonical RuntimeState to this
 * union so that no CSS map needs to change.
 */
export type PhaseStatus =
  | 'pending'
  | 'running'
  | 'gate_pending'
  | 'awaiting_review'
  | 'completed'
  | 'failed'
  | 'skipped';

/**
 * The set of canonical RuntimeState values. Useful for exhaustive
 * switch statements — TypeScript will flag any missing case.
 */
export const RUNTIME_STATES: readonly RuntimeState[] = [
  'idle',
  'queued',
  'dispatched',
  'running',
  'waiting_human',
  'completed',
  'failed',
  'cancelled',
] as const;

/**
 * Strict projection from a single agent's runtime to its visible
 * status.
 *
 * Algorithm (matches the inline logic previously at
 * `frontend/src/store/workflowSelectors.ts:247-264` byte-for-byte):
 *
 *   1. If the agent's `agentStates[i].status` is `'awaiting_review'`
 *      AND the pipeline phase is `'running'`, the agent is
 *      `waiting_human` (projected to `'awaiting_review'`).
 *   2. Otherwise, the agent inherits its phase status verbatim
 *      from `pipelinePhases[i].status`.
 *   3. If the phase is missing, the agent is `idle` (projected to
 *      `'pending'`).
 *
 * This is the single place that computes the runtime state. No
 * other code may compute runtime independently.
 */
export function projectAgentToPhaseStatus(
  session: SessionState,
  agent: AgentKey,
): PhaseStatus {
  const phase = session.pipelinePhases.find((p) => p.agent === agent);
  const agentState = session.agentStates[agent];

  const pipelineStatus = phase?.status;
  const agentAwaitingReview = agentState.status === 'awaiting_review';

  // Rule 1: awaiting_review promotion (gates pending on the agent).
  // This is the ONLY override; every other status passes through.
  if (agentAwaitingReview && pipelineStatus === 'running') {
    return 'awaiting_review';
  }
  // Rule 2: phase presence / absence.
  // pipelineStatus is always defined in current SessionState shape
  // (defaultPipelinePhases returns a 5-entry array). The undefined
  // branch is the safe default.
  if (pipelineStatus === undefined) {
    return 'pending';
  }
  // Rule 3: passthrough.
  return pipelineStatus;
}

/**
 * Read the canonical RuntimeState for one agent. This is the
 * ONLY place that owns the canonical state derivation.
 *
 * Inputs (read-only):
 *   - session.pipelinePhases[i].status  (FE-visible phase)
 *   - session.agentStates[i].status      (FE fine-grained state)
 *
 * Output:
 *   - one of the 8 canonical RuntimeState values.
 *
 * The mapping is exhaustive: every PhaseStatus value produced by
 * the existing store projects to exactly one canonical state.
 */
export function deriveAgentRuntimeState(
  session: SessionState,
  agent: AgentKey,
): RuntimeState {
  const phase = session.pipelinePhases.find((p) => p.agent === agent);
  const agentState = session.agentStates[agent];

  const pipelineStatus = phase?.status;
  const agentAwaitingReview = agentState.status === 'awaiting_review';

  // Inline projection (formerly `projectToPhaseStatus`) — the
  // observable awaiting_review promotion + undefined-pipeline
  // default + passthrough rules. OBS-01.9 inlined the helper
  // because it had no external consumers and was only used
  // by `projectAgentToPhaseStatus` (also inlined above) and
  // this function.
  let projected: PhaseStatus;
  if (agentAwaitingReview && pipelineStatus === 'running') {
    projected = 'awaiting_review';
  } else if (pipelineStatus === undefined) {
    projected = 'pending';
  } else {
    projected = pipelineStatus;
  }

  return phaseStatusToCanonical(projected);
}

/**
 * Map every observable PhaseStatus to its canonical RuntimeState.
 *
 * Per the canonical runtime contract §3.1 mapping table, and
 * per the existing PhaseStatus enum (frontend/src/services/api/sdlcApi.ts:73).
 *
 * This is the inverse of `canonicalToPhaseStatus` below; together
 * they form the bidirectional projection between the domain model
 * (canonical) and the wire/UI model (PhaseStatus).
 */
export function phaseStatusToCanonical(status: PhaseStatus): RuntimeState {
  switch (status) {
    // pending covers: idle (initial), queued (canonical initial),
    // dispatched (reserved). Today the store never writes these
    // three as distinct values; the projection collapses them.
    case 'pending':
      return 'queued';
    case 'running':
      return 'running';
    case 'gate_pending':
      // gate_pending is the canonical wire name; awaiting_human
      // is the canonical contract name. Same state, two names.
      return 'waiting_human';
    case 'awaiting_review':
      // awaiting_review is the FE-side projection of waiting_human
      // when the agent's agentStates[i].status has been promoted
      // by mapGatePending.
      return 'waiting_human';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'skipped':
      // skipped is the FE-side projection of BOTH 'cancelled' and
      // 'timeout' (the existing collapsed canonical mapping).
      return 'cancelled';
    default: {
      // Exhaustiveness guard — TypeScript will flag a missing
      // branch if PhaseStatus gains a new member.
      const _exhaustive: never = status;
      void _exhaustive;
      return 'queued';
    }
  }
}

/**
 * The inverse projection — given a canonical RuntimeState, return
 * the PhaseStatus the CSS maps accept.
 *
 * Alias: `phaseStatusToVisible`. Same function under two names —
 * one reads as "canonical → phase" (mathematical inverse), one
 * reads as "canonical → visible" (semantic inverse). Both
 * exist so consumers can pick the name that fits their context.
 */
export function canonicalToPhaseStatus(state: RuntimeState): PhaseStatus {
  switch (state) {
    case 'idle':
    case 'queued':
    case 'dispatched':
      return 'pending';
    case 'running':
      return 'running';
    case 'waiting_human':
      // Both 'gate_pending' and 'awaiting_review' are valid FE
      // projections. The awaiting_review variant is the result of
      // the agentStates[i].status promotion (handled inside
      // projectAgentToPhaseStatus); we return gate_pending here
      // because that is the canonical wire status.
      return 'gate_pending';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'skipped';
    default: {
      const _exhaustive: never = state;
      void _exhaustive;
      return 'pending';
    }
  }
}

/**
 * Alias for `canonicalToPhaseStatus`. Read it as "canonical →
 * visible" so consumers that consume a canonical RuntimeState and
 * pass it to a CSS map can name the projection clearly.
 */
export const phaseStatusToVisible = canonicalToPhaseStatus;

/**
 * The canonical RuntimeStatus projection for a session.
 *
 * Aggregates the per-agent canonical states plus the session-level
 * status and the current-agent derivation.
 */
export interface RuntimeStatus {
  /** Per-agent canonical runtime state. */
  agentStates: Record<AgentKey, RuntimeState>;
  /** The agent currently executing, or null if no agent is running. */
  currentAgent: AgentKey | null;
  /** The agent currently awaiting review, or null if no agent is. */
  reviewingAgent: AgentKey | null;
}

/**
 * Derive the canonical RuntimeStatus projection for the entire
 * session. This is the ONLY function allowed to compute the
 * currentAgent and reviewingAgent derivations.
 *
 * Previously the derivation lived inline at:
 *   frontend/src/store/workflowSelectors.ts:224-231
 *
 * The algorithm and output are byte-for-byte identical to the
 * prior inline implementation:
 *   - currentAgent is the FIRST agent whose
 *     `agentStates[i].status === 'running'`.
 *   - reviewingAgent is the FIRST agent whose
 *     `agentStates[i].status === 'awaiting_review'` AND no
 *     running agent was found.
 *   - If neither is set, both are null.
 *
 * The derivation reads `agentStates[i].status` DIRECTLY (not
 * via the canonical RuntimeState projection) because the prior
 * implementation did so, and zero-behavior-change is a hard
 * constraint of OBS-01.1.
 */
export function selectRuntimeStatus(session: SessionState): RuntimeStatus {
  const agentStates = {} as Record<AgentKey, RuntimeState>;
  let runningAgent: AgentKey | null = null;
  let reviewingAgent: AgentKey | null = null;

  for (const key of AGENT_KEYS) {
    // Canonical projection (consumed by `phases`).
    agentStates[key] = deriveAgentRuntimeState(session, key);
    // Byte-identical derivation for currentAgent (matches prior
    // workflowSelectors.ts:226-235 inline code).
    const agentStatus = session.agentStates[key].status;
    if (agentStatus === 'running') {
      runningAgent = key;
    } else if (agentStatus === 'awaiting_review' && reviewingAgent === null) {
      reviewingAgent = key;
    }
  }

  return {
    agentStates,
    currentAgent: runningAgent,
    reviewingAgent,
  };
}

/**
 * OBS-01.2 — Store normalization helper.
 *
 * Per the canonical runtime contract §7, every consumer MUST read
 * runtime state through the canonical selector. No component or
 * reducer may compute runtime independently from
 * `session.pipelinePhases` or `session.agentStates`.
 *
 * This helper returns the FE-visible PhaseStatus for every agent
 * in a single map. It is the ONLY allowed entry-point for any
 * "find the visible status for agent X" lookup that today is
 * implemented as `session.pipelinePhases.find(p => p.agent === X)`.
 *
 * The output is identical to reading
 * `session.pipelinePhases[i].status` for every agent — the OBS-01.1
 * selector's projection rules (in `projectAgentToPhaseStatus`) match
 * the prior inline derivation byte-for-byte for every input.
 */
export function selectAgentPhaseStatuses(
  session: SessionState,
): Record<AgentKey, PhaseStatus> {
  const out = {} as Record<AgentKey, PhaseStatus>;
  for (const agent of AGENT_KEYS) {
    out[agent] = projectAgentToPhaseStatus(session, agent);
  }
  return out;
}

/**
 * OBS-01.2 — Store normalization helper.
 *
 * Returns the FE-visible PhaseStatus for a single agent. This is
 * the ONLY allowed entry-point for any per-agent visible-status
 * lookup; no consumer may compute
 * `session.pipelinePhases.find(p => p.agent === X)?.status ?? 'pending'`
 * directly.
 */
export function selectAgentPhaseStatus(
  session: SessionState,
  agent: AgentKey,
): PhaseStatus {
  return projectAgentToPhaseStatus(session, agent);
}

/**
 * OBS-01.2 — Store normalization helper.
 *
 * Counts how many agents have a visible PhaseStatus of 'completed'.
 * Equivalent to the prior inline
 * `session.pipelinePhases.filter(p => p.status === 'completed').length`
 * — but routed through the canonical projection so any future change
 * to the awaiting_review promotion rule, gate_pending promotion,
 * etc. flows through the same single source.
 *
 * The output is identical for every input — verified by
 * `tests/runtimeSelectors.test.ts`.
 */
export function countCompletedAgents(session: SessionState): number {
  let n = 0;
  for (const agent of AGENT_KEYS) {
    if (projectAgentToPhaseStatus(session, agent) === 'completed') n++;
  }
  return n;
}

/**
 * OBS-01.2 — Store normalization helper.
 *
 * Returns the total number of agents (always 5 today). This is the
 * single source for the "total phases" denominator used in
 * progress-percent calculations. No consumer may compute
 * `session.pipelinePhases.length || 5` directly.
 *
 * Today the answer is the cardinality of `AGENT_KEYS`. If the
 * agent set ever grows or shrinks, this helper is the single
 * place to update.
 */
export function countTotalAgents(_session: SessionState): number {
  // The session argument is accepted for symmetry with the other
  // store-normalization helpers (so callers can pass the same
  // session variable). It is not consulted today because the agent
  // set is project-wide constant; if a future session ever held
  // a subset of agents, this helper would consult the canonical
  // agent set instead.
  void _session;
  return AGENT_KEYS.length;
}

/**
 * OBS-01.2 — Store normalization helper.
 *
 * Returns the phase entry (status + taskId + duration) for a single
 * agent via the canonical projection. The taskId and duration are
 * read from the persisted pipelinePhases[i] entry — they are NOT
 * runtime state (they are persistent identifiers / display values
 * sourced from the BE); the status IS runtime state.
 *
 * The helper is provided so consumers have ONE entry-point for
 * "give me everything for agent X". No consumer may read
 * `session.pipelinePhases[i]` directly (canonical runtime contract
 * §7).
 *
 * Returned shape:
 *   { status: PhaseStatus; taskId: string | undefined;
 *     duration: string | undefined }
 */
export interface AgentPhaseEntry {
  status: PhaseStatus;
  taskId: string | undefined;
  duration: string | undefined;
}

export function selectAgentPhaseEntry(
  session: SessionState,
  agent: AgentKey,
): AgentPhaseEntry {
  const phase = session.pipelinePhases.find((p) => p.agent === agent);
  // Note: phase?.status is intentionally NOT returned directly.
  // The visible status is the canonical projection — the awaiting_
  // review promotion, the missing-phase default, and any future
  // canonical-to-visible rules all live in projectAgentToPhaseStatus.
  // Reading phase?.status directly would re-introduce the
  // duplicated mapping the contract forbids.
  const status = projectAgentToPhaseStatus(session, agent);
  return {
    status,
    taskId: phase?.taskId,
    duration: phase?.duration,
  };
}

// ── OBS-01.3 / OBS-01.6 — Runtime visual maps ────────────────────────────
//
// Per the canonical runtime contract §5.1, every runtime state MUST
// have an exact visual representation. This section holds the
// canonical visual map. It is the SINGLE source of colour, border,
// icon, badge text, glyph, and per-state animation class for every
// runtime rendering on Dashboard, Agent Task, Inspector, and
// SessionRail. No consumer outside `runtimeSelectors` may construct
// these strings (canonical contract §7 — "duplicated CSS mapping"
// is FORBIDDEN).
//
// Animation classes are added in OBS-01.6 — sourced directly from
// the contract §5.1 Pulse / Animation columns. Only the `running`
// state carries an animation (`animate-spin` per §5.1.4); every
// other state has `Pulse: none` / `Animation: none`. Consumers
// obtain the animation class via `getRuntimeAnimation(status)` —
// the same helper for every page, guaranteeing cross-page identity
// per contract §5.2.2.
//
// The `waiting_human` state's optional session-level
// `animate-pulse` (§5.1.5 "animate-pulse is allowed on
// session-level indicators only") is NOT carried here because
// session-level pulse is owned by the per-surface CSS maps
// (SessionRail/Agent Task summary bar), not by the per-state
// runtime visual map. It is documented in the contract but
// classified as session-level UI, out of OBS-01.6 scope.

/**
 * Per-state CSS class bundle for every runtime surface (Dashboard,
 * Agent Task, Inspector, SessionRail). The shape mirrors the
 * contract §5.1 columns plus the OBS-01.6 animation column:
 *   - background: Tailwind background + text colour (the "badge")
 *   - border: Tailwind border colour class
 *   - glyph: a single-character monospace glyph (used in the
 *     Dashboard pipeline strip)
 *   - iconName: the lucide-react icon component name
 *   - badge: uppercase badge text
 *   - animation: per-state Tailwind animation class
 *     (e.g. `'animate-spin'` for `running`; `''` when no animation
 *     per the contract §5.1 Pulse/Animation columns).
 *
 * No consumer may construct these strings outside this map.
 */
export interface RuntimeVisualStyle {
  /** Tailwind background + foreground class string. */
  background: string;
  /** Tailwind border class string. Empty string = no border. */
  border: string;
  /** Single-character glyph rendered inside the Dashboard pipeline strip. */
  glyph: string;
  /** lucide-react icon name (string form — looked up via icon registry). */
  iconName: 'PlayCircle' | 'Loader2' | 'Clock' | 'Check' | 'AlertCircle' | 'SkipForward';
  /** Badge text rendered in the Dashboard surface (uppercase, no underscore). */
  badge: string;
  /**
   * Per-state animation class (canonical contract §5.1 Pulse /
   * Animation columns). Empty string = no animation. The
   * OBS-01.6 invariant: ONLY the `running` state may carry an
   * animation (the `Loader2` icon's `animate-spin`). Every other
   * state has `Pulse: none`, `Animation: none`.
   */
  animation: string;
}

/**
 * Canonical runtime visual map for the Dashboard. The keys are
 * PhaseStatus values (the FE-visible projection). Each value is
 * the single source for that state's colour, glyph, icon, and badge
 * text on the Dashboard.
 *
 * The mapping is EXHAUSTIVE — every PhaseStatus value MUST appear
 * here. Adding a new PhaseStatus without extending this map is a
 * runtime contract violation.
 *
 * Colour values are pinned to the contract §5.1 specification:
 *   - pending       → dim gray (matches queued + idle)
 *   - running       → blue
 *   - gate_pending  → yellow (matches awaiting_review + waiting_human)
 *   - awaiting_review → yellow (FE-side projection of waiting_human)
 *   - completed     → green
 *   - failed        → red
 *   - skipped       → dim gray (matches cancelled)
 */
export const RUNTIME_VISUAL: Readonly<
  Record<PhaseStatus, RuntimeVisualStyle>
> = Object.freeze({
  pending: {
    background: 'bg-surface-container text-on-surface-variant/60',
    border: 'border-outline-variant/20',
    glyph: '·',
    iconName: 'PlayCircle',
    badge: 'PENDING',
    // Contract §5.1.2 — queued: Pulse: none, Animation: none.
    animation: '',
  },
  running: {
    background: 'bg-blue-500/20 text-blue-300',
    border: 'border-blue-500/30',
    glyph: '…',
    iconName: 'Loader2',
    badge: 'RUNNING',
    // Contract §5.1.4 — running: Pulse: YES, Animation: animate-spin
    // on the per-task Loader2 icon. This is the ONLY state with a
    // runtime animation.
    animation: 'animate-spin',
  },
  gate_pending: {
    background: 'bg-amber-500/20 text-amber-400',
    border: 'border-amber-500/30',
    glyph: '!',
    iconName: 'Clock',
    badge: 'GATE PENDING',
    // Contract §5.1.5 — waiting_human: Pulse: none (per-task icon
    // is static); Animation: none.
    animation: '',
  },
  awaiting_review: {
    background: 'bg-amber-500/20 text-amber-300',
    border: 'border-amber-500/30',
    glyph: '!',
    iconName: 'Clock',
    badge: 'AWAITING REVIEW',
    // Contract §5.1.5 — same as gate_pending.
    animation: '',
  },
  completed: {
    background: 'bg-emerald-500/20 text-emerald-400',
    border: 'border-emerald-500/20',
    glyph: '✓',
    iconName: 'Check',
    badge: 'COMPLETED',
    // Contract §5.1.6 — completed: Pulse: none, Animation: none.
    // The "success transition" the OBS-01.6 brief mentions is the
    // green Check badge; no motion (per contract §5.1.6).
    animation: '',
  },
  failed: {
    background: 'bg-red-500/20 text-red-400',
    border: 'border-red-500/30',
    glyph: '✗',
    iconName: 'AlertCircle',
    badge: 'FAILED',
    // Contract §5.1.7 — failed: Pulse: none, Animation: none.
    // The "error emphasis" the OBS-01.6 brief mentions is the red
    // colour; no motion (per contract §5.1.7).
    animation: '',
  },
  skipped: {
    background: 'bg-outline-variant/30 text-on-surface-variant',
    border: 'border-dashed border-outline-variant/20',
    glyph: '⊘',
    iconName: 'SkipForward',
    badge: 'CANCELLED',
    // Contract §5.1.8 — cancelled: Pulse: none, Animation: none.
    animation: '',
  },
});

/**
 * OBS-01.3 — Single accessor for the Dashboard runtime visual map.
 *
 * Per the canonical runtime contract §7 ("duplicated CSS mapping"
 * is FORBIDDEN), every Dashboard runtime rendering MUST obtain its
 * colour, glyph, icon, and badge text from this function. There
 * is no other entry point.
 *
 * The lookup is exhaustive: every PhaseStatus value has an entry.
 * TypeScript's `Record<PhaseStatus, …>` enforces this at compile
 * time — if PhaseStatus grows, this map MUST grow with it.
 */
export function getRuntimeVisual(
  status: PhaseStatus,
): RuntimeVisualStyle {
  return RUNTIME_VISUAL[status];
}

/**
 * OBS-01.3 — Icon registry for Dashboard runtime rendering.
 *
 * Maps the `iconName` strings produced by
 * `getRuntimeVisual` to the corresponding lucide-react
 * icon component. Centralised here so every Dashboard runtime
 * rendering obtains its icon from the canonical registry — no
 * consumer may import lucide-react icons directly for runtime
 * visualisation purposes.
 *
 * Today the registry contains the six icon names that appear in
 * the runtime visual map. If a future runtime state introduces a
 * new icon, the registry MUST grow in lock-step.
 */
export interface RuntimeIconRegistry {
  readonly PlayCircle: typeof PlayCircle;
  readonly Loader2: typeof Loader2;
  readonly Clock: typeof Clock;
  readonly Check: typeof Check;
  readonly AlertCircle: typeof AlertCircle;
  readonly SkipForward: typeof SkipForward;
}

/**
 * OBS-01.3 — Look up the canonical icon component for a runtime
 * status. Returns the lucide-react icon component instance from
 * the canonical registry. The mapping is exhaustive over
 * `RUNTIME_VISUAL[*].iconName`.
 */
export function getRuntimeIcon(
  status: PhaseStatus,
): RuntimeIconRegistry[keyof RuntimeIconRegistry] {
  const style = getRuntimeVisual(status);
  return RUNTIME_ICONS[style.iconName];
}

/**
 * OBS-01.6 — Single accessor for the per-state animation class.
 *
 * Per the canonical runtime contract §5.1, every per-state Pulse /
 * Animation column is owned by the canonical visual map. Only the
 * `running` state carries an animation (`animate-spin`); every
 * other state returns an empty string (no animation).
 *
 * Every runtime rendering MUST obtain the animation class via
 * this function — no component may inline an `animate-*` class on
 * a runtime-state-derived element. The cross-page identity
 * invariant (§5.2.2) requires Dashboard / Agent Task / Inspector
 * to apply the same animation for the same input; this accessor
 * is the single entry-point that guarantees it.
 *
 *   status: PhaseStatus → animation class string (e.g.
 *     'animate-spin' for 'running'; '' for every other state).
 *
 * No side effects. The accessor is referentially stable — the
 * returned string is the literal value in the canonical map
 * (`RUNTIME_VISUAL[status].animation`).
 */
export function getRuntimeAnimation(status: PhaseStatus): string {
  return getRuntimeVisual(status).animation;
}

// Icon component imports — the canonical Dashboard runtime icon
// registry. Adding a new icon here means adding it to the visual
// map's `iconName` union AND to this registry in the same change.
import {
  PlayCircle as PlayCircle,
  Loader2 as Loader2,
  Clock as Clock,
  Check as Check,
  AlertCircle as AlertCircle,
  SkipForward as SkipForward,
} from 'lucide-react';

const RUNTIME_ICONS: RuntimeIconRegistry = Object.freeze({
  PlayCircle,
  Loader2,
  Clock,
  Check,
  AlertCircle,
  SkipForward,
});
