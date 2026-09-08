import ts from 'typescript';

export const MAX_FORWARDING_SOURCE_BYTES = 2 * 1024 * 1024;

/** Recognise a single value-forwarding declaration, not a module's behaviour. */
export function moduleForwardingSpecifier(source: string, filename = 'module.mts'): string | null {
  if (Buffer.byteLength(source, 'utf8') > MAX_FORWARDING_SOURCE_BYTES) return null;
  let parsed: ts.SourceFile;
  try {
    parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  } catch {
    return null;
  }
  const diagnostics = (parsed as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  const statements = parsed.statements.filter((statement) => !ts.isEmptyStatement(statement));
  const declaration = statements[0];
  if (diagnostics.length || statements.length !== 1
    || !declaration || !ts.isExportDeclaration(declaration)
    || declaration.isTypeOnly || declaration.exportClause || declaration.attributes
    || !declaration.moduleSpecifier || !ts.isStringLiteral(declaration.moduleSpecifier)) return null;
  return declaration.moduleSpecifier.text;
}
