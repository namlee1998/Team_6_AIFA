import type { TestcaseItem } from '@/services/api';
import i18n from 'i18next';

export interface ScenarioStep {
  id: string;
  action: string;
  expected_result: string;
}

export interface ScenarioData {
  id: string;
  name: string;
  type: string;
  priority: string;
  preconditions: string[];
  steps: ScenarioStep[];
  test_data: Record<string, string>;
  expected_outcome: string;
  flow_name?: string;
  feature_name?: string;
}

export interface FlowNode {
  flowName: string;
  count: number;
  happyCount: number;
  negativeCount: number;
  edgeCount: number;
}

export interface FeatureGroup {
  featureName: string;
  flows: FlowNode[];
  totalCount: number;
}

export type TypeFilter = 'all' | 'happy' | 'negative' | 'edge';

export interface FlowSection {
  flowName: string;
  featureName: string;
  sourcePath?: string;
  stepCount?: number;
}

export interface Agent2InputSnapshot {
  sourceTaskId: string;
  capturedAt: string;
  flowCount: number;
  featureCount: number;
  flowKeys: string[];
  signature: string;
  flows: FlowSection[];
}

function getScenarioData(tc: TestcaseItem): ScenarioData | null {
  if (!tc.scenarioData) return null;
  const d = tc.scenarioData as Record<string, unknown>;
  return {
    id: String(d.id ?? tc.id),
    name: String(d.name ?? tc.flowName ?? ''),
    type: String(d.type ?? ''),
    priority: String(d.priority ?? ''),
    preconditions: Array.isArray(d.preconditions) ? (d.preconditions as string[]) : [],
    steps: Array.isArray(d.steps) ? (d.steps as ScenarioStep[]) : [],
    test_data: (d.test_data as Record<string, string>) ?? {},
    expected_outcome: String(d.expected_outcome ?? ''),
    flow_name: String(d.flow_name ?? tc.flowName ?? ''),
    feature_name: String(d.feature_name ?? tc.featureName ?? ''),
  };
}

export function classifyType(type: string): 'happy' | 'negative' | 'edge' | 'other' {
  const t = type.toLowerCase();
  if (t === 'happy' || t === 'functional') return 'happy';
  if (t === 'negative' || t === 'error') return 'negative';
  if (t === 'edge' || t === 'boundary') return 'edge';
  return 'other';
}

export function matchesTypeFilter(type: string, filter: TypeFilter): boolean {
  if (filter === 'all') return true;
  return classifyType(type) === filter;
}

export function toFlowKey(flow: FlowSection): string {
  return `${flow.featureName}|${flow.flowName}|${flow.stepCount ?? 0}`;
}

export function buildInputSignature(flowKeys: string[]): string {
  return [...flowKeys].sort().join('::');
}

export function computeInputDiff(
  previous: Agent2InputSnapshot | null,
  currentSignature: string,
  currentFlowKeys: string[],
): { status: 'new' | 'up_to_date' | 'changed'; added: string[]; removed: string[] } {
  if (!previous) return { status: 'new', added: currentFlowKeys, removed: [] };
  if (previous.signature === currentSignature) {
    return { status: 'up_to_date', added: [], removed: [] };
  }

  const current = new Set(currentFlowKeys);
  const old = new Set(previous.flowKeys);
  return {
    status: 'changed',
    added: previous.flowKeys.filter((key) => !current.has(key)),
    removed: currentFlowKeys.filter((key) => !old.has(key)),
  };
}

export function buildTree(testcases: TestcaseItem[]): FeatureGroup[] {
  const map = new Map<string, Map<string, TestcaseItem[]>>();

  for (const tc of testcases) {
    const sd = getScenarioData(tc);
    const featureName = sd?.feature_name || tc.featureName || i18n.t('common.other');
    const flowName = sd?.flow_name || tc.flowName || 'Unknown Flow';

    if (!map.has(featureName)) map.set(featureName, new Map());
    const flowMap = map.get(featureName)!;
    if (!flowMap.has(flowName)) flowMap.set(flowName, []);
    flowMap.get(flowName)!.push(tc);
  }

  return Array.from(map.entries()).map(([featureName, flowMap]) => {
    const flows: FlowNode[] = Array.from(flowMap.entries()).map(([flowName, tcs]) => {
      const types = tcs.map((tc) =>
        classifyType(String((tc.scenarioData as Record<string, unknown>)?.type ?? '')),
      );
      return {
        flowName,
        count: tcs.length,
        happyCount: types.filter((t) => t === 'happy').length,
        negativeCount: types.filter((t) => t === 'negative').length,
        edgeCount: types.filter((t) => t === 'edge').length,
      };
    });
    return {
      featureName,
      flows,
      totalCount: flows.reduce((s, f) => s + f.count, 0),
    };
  });
}
