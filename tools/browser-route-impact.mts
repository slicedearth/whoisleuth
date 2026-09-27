import ts from 'typescript';

/** Browser tests consume rendered routes without importing their page modules.
 * Collect literal destinations (including query/hash templates) as additional
 * positive evidence. Dynamic destinations still need the existing owner or
 * unresolved-impact fallback; this is not a proof that other tests are unrelated. */
export function browserRouteReferences(source: string): readonly string[] {
  const file = ts.createSourceFile('browser.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const routes = new Set<string>();
  const visit = (node: ts.Node): void => {
    const value = ts.isStringLiteralLike(node) ? node.text
      : ts.isTemplateExpression(node) && /[?#]|\/$/u.test(node.head.text) ? node.head.text : null;
    if (value?.startsWith('/') && !value.startsWith('//')) {
      const pathname = value.split(/[?#]/u, 1)[0]!;
      if (!/[\s\\]/u.test(pathname)) routes.add(pathname.replace(/\/+$/u, '') || '/');
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...routes].sort();
}

/** Route groups do not appear in URLs. Parameterised pages and layouts cover
 * their subtree conservatively, without another page-to-test registration. */
export function browserRouteMatches(pageFile: string, destination: string): boolean {
  const match = /^frontend\/src\/routes\/(.*?)\+(page|layout)(?:\.server)?\.(?:svelte|ts|js)$/u.exec(pageFile);
  if (!match) return false;
  const segments = match[1]!.split('/').filter(segment => segment && !/^\([^)]+\)$/u.test(segment));
  const dynamic = segments.findIndex(segment => segment.includes('['));
  const prefix = `/${(dynamic < 0 ? segments : segments.slice(0, dynamic)).join('/')}`;
  const subtree = dynamic >= 0 || match[2] === 'layout';
  return destination === prefix || subtree && (prefix === '/' || destination.startsWith(`${prefix}/`));
}

export function browserTestsForRoutes(
  pages: readonly string[],
  references: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  return [...references].filter(([, routes]) => routes.some(route => pages.some(page => browserRouteMatches(page, route))))
    .map(([file]) => file).sort();
}
