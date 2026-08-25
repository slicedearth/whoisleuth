import {
  buildInvestigationTemplateExport,
  createInvestigationTemplate,
  deleteInvestigationTemplate as removeTemplate,
  mergeInvestigationTemplates,
  saveInvestigationTemplate as retainTemplate,
  serializeInvestigationTemplateStore,
  type InvestigationTemplate,
} from './analysis/investigation-template-model.ts';
import {
  buildCacaoInvestigationPlaybook,
  parseCacaoInvestigationPlaybook,
} from './analysis/investigation-playbook-interchange.ts';
import { readBrowserLocalData, updateBrowserLocalData } from './browser-local-data-service.ts';
import { serialiseWorkspacePortableJsonLine } from '../../../packages/contracts/workspace-portability.mts';

export {
  INVESTIGATION_TEMPLATE_SCHEMA,
  INVESTIGATION_TEMPLATE_VERSION,
  MAX_INVESTIGATION_TEMPLATE_IMPORT_BYTES,
} from './analysis/investigation-template-model.ts';
export {
  INVESTIGATION_CACAO_PROFILE_VERSION,
  INVESTIGATION_CACAO_SPEC_VERSION,
  MAX_INVESTIGATION_CACAO_IMPORT_BYTES,
} from './analysis/investigation-playbook-interchange.ts';
export type { InvestigationTemplate } from './analysis/investigation-template-model.ts';

function bounded(values: InvestigationTemplate[]): InvestigationTemplate[] {
  return JSON.parse(serializeInvestigationTemplateStore(values)).templates as InvestigationTemplate[];
}

export async function loadInvestigationTemplates(): Promise<InvestigationTemplate[]> {
  return readBrowserLocalData('investigation_templates');
}

export async function saveInvestigationTemplate(
  raw: unknown,
  makeId = () => crypto.randomUUID(),
): Promise<InvestigationTemplate[]> {
  return updateBrowserLocalData('investigation_templates', (current) => {
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
  return updateBrowserLocalData('investigation_templates', (current) => {
    const templates = bounded(removeTemplate(current, id));
    return { document: templates, result: templates };
  });
}

export async function importInvestigationTemplates(raw: unknown) {
  return updateBrowserLocalData('investigation_templates', (current) => {
    const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
    const incoming = value?.type === 'playbook'
      ? buildInvestigationTemplateExport([parseCacaoInvestigationPlaybook(raw)])
      : raw;
    const result = mergeInvestigationTemplates(current, incoming);
    const templates = bounded(result.templates);
    return { document: templates, result: { ...result, templates } };
  });
}

export async function exportInvestigationTemplates(): Promise<void> {
  const body = serialiseWorkspacePortableJsonLine(buildInvestigationTemplateExport(await loadInvestigationTemplates()));
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `whoisleuth-investigation-templates-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function exportCacaoInvestigationTemplate(template: InvestigationTemplate): void {
  const body = `${JSON.stringify(buildCacaoInvestigationPlaybook(template), null, 2)}\n`;
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `whoisleuth-investigation-playbook-${template.id}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
