import {
  buildInvestigationTemplateExport,
  createInvestigationTemplate,
  deleteInvestigationTemplate as removeTemplate,
  mergeInvestigationTemplates,
  saveInvestigationTemplate as retainTemplate,
  serializeInvestigationTemplateStore,
  type InvestigationTemplate,
} from './analysis/investigation-template-model.ts';
import { browserLocalDataProvider } from './browser-local-data-service.ts';
import { INVESTIGATION_TEMPLATES_COLLECTION } from './browser-local-data-definitions.ts';

export {
  INVESTIGATION_TEMPLATE_SCHEMA,
  INVESTIGATION_TEMPLATE_VERSION,
  MAX_INVESTIGATION_TEMPLATE_IMPORT_BYTES,
} from './analysis/investigation-template-model.ts';
export type { InvestigationTemplate } from './analysis/investigation-template-model.ts';

function bounded(values: InvestigationTemplate[]): InvestigationTemplate[] {
  return JSON.parse(serializeInvestigationTemplateStore(values)).templates as InvestigationTemplate[];
}

export async function loadInvestigationTemplates(): Promise<InvestigationTemplate[]> {
  return (await browserLocalDataProvider()).read(INVESTIGATION_TEMPLATES_COLLECTION) as Promise<InvestigationTemplate[]>;
}

export async function saveInvestigationTemplate(
  raw: unknown,
  makeId = () => crypto.randomUUID(),
): Promise<InvestigationTemplate[]> {
  return (await browserLocalDataProvider()).update(INVESTIGATION_TEMPLATES_COLLECTION, (current) => {
    const existing = raw && typeof raw === 'object' && 'id' in raw
      ? current.find((item) => item.id === String((raw as { id?: unknown }).id ?? ''))
      : null;
    const candidate = createInvestigationTemplate({
      ...existing,
      ...(raw && typeof raw === 'object' ? raw : {}),
      createdAt: existing?.createdAt,
    }, { makeId });
    const templates = bounded(retainTemplate(current, candidate));
    return { document: templates, result: templates };
  });
}

export async function deleteInvestigationTemplate(id: string): Promise<InvestigationTemplate[]> {
  return (await browserLocalDataProvider()).update(INVESTIGATION_TEMPLATES_COLLECTION, (current) => {
    const templates = bounded(removeTemplate(current, id));
    return { document: templates, result: templates };
  });
}

export async function importInvestigationTemplates(raw: unknown) {
  return (await browserLocalDataProvider()).update(INVESTIGATION_TEMPLATES_COLLECTION, (current) => {
    const result = mergeInvestigationTemplates(current, raw);
    const templates = bounded(result.templates);
    return { document: templates, result: { ...result, templates } };
  });
}

export async function exportInvestigationTemplates(): Promise<void> {
  const body = `${JSON.stringify(buildInvestigationTemplateExport(await loadInvestigationTemplates()), null, 2)}\n`;
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `whoisleuth-investigation-templates-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
