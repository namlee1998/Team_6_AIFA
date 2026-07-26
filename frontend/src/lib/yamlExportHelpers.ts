import type { TestcaseItem } from '@/services/api';

export interface ScenarioData {
  id: string;
  name: string;
  type: string;
  priority: string;
  flow_name?: string;
  feature_name?: string;
}

export interface ScenarioWithYaml {
  tc: TestcaseItem;
  sd: ScenarioData;
  yaml: TestcaseItem | null;
}

export interface FlowGroup {
  flowName: string;
  scenarios: ScenarioWithYaml[];
}

export interface FeatureGroup {
  featureName: string;
  flows: FlowGroup[];
  totalYaml: number;
}

function getScenarioData(tc: TestcaseItem): ScenarioData {
  const d = (tc.scenarioData ?? {}) as Record<string, unknown>;
  return {
    id: String(d.id ?? tc.id),
    name: String(d.name ?? tc.flowName ?? ''),
    type: String(d.type ?? ''),
    priority: String(d.priority ?? ''),
    flow_name: String(d.flow_name ?? tc.flowName ?? ''),
    feature_name: String(d.feature_name ?? tc.featureName ?? ''),
  };
}

export function buildGroupedTree(
  agent2Testcases: TestcaseItem[],
  yamlFiles: TestcaseItem[],
): FeatureGroup[] {
  const yamlMap = new Map<string, TestcaseItem>();
  for (const y of yamlFiles) {
    if (y.yamlFilename) {
      yamlMap.set(y.yamlFilename.replace(/\.yaml$/i, ''), y);
      yamlMap.set(y.yamlFilename, y);
    }
  }

  const featureMap = new Map<string, Map<string, ScenarioWithYaml[]>>();

  for (const tc of agent2Testcases) {
    const sd = getScenarioData(tc);
    const feat = sd.feature_name || tc.featureName || 'Unknown Feature';
    const flow = sd.flow_name || tc.flowName || 'Unknown Flow';
    const yaml = yamlMap.get(sd.id) ?? yamlMap.get(`${sd.id}.yaml`) ?? null;

    if (!featureMap.has(feat)) featureMap.set(feat, new Map());
    const flowMap = featureMap.get(feat)!;
    if (!flowMap.has(flow)) flowMap.set(flow, []);
    flowMap.get(flow)!.push({ tc, sd, yaml });
  }

  return Array.from(featureMap.entries()).map(([featureName, flowMap]) => {
    const flows: FlowGroup[] = Array.from(flowMap.entries()).map(([flowName, scenarios]) => ({
      flowName,
      scenarios,
    }));
    const totalYaml = flows.reduce((s, f) => s + f.scenarios.filter((x) => x.yaml).length, 0);
    return { featureName, flows, totalYaml };
  });
}

export function formatSize(content: string): string {
  const bytes = new Blob([content]).size;
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

export function getFilename(tc: Pick<TestcaseItem, 'featureName' | 'yamlFilename'>): string {
  return tc.yamlFilename || `${tc.featureName}.yaml`;
}
