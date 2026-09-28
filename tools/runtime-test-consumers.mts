import type { ICruiseResult } from 'dependency-cruiser';

type RuntimeImportGap = Readonly<{ source: string; specifier: string }>;
type ConsumerSelection = Readonly<{
  consumers: ReadonlyMap<string, readonly string[]>;
  fallbackPaths: readonly string[];
  uncertainConsumers: readonly string[];
}>;

/** One resolved reverse graph per plan. An unresolved local edge can conceal
 * any changed dependency, but only consumers of its importer are uncertain.
 * Missing inventory roots are also uncertain; no guessed path resolver is used. */
export function indexRuntimeConsumers(
  graph: Pick<ICruiseResult, 'modules'>,
  maximumModules: number,
) {
  if (graph.modules.length > maximumModules)
    throw new TypeError('Dependency graph exceeds the inventory bound.');
  const sources = new Set(graph.modules.map((module) => module.source));
  const dependents = new Map<string, Set<string>>();
  const unresolved: RuntimeImportGap[] = [];
  for (const module of graph.modules) {
    for (const dependency of module.dependencies) {
      if (dependency.typeOnly === true || dependency.preCompilationOnly === true) continue;
      if (dependency.couldNotResolve) {
        if (/^(?:\.|\$lib\/)/u.test(dependency.module))
          unresolved.push({ source: module.source, specifier: dependency.module });
        continue;
      }
      const incoming = dependents.get(dependency.resolved) ?? new Set<string>();
      incoming.add(module.source);
      dependents.set(dependency.resolved, incoming);
    }
  }
  function closure(roots: Iterable<string>): ReadonlySet<string> {
    const visited = new Set(roots);
    for (const source of visited)
      for (const dependent of dependents.get(source) ?? []) visited.add(dependent);
    return visited;
  }
  const uncertainSources = closure(unresolved.map((edge) => edge.source));
  return Object.freeze({
    unresolved: Object.freeze(unresolved),
    select(
      changedPaths: readonly string[],
      inventory: readonly string[],
      fallbackWhenUnused = true,
    ): ConsumerSelection {
      const uncertainConsumers = inventory.filter(
        (file) => uncertainSources.has(file) || !sources.has(file),
      );
      const uncertain = new Set(uncertainConsumers);
      const fallbackPaths: string[] = [];
      const consumers = new Map(
        changedPaths.map((changedPath) => {
          const visited = closure([changedPath]);
          const positive = inventory.filter((file) => visited.has(file));
          if (!positive.length && fallbackWhenUnused) {
            fallbackPaths.push(changedPath);
            return [changedPath, inventory] as const;
          }
          return [
            changedPath,
            inventory.filter((file) => visited.has(file) || uncertain.has(file)),
          ] as const;
        }),
      );
      return {
        consumers,
        fallbackPaths: Object.freeze(fallbackPaths),
        uncertainConsumers: Object.freeze(uncertainConsumers),
      };
    },
  });
}

export function describeRuntimeImportGaps(gaps: readonly RuntimeImportGap[]): string {
  if (!gaps.length) return '';
  // Source identities, not source content. Keep diagnostics bounded even for a
  // malformed graph; the caller retains the complete conservative selection.
  const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f]/gu, '?').slice(0, 320);
  const shown = gaps.slice(0, 8).map((edge) => `${clean(edge.source)} -> ${clean(edge.specifier)}`);
  return `Unresolved local runtime imports: ${shown.join('; ')}${gaps.length > shown.length ? `; ${gaps.length - shown.length} further edges` : ''}. Their reachable tests remain selected for every changed source.`;
}
