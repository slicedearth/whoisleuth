import MiniSearch from 'minisearch';
import { PUBLIC_CLI_INDEX } from './generated/public-cli-index.ts';
import { PUBLIC_EXAMPLES_INDEX } from './generated/public-examples-index.ts';
import { PUBLIC_METHODOLOGY } from './generated/public-methodology.ts';
import { glossaryTerms, guideFaqs, publicGuideGoals, resultStates, toolGuides, referenceGuides } from './public-guide.ts';
import { PUBLIC_REFERENCE_DESTINATIONS } from './public-reference-navigation.ts';
import { PUBLIC_RESOURCES } from './public-resources.ts';
import { documentationAnchor } from './documentation-anchors.ts';

export type DocumentationResult = Readonly<{ href: string; title: string; category: string; description: string }>;
type SearchDocument = DocumentationResult & { id: string; text: string };

// Built only when search is opened. Every searchable fact comes from content
// already rendered by its page; queries and results remain in memory.
export function documentationSearchDocuments(): SearchDocument[] {
  const documents: DocumentationResult[] = [
    ...PUBLIC_REFERENCE_DESTINATIONS.map(item => ({ href: item.href, title: item.label, category: 'Documentation', description: item.detail })),
    ...PUBLIC_RESOURCES.map(resource => ({ href: `/resources/${resource.slug}`, title: resource.title, category: 'Evidence guide', description: [...resource.summary, ...resource.steps.map(step => `${step.title}. ${step.body}`), ...resource.evidence.map(item => `${item.source}. ${item.usefulFor}. ${item.limitation}`)].join(' ') })),
    ...PUBLIC_CLI_INDEX.commands.map(command => ({ href: `/cli#command-${command.id}`, title: command.id, category: 'CLI command', description: command.summary })),
    ...toolGuides.map(tool => ({ href: `/resources#tool-${tool.id}`, title: tool.name, category: 'Tool guide', description: `${tool.useWhen} ${tool.input} ${tool.result} ${tool.next}` })),
    ...referenceGuides.map(tool => ({ href: `/resources#reference-${tool.id}`, title: tool.name, category: 'Reference', description: `${tool.useWhen} ${tool.input} ${tool.result} ${tool.next}` })),
    ...publicGuideGoals.map(goal => ({ href: `/resources#${goal.id}`, title: goal.title, category: 'Task', description: goal.summary })),
    ...glossaryTerms.map(item => ({ href: `/resources#term-${documentationAnchor(item.term)}`, title: item.term, category: 'Glossary', description: item.definition })),
    ...resultStates.map(item => ({ href: `/resources#state-${documentationAnchor(item.term)}`, title: item.term, category: 'Evidence state', description: item.definition })),
    ...guideFaqs.map(item => ({ href: `/resources#question-${documentationAnchor(item.question)}`, title: item.question, category: 'Question', description: item.answer })),
    ...PUBLIC_METHODOLOGY.topics.map(item => ({ href: `/methodology#method-${item.id}`, title: item.title, category: 'Methodology', description: item.summary })),
    ...PUBLIC_EXAMPLES_INDEX.examples.map(item => ({ href: `/examples#example-${item.id}`, title: item.title, category: 'Example output', description: `${item.command}. ${item.summary}` })),
  ];
  // The directory and a full guide may share a destination. Retain the richer
  // content once, rather than showing duplicate search results.
  return [...new Map(documents.map(item => [item.href, item])).values()].map(item => ({ ...item, id: item.href, text: `${item.title} ${item.description}` }));
}

export function createDocumentationSearch() {
  const documents = documentationSearchDocuments();
  const byId = new Map(documents.map(document => [document.id, document]));
  const index = new MiniSearch<SearchDocument>({ fields: ['title', 'text'], searchOptions: { boost: { title: 3 }, prefix: true, combineWith: 'AND' } });
  index.addAll(documents);
  return (query: string): DocumentationResult[] => {
    const bounded = query.slice(0, 256).trim();
    if (!bounded) return [];
    return index.search(bounded).slice(0, 12).flatMap(result => {
      const document = byId.get(String(result.id));
      return document ? [{ href: document.href, title: document.title, category: document.category, description: document.description.length > 200 ? `${document.description.slice(0, 197)}…` : document.description }] : [];
    });
  };
}
