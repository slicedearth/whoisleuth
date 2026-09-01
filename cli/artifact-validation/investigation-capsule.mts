import {
  INVESTIGATION_CAPSULE_ANALYST_RECORDS_SCHEMA,
  INVESTIGATION_CAPSULE_ANALYST_RECORDS_VERSION,
  INVESTIGATION_CAPSULE_VERSION,
  PUBLIC_INVESTIGATION_CAPSULE_VERSION,
} from '../../packages/investigation/investigation-capsule.mts';
import {
  LOOKUP_ASSET_GRAPH_SCHEMA,
  LOOKUP_ASSET_GRAPH_VERSION,
} from '../../packages/investigation/lookup-asset-graph.mts';
import {
  PUBLIC_LOOKUP_INVESTIGATION_BRIEF_VERSION,
  LOOKUP_INVESTIGATION_BRIEF_SCHEMA,
  LOOKUP_INVESTIGATION_BRIEF_VERSION,
  MAX_LOOKUP_INVESTIGATION_BRIEF_BYTES,
} from '../../packages/investigation/lookup-investigation-brief.mts';
import {
  DECISION_FACT_CONSISTENCY_STATES,
  DECISION_FACT_EVIDENCE_STATES,
  DECISION_FACT_FRESHNESS_STATES,
  DECISION_FACT_PROVENANCE_STATES,
  DECISION_FACT_PROJECTION_VERSION,
  DECISION_FACT_VERSION,
  MAX_DECISION_FACT_CONTRIBUTORS,
  MAX_DECISION_FACT_CONTRADICTIONS,
  MAX_DECISION_FACT_LIMITATIONS,
  MAX_DECISION_FACT_NEXT_ACTIONS,
  MAX_DECISION_FACT_PROJECTION_CONTRADICTIONS,
  MAX_DECISION_FACT_PROJECTION_BYTES,
  MAX_DECISION_FACT_PROJECTION_FACTS,
  MAX_DECISION_FACT_PROJECTION_LIMITATIONS,
  MAX_DECISION_FACT_PROJECTION_NEXT_ACTIONS,
  MAX_DECISION_FACT_PROJECTION_REFERENCES,
  MAX_DECISION_FACT_PROJECTION_SOURCES,
  MAX_DECISION_FACT_PROJECTION_SOURCE_LIMITATIONS,
  MAX_DECISION_FACT_PROJECTION_SOURCE_REFERENCES,
  MAX_DECISION_FACT_REFERENCES,
  MAX_DECISION_FACTS,
  decisionFactCompleteness,
} from '../../packages/evidence/decision-fact.mts';
import {
  MAX_CASE_ASSERTIONS,
  MAX_CASE_DECISIONS,
  MAX_DECISION_PIN_REFERENCES,
} from '../../packages/cases/case-response-model.mts';
import {
  array,
  boolean,
  digest,
  enumeration,
  exact,
  exactOptional,
  fail,
  integer,
  iso,
  optionalText,
  sameValues,
  strings,
  text,
  type UnknownRecord,
} from './structure-primitives.mts';

type ProjectionCollectionValidation = Readonly<{
  total: number;
  displayed: number;
  omitted: number;
  items: unknown[];
}>;

function validateBriefFact(value: unknown, label: string): void {
  const fact = exact(value, ['label', 'value', 'detail', 'provenance'], label);
  text(fact.label, label, 320);
  text(fact.value, label, 2_000);
  text(fact.detail, label, 1_000, true);
  const provenance = exact(fact.provenance, ['sources', 'observedAt', 'fieldFamilies', 'normalization', 'completeness', 'limitations', 'conflicts', 'decisionImpact'], label);
  strings(provenance.sources, label, 8, 320);
  text(provenance.observedAt, label, 64);
  strings(provenance.fieldFamilies, label, 8, 320);
  text(provenance.normalization, label, 320);
  text(provenance.completeness, label, 320);
  strings(provenance.limitations, label, 8, 320);
  strings(provenance.conflicts, label, 8, 320);
  text(provenance.decisionImpact, label, 320);
}

function validateDecisionEntry(value: unknown, label: string): void {
  const entry = exact(value, ['id', 'state', 'importance', 'title', 'detail', 'sources', 'href'], label);
  text(entry.id, label, 80);
  enumeration(entry.state, ['conflict', 'uncertain'], label);
  enumeration(entry.importance, ['high', 'medium', 'low'], label);
  text(entry.title, label, 320);
  text(entry.detail, label, 1_000);
  strings(entry.sources, label, 12, 320);
  if (typeof entry.href !== 'string' || !/^#[^\u0000-\u001f\u007f]{1,160}$/u.test(entry.href)) fail(label);
}

function validatePublicBrief(value: unknown): void {
  const brief = exact(value, ['schema', 'schemaVersion', 'generatedAt', 'target', 'targetType', 'task', 'taskLabel', 'question', 'summary', 'observation', 'verifiedFacts', 'contradictions', 'unknowns', 'nextActions', 'relationships', 'limitations'], 'Investigation capsule brief');
  if (brief.schema !== LOOKUP_INVESTIGATION_BRIEF_SCHEMA
    || brief.schemaVersion !== PUBLIC_LOOKUP_INVESTIGATION_BRIEF_VERSION) fail('Investigation capsule brief');
  iso(brief.generatedAt, 'Investigation capsule brief generatedAt');
  text(brief.target, 'Investigation capsule brief target', 253);
  text(brief.targetType, 'Investigation capsule brief target type', 40);
  enumeration(brief.task, ['general', 'acquisition', 'brand', 'incident', 'owned'], 'Investigation capsule brief task');
  text(brief.taskLabel, 'Investigation capsule brief task label', 320);
  text(brief.question, 'Investigation capsule brief question', 320);
  text(brief.summary, 'Investigation capsule brief summary', 500);
  const observation = exact(brief.observation, ['observedAt', 'evidenceAgeDays', 'completeSources', 'limitedSources', 'freshnessPolicy'], 'Investigation capsule observation');
  iso(observation.observedAt, 'Investigation capsule observation time', true);
  if (observation.evidenceAgeDays !== null) integer(observation.evidenceAgeDays, 'Investigation capsule evidence age', 0, 1_000_000);
  integer(observation.completeSources, 'Investigation capsule complete sources', 0, 100);
  integer(observation.limitedSources, 'Investigation capsule limited sources', 0, 100);
  const policy = exact(observation.freshnessPolicy, ['version', 'id', 'task', 'thresholdsDays'], 'Investigation capsule freshness policy');
  if (policy.version !== 1) fail('Investigation capsule freshness policy');
  enumeration(policy.id, ['task-default', 'analyst-custom'], 'Investigation capsule freshness policy');
  if (policy.task !== brief.task) fail('Investigation capsule freshness policy');
  const thresholds = exact(policy.thresholdsDays, ['registration', 'network', 'web'], 'Investigation capsule freshness thresholds');
  for (const key of ['registration', 'network', 'web'] as const) integer(thresholds[key], 'Investigation capsule freshness threshold', 0, 3650);
  array(brief.verifiedFacts, 'Investigation capsule verified facts', 12).forEach((item, index) => validateBriefFact(item, `Investigation capsule fact ${index + 1}`));
  array(brief.contradictions, 'Investigation capsule contradictions', 24).forEach((item, index) => validateDecisionEntry(item, `Investigation capsule contradiction ${index + 1}`));
  array(brief.unknowns, 'Investigation capsule unknowns', 24).forEach((item, index) => validateDecisionEntry(item, `Investigation capsule unknown ${index + 1}`));
  for (const [index, candidate] of array(brief.nextActions, 'Investigation capsule next actions', 6).entries()) {
    const action = exact(candidate, ['id', 'label', 'reason', 'expectedOutcome', 'href', 'priority'], `Investigation capsule next action ${index + 1}`);
    text(action.id, 'Investigation capsule next action id', 80);
    text(action.label, 'Investigation capsule next action label', 320);
    text(action.reason, 'Investigation capsule next action reason', 500);
    text(action.expectedOutcome, 'Investigation capsule next action outcome', 500);
    if (typeof action.href !== 'string' || !/^#[^\u0000-\u001f\u007f]{1,160}$/u.test(action.href)) fail('Investigation capsule next action href');
    enumeration(action.priority, ['high', 'medium', 'low'], 'Investigation capsule next action priority');
  }
  const relationships = exact(brief.relationships, ['nodes', 'edges', 'truncated', 'kinds'], 'Investigation capsule relationship summary');
  integer(relationships.nodes, 'Investigation capsule relationship node count', 0, 72);
  integer(relationships.edges, 'Investigation capsule relationship edge count', 0, 120);
  boolean(relationships.truncated, 'Investigation capsule relationship truncation');
  strings(relationships.kinds, 'Investigation capsule relationship kinds', 12, 320);
  strings(brief.limitations, 'Investigation capsule brief limitations', 20, 320);
}

function validateProjectionCollection(
  value: unknown,
  label: string,
  totalMaximum: number,
  displayedMaximum: number,
  validateItem: (item: unknown, index: number) => void,
): ProjectionCollectionValidation {
  const collection = exact(value, ['total', 'displayed', 'omitted', 'items'], label);
  const total = integer(collection.total, `${label} total`, 0, totalMaximum);
  const displayed = integer(collection.displayed, `${label} displayed`, 0, displayedMaximum);
  const omitted = integer(collection.omitted, `${label} omitted`, 0, totalMaximum);
  const items = array(collection.items, `${label} items`, displayedMaximum);
  if (displayed > total || omitted !== total - displayed || items.length !== displayed) fail(label);
  items.forEach(validateItem);
  return { total, displayed, omitted, items };
}

function validateSortedUnique(values: readonly string[], label: string): void {
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0 && values[index - 1]! >= values[index]!) fail(label);
  }
}

function validateDecisionIdentifier(value: unknown, label: string): string {
  const identifier = text(value, label, 200);
  if (!/^[a-z0-9](?:[a-z0-9._:-]{0,199})$/u.test(identifier)) fail(label);
  return identifier;
}

function validateProjectedStringCollection(
  value: unknown,
  label: string,
  totalMaximum: number,
  displayedMaximum: number,
  textMaximum: number,
): ProjectionCollectionValidation {
  const projection = validateProjectionCollection(
    value,
    label,
    totalMaximum,
    displayedMaximum,
    (item) => { text(item, `${label} item`, textMaximum); },
  );
  validateSortedUnique(projection.items as string[], label);
  return projection;
}

function validateDecisionFactSource(value: unknown, label: string): string {
  const source = exact(value, [
    'id',
    'label',
    'provenance',
    'evidenceState',
    'observedAt',
    'references',
    'limitations',
  ], label);
  const id = validateDecisionIdentifier(source.id, `${label} id`);
  text(source.label, `${label} label`, 160);
  enumeration(source.provenance, DECISION_FACT_PROVENANCE_STATES, `${label} provenance`);
  enumeration(source.evidenceState, DECISION_FACT_EVIDENCE_STATES, `${label} evidence state`);
  iso(source.observedAt, `${label} observation time`, true);
  validateProjectedStringCollection(
    source.references,
    `${label} references`,
    MAX_DECISION_FACT_REFERENCES,
    MAX_DECISION_FACT_PROJECTION_SOURCE_REFERENCES,
    200,
  );
  validateProjectedStringCollection(
    source.limitations,
    `${label} limitations`,
    MAX_DECISION_FACT_LIMITATIONS,
    MAX_DECISION_FACT_PROJECTION_SOURCE_LIMITATIONS,
    280,
  );
  return id;
}

function validateProjectedDecisionFact(value: unknown, label: string): Readonly<{
  id: string;
  consistency: string;
}> {
  const fact = exact(value, [
    'version',
    'id',
    'question',
    'conclusion',
    'importance',
    'evidenceState',
    'completeness',
    'freshness',
    'consistency',
    'dependencies',
    'sourceReferences',
    'sources',
    'contradictions',
    'limitations',
    'safeNextActions',
  ], label);
  if (fact.version !== DECISION_FACT_VERSION) fail(`${label} version`);
  const id = validateDecisionIdentifier(fact.id, `${label} id`);
  text(fact.question, `${label} question`, 320);
  text(fact.conclusion, `${label} conclusion`, 640);
  enumeration(fact.importance, ['high', 'medium', 'low'], `${label} importance`);
  const evidenceState = enumeration(fact.evidenceState, DECISION_FACT_EVIDENCE_STATES, `${label} evidence state`);
  if (fact.completeness !== decisionFactCompleteness(evidenceState)) fail(`${label} completeness`);
  enumeration(fact.freshness, DECISION_FACT_FRESHNESS_STATES, `${label} freshness`);
  const consistency = enumeration(fact.consistency, DECISION_FACT_CONSISTENCY_STATES, `${label} consistency`);
  const dependencies = validateProjectedStringCollection(
    fact.dependencies,
    `${label} dependencies`,
    MAX_DECISION_FACT_CONTRIBUTORS,
    MAX_DECISION_FACT_PROJECTION_SOURCES,
    200,
  );
  dependencies.items.forEach((item) => validateDecisionIdentifier(item, `${label} dependency`));
  validateProjectedStringCollection(
    fact.sourceReferences,
    `${label} source references`,
    MAX_DECISION_FACT_REFERENCES,
    MAX_DECISION_FACT_PROJECTION_REFERENCES,
    200,
  );
  const sourceIds: string[] = [];
  const sources = validateProjectionCollection(
    fact.sources,
    `${label} sources`,
    MAX_DECISION_FACT_CONTRIBUTORS,
    MAX_DECISION_FACT_PROJECTION_SOURCES,
    (item, index) => { sourceIds.push(validateDecisionFactSource(item, `${label} source ${index + 1}`)); },
  );
  validateSortedUnique(sourceIds, `${label} sources`);
  if (dependencies.total !== sources.total
    || dependencies.displayed !== sources.displayed
    || dependencies.omitted !== sources.omitted
    || !sameValues(dependencies.items, sourceIds)) fail(`${label} dependencies`);
  validateProjectedStringCollection(
    fact.contradictions,
    `${label} contradictions`,
    MAX_DECISION_FACT_CONTRADICTIONS,
    MAX_DECISION_FACT_PROJECTION_CONTRADICTIONS,
    640,
  );
  validateProjectedStringCollection(
    fact.limitations,
    `${label} limitations`,
    MAX_DECISION_FACT_LIMITATIONS,
    MAX_DECISION_FACT_PROJECTION_LIMITATIONS,
    280,
  );
  const actionIds: string[] = [];
  validateProjectionCollection(
    fact.safeNextActions,
    `${label} safe next actions`,
    MAX_DECISION_FACT_NEXT_ACTIONS,
    MAX_DECISION_FACT_PROJECTION_NEXT_ACTIONS,
    (candidate, index) => {
      const action = exact(candidate, ['id', 'label', 'reason', 'expectedOutcome', 'href', 'importance'], `${label} safe next action ${index + 1}`);
      actionIds.push(validateDecisionIdentifier(action.id, `${label} safe next action id`));
      text(action.label, `${label} safe next action label`, 160);
      text(action.reason, `${label} safe next action reason`, 320);
      text(action.expectedOutcome, `${label} safe next action outcome`, 320);
      if (typeof action.href !== 'string' || !/^#[a-z0-9](?:[a-z0-9._:-]{0,159})$/u.test(action.href)) fail(`${label} safe next action href`);
      enumeration(action.importance, ['high', 'medium', 'low'], `${label} safe next action importance`);
    },
  );
  validateSortedUnique(actionIds, `${label} safe next actions`);
  return { id, consistency };
}

function validateDecisionFactProjection(value: unknown): void {
  const projection = exact(value, [
    'version',
    'total',
    'displayed',
    'omitted',
    'contradictory',
    'unresolved',
    'facts',
  ], 'Investigation capsule Decision Fact projection');
  if (projection.version !== DECISION_FACT_PROJECTION_VERSION) fail('Investigation capsule Decision Fact projection');
  const total = integer(projection.total, 'Investigation capsule Decision Fact total', 0, MAX_DECISION_FACTS);
  const displayed = integer(projection.displayed, 'Investigation capsule Decision Fact displayed', 0, MAX_DECISION_FACT_PROJECTION_FACTS);
  const omitted = integer(projection.omitted, 'Investigation capsule Decision Fact omitted', 0, MAX_DECISION_FACTS);
  const contradictory = integer(projection.contradictory, 'Investigation capsule Decision Fact contradictory', 0, total);
  const unresolved = integer(projection.unresolved, 'Investigation capsule Decision Fact unresolved', 0, total);
  const facts = array(projection.facts, 'Investigation capsule Decision Facts', MAX_DECISION_FACT_PROJECTION_FACTS);
  if (displayed > total || omitted !== total - displayed || facts.length !== displayed
    || contradictory + unresolved > total) fail('Investigation capsule Decision Fact projection');
  const factIds: string[] = [];
  let displayedContradictory = 0;
  let displayedUnresolved = 0;
  for (const [index, candidate] of facts.entries()) {
    const validated = validateProjectedDecisionFact(candidate, `Investigation capsule Decision Fact ${index + 1}`);
    factIds.push(validated.id);
    if (validated.consistency === 'contradictory') displayedContradictory += 1;
    if (validated.consistency === 'unknown') displayedUnresolved += 1;
  }
  validateSortedUnique(factIds, 'Investigation capsule Decision Facts');
  if (contradictory < displayedContradictory || unresolved < displayedUnresolved
    || (omitted === 0 && (contradictory !== displayedContradictory || unresolved !== displayedUnresolved))) {
    fail('Investigation capsule Decision Fact state counts');
  }
  if (new TextEncoder().encode(JSON.stringify(projection)).byteLength > MAX_DECISION_FACT_PROJECTION_BYTES) {
    fail('Investigation capsule Decision Fact projection byte limit');
  }
}

function validateCurrentBrief(value: unknown): void {
  const brief = exact(value, ['schema', 'schemaVersion', 'generatedAt', 'target', 'targetType', 'task', 'taskLabel', 'question', 'summary', 'observation', 'decisionFacts', 'relationships', 'limitations'], 'Investigation capsule brief');
  if (brief.schema !== LOOKUP_INVESTIGATION_BRIEF_SCHEMA
    || brief.schemaVersion !== LOOKUP_INVESTIGATION_BRIEF_VERSION) fail('Investigation capsule brief');
  iso(brief.generatedAt, 'Investigation capsule brief generatedAt');
  text(brief.target, 'Investigation capsule brief target', 253);
  text(brief.targetType, 'Investigation capsule brief target type', 40);
  enumeration(brief.task, ['general', 'acquisition', 'brand', 'incident', 'owned'], 'Investigation capsule brief task');
  text(brief.taskLabel, 'Investigation capsule brief task label', 320);
  text(brief.question, 'Investigation capsule brief question', 320);
  text(brief.summary, 'Investigation capsule brief summary', 500);
  const observation = exact(brief.observation, ['observedAt', 'evidenceAgeDays', 'completeSources', 'limitedSources', 'freshnessPolicy'], 'Investigation capsule observation');
  iso(observation.observedAt, 'Investigation capsule observation time', true);
  if (observation.evidenceAgeDays !== null) integer(observation.evidenceAgeDays, 'Investigation capsule evidence age', 0, 1_000_000);
  integer(observation.completeSources, 'Investigation capsule complete sources', 0, 100);
  integer(observation.limitedSources, 'Investigation capsule limited sources', 0, 100);
  const policy = exact(observation.freshnessPolicy, ['version', 'id', 'task', 'thresholdsDays'], 'Investigation capsule freshness policy');
  if (policy.version !== 1) fail('Investigation capsule freshness policy');
  enumeration(policy.id, ['task-default', 'analyst-custom'], 'Investigation capsule freshness policy');
  if (policy.task !== brief.task) fail('Investigation capsule freshness policy');
  const thresholds = exact(policy.thresholdsDays, ['registration', 'network', 'web'], 'Investigation capsule freshness thresholds');
  for (const key of ['registration', 'network', 'web'] as const) integer(thresholds[key], 'Investigation capsule freshness threshold', 0, 3650);
  validateDecisionFactProjection(brief.decisionFacts);
  const relationships = exact(brief.relationships, ['nodes', 'edges', 'truncated', 'kinds'], 'Investigation capsule relationship summary');
  integer(relationships.nodes, 'Investigation capsule relationship node count', 0, 72);
  integer(relationships.edges, 'Investigation capsule relationship edge count', 0, 120);
  boolean(relationships.truncated, 'Investigation capsule relationship truncation');
  strings(relationships.kinds, 'Investigation capsule relationship kinds', 12, 320);
  strings(brief.limitations, 'Investigation capsule brief limitations', 20, 320);
  if (new TextEncoder().encode(JSON.stringify(brief)).byteLength > MAX_LOOKUP_INVESTIGATION_BRIEF_BYTES) {
    fail('Investigation capsule brief byte limit');
  }
}

function validateGraph(value: unknown): void {
  const graph = exact(value, ['version', 'targetId', 'nodes', 'edges', 'sources', 'truncated', 'limitations'], 'Investigation capsule graph');
  if (graph.version !== LOOKUP_ASSET_GRAPH_VERSION) fail('Investigation capsule graph');
  text(graph.targetId, 'Investigation capsule graph target', 160);
  const nodes = array(graph.nodes, 'Investigation capsule graph nodes', 72, 1);
  const nodeIds = new Set<string>();
  for (const candidate of nodes) {
    const node = exact(candidate, ['id', 'label', 'kind', 'detail'], 'Investigation capsule graph node');
    const id = text(node.id, 'Investigation capsule graph node id', 160);
    if (nodeIds.has(id)) fail('Investigation capsule graph node ids');
    nodeIds.add(id);
    text(node.label, 'Investigation capsule graph node label', 320);
    enumeration(node.kind, ['address', 'certificate', 'hostname', 'identity', 'issuer', 'key', 'network', 'observation', 'origin', 'prefix', 'registrar', 'target', 'tracker'], 'Investigation capsule graph node kind');
    text(node.detail, 'Investigation capsule graph node detail', 500, true);
  }
  if (!nodeIds.has(graph.targetId as string)) fail('Investigation capsule graph target');
  const sourceIds = new Set<string>();
  for (const candidate of array(graph.sources, 'Investigation capsule graph sources', 32)) {
    const source = exact(candidate, ['id', 'label', 'href', 'observedAt', 'completeness', 'limitations'], 'Investigation capsule graph source');
    const id = text(source.id, 'Investigation capsule graph source id', 160);
    if (sourceIds.has(id)) fail('Investigation capsule graph source ids');
    sourceIds.add(id);
    text(source.label, 'Investigation capsule graph source label', 320);
    if (typeof source.href !== 'string' || !/^#[^\u0000-\u001f\u007f]{1,160}$/u.test(source.href)) fail('Investigation capsule graph source href');
    iso(source.observedAt, 'Investigation capsule graph source observedAt', true);
    enumeration(source.completeness, ['complete', 'partial', 'unknown'], 'Investigation capsule graph source completeness');
    strings(source.limitations, 'Investigation capsule graph source limitations', 5, 320);
  }
  const edges = array(graph.edges, 'Investigation capsule graph edges', 120);
  const edgeIds = new Set<string>();
  for (const candidate of edges) {
    const edge = exactOptional(candidate, ['id', 'sourceId', 'source', 'target', 'kind', 'label', 'sourceLabel', 'observedAt', 'completeness', 'limitations', 'lenses', 'href'], ['boundary'], 'Investigation capsule graph edge');
    const id = text(edge.id, 'Investigation capsule graph edge id', 160);
    if (edgeIds.has(id)) fail('Investigation capsule graph edge ids');
    edgeIds.add(id);
    const sourceId = text(edge.sourceId, 'Investigation capsule graph edge source id', 160);
    if (!sourceIds.has(sourceId)) fail('Investigation capsule graph edge source');
    if (!nodeIds.has(edge.source as string) || !nodeIds.has(edge.target as string)) fail('Investigation capsule graph edge endpoints');
    text(edge.kind, 'Investigation capsule graph edge kind', 160);
    text(edge.label, 'Investigation capsule graph edge label', 320);
    text(edge.sourceLabel, 'Investigation capsule graph edge source label', 320);
    iso(edge.observedAt, 'Investigation capsule graph edge observedAt', true);
    enumeration(edge.completeness, ['complete', 'partial', 'unknown'], 'Investigation capsule graph edge completeness');
    strings(edge.limitations, 'Investigation capsule graph edge limitations', 5, 320);
    strings(edge.lenses, 'Investigation capsule graph edge lenses', 4, 40).forEach((lens) => enumeration(lens, ['all', 'identity', 'delegation', 'certificate'], 'Investigation capsule graph edge lens'));
    if (typeof edge.href !== 'string' || !/^#[^\u0000-\u001f\u007f]{1,160}$/u.test(edge.href)) fail('Investigation capsule graph edge href');
    if (edge.boundary !== undefined) enumeration(edge.boundary, ['external', 'reviewed_profile', 'same_origin', 'same_registrable_domain', 'unresolved'], 'Investigation capsule graph edge boundary');
  }
  boolean(graph.truncated, 'Investigation capsule graph truncation');
  strings(graph.limitations, 'Investigation capsule graph limitations', 20, 320);
}

function validateAnalystRecords(value: unknown): void {
  if (value === null) return;
  const records = exact(value, ['caseId', 'status', 'disposition', 'decisions', 'assertions'], 'Investigation capsule analyst records');
  text(records.caseId, 'Investigation capsule case id', 128);
  text(records.status, 'Investigation capsule case status', 80);
  text(records.disposition, 'Investigation capsule case disposition', 80);
  for (const candidate of array(records.decisions, 'Investigation capsule decisions', MAX_CASE_DECISIONS)) {
    const decision = exact(candidate, ['id', 'summary', 'rationale', 'evidencePinIds', 'createdAt'], 'Investigation capsule decision');
    text(decision.id, 'Investigation capsule decision id', 64);
    text(decision.summary, 'Investigation capsule decision summary', 500);
    text(decision.rationale, 'Investigation capsule decision rationale', 2_000, true);
    strings(decision.evidencePinIds, 'Investigation capsule decision evidence pins', MAX_DECISION_PIN_REFERENCES, 64);
    iso(decision.createdAt, 'Investigation capsule decision createdAt');
  }
  for (const candidate of array(records.assertions, 'Investigation capsule assertions', MAX_CASE_ASSERTIONS)) {
    const assertion = exact(candidate, ['id', 'kind', 'statement', 'rationale', 'evidencePinIds', 'state', 'createdAt', 'updatedAt'], 'Investigation capsule assertion');
    text(assertion.id, 'Investigation capsule assertion id', 64);
    text(assertion.kind, 'Investigation capsule assertion kind', 80);
    text(assertion.statement, 'Investigation capsule assertion statement', 2_000);
    optionalText(assertion.rationale, 'Investigation capsule assertion rationale', 2_000);
    strings(assertion.evidencePinIds, 'Investigation capsule assertion evidence pins', MAX_DECISION_PIN_REFERENCES, 64);
    text(assertion.state, 'Investigation capsule assertion state', 80);
    iso(assertion.createdAt, 'Investigation capsule assertion createdAt');
    iso(assertion.updatedAt, 'Investigation capsule assertion updatedAt');
  }
}

export function validateInvestigationCapsuleStructure(value: UnknownRecord): void {
  const root = exact(value, ['schema', 'schemaVersion', 'generatedAt', 'application', 'target', 'sourceContracts', 'investigationBrief', 'graphSnapshot', 'analystRecords', 'integrity', 'limitations'], 'Investigation capsule');
  if (root.schemaVersion !== PUBLIC_INVESTIGATION_CAPSULE_VERSION
    && root.schemaVersion !== INVESTIGATION_CAPSULE_VERSION) fail('Investigation capsule');
  iso(root.generatedAt, 'Investigation capsule generatedAt');
  const application = exact(root.application, ['name', 'version'], 'Investigation capsule application');
  if (application.name !== 'WHOISleuth' || typeof application.version !== 'string'
    || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(application.version)) fail('Investigation capsule application');
  const target = exact(root.target, ['value', 'type'], 'Investigation capsule target');
  text(target.value, 'Investigation capsule target value', 253);
  text(target.type, 'Investigation capsule target type', 40);
  const contracts = array(root.sourceContracts, 'Investigation capsule source contracts', 4, 3);
  const byId = new Map<string, UnknownRecord>();
  for (const candidate of contracts) {
    const contract = exact(candidate, ['id', 'schema', 'version', 'digest', 'embedded'], 'Investigation capsule source contract');
    const id = enumeration(contract.id, ['lookup-evidence', 'investigation-brief', 'asset-graph', 'analyst-records'], 'Investigation capsule source contract id');
    if (byId.has(id)) fail('Investigation capsule source contracts');
    byId.set(id, contract);
    text(contract.schema, 'Investigation capsule source schema', 120);
    integer(contract.version, 'Investigation capsule source version', 0, 10_000);
    digest(contract.digest, 'Investigation capsule source digest');
    boolean(contract.embedded, 'Investigation capsule embedded source');
  }
  const expectedContractIds = root.analystRecords === null
    ? ['lookup-evidence', 'investigation-brief', 'asset-graph']
    : ['lookup-evidence', 'investigation-brief', 'asset-graph', 'analyst-records'];
  const expectedBriefVersion = root.schemaVersion === INVESTIGATION_CAPSULE_VERSION
    ? LOOKUP_INVESTIGATION_BRIEF_VERSION
    : PUBLIC_LOOKUP_INVESTIGATION_BRIEF_VERSION;
  if (!sameValues(contracts.map((candidate) => (candidate as UnknownRecord).id), expectedContractIds)) fail('Investigation capsule source contracts');
  if (!byId.has('lookup-evidence') || !byId.has('investigation-brief') || !byId.has('asset-graph')
    || byId.get('lookup-evidence')?.embedded !== false
    || byId.get('investigation-brief')?.schema !== LOOKUP_INVESTIGATION_BRIEF_SCHEMA
    || byId.get('investigation-brief')?.version !== expectedBriefVersion
    || byId.get('investigation-brief')?.embedded !== true
    || byId.get('asset-graph')?.schema !== LOOKUP_ASSET_GRAPH_SCHEMA
    || byId.get('asset-graph')?.version !== LOOKUP_ASSET_GRAPH_VERSION
    || byId.get('asset-graph')?.embedded !== true
    || (byId.has('analyst-records') && (byId.get('analyst-records')?.schema !== INVESTIGATION_CAPSULE_ANALYST_RECORDS_SCHEMA
      || byId.get('analyst-records')?.version !== INVESTIGATION_CAPSULE_ANALYST_RECORDS_VERSION
      || byId.get('analyst-records')?.embedded !== true))) fail('Investigation capsule source contracts');
  if (root.schemaVersion === INVESTIGATION_CAPSULE_VERSION) validateCurrentBrief(root.investigationBrief);
  else validatePublicBrief(root.investigationBrief);
  validateGraph(root.graphSnapshot);
  validateAnalystRecords(root.analystRecords);
  const brief = root.investigationBrief as UnknownRecord;
  const graph = root.graphSnapshot as UnknownRecord;
  if (target.value !== brief.target || target.type !== brief.targetType
    || graph.targetId === undefined
    || (brief.relationships as UnknownRecord).nodes !== (graph.nodes as unknown[]).length
    || (brief.relationships as UnknownRecord).edges !== (graph.edges as unknown[]).length) fail('Investigation capsule projection linkage');
  const integrity = exact(root.integrity, ['algorithm', 'canonicalization', 'scope', 'briefDigest', 'graphDigest', 'analystRecordsDigest', 'digestSha256'], 'Investigation capsule integrity');
  if (integrity.algorithm !== 'SHA-256') fail('Investigation capsule integrity');
  if (integrity.canonicalization !== 'sorted-json-v2' || integrity.scope !== 'capsule excluding integrity') fail('Investigation capsule integrity');
  digest(integrity.digestSha256, 'Investigation capsule digest');
  digest(integrity.briefDigest, 'Investigation capsule brief digest');
  digest(integrity.graphDigest, 'Investigation capsule graph digest');
  if (integrity.analystRecordsDigest !== null) digest(integrity.analystRecordsDigest, 'Investigation capsule analyst digest');
  if (byId.get('investigation-brief')?.digest !== integrity.briefDigest
    || byId.get('asset-graph')?.digest !== integrity.graphDigest
    || (root.analystRecords === null) !== (integrity.analystRecordsDigest === null)
    || (root.analystRecords === null) !== !byId.has('analyst-records')
    || (byId.get('analyst-records')?.digest ?? null) !== integrity.analystRecordsDigest) fail('Investigation capsule digest linkage');
  strings(root.limitations, 'Investigation capsule limitations', 8, 600);
}
