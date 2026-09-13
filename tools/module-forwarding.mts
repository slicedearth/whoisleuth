import ts from 'typescript';

export const MAX_FORWARDING_SOURCE_BYTES = 2 * 1024 * 1024;

function parseModule(source: string, filename: string): ts.SourceFile | null {
  if (Buffer.byteLength(source, 'utf8') > MAX_FORWARDING_SOURCE_BYTES) return null;
  let parsed: ts.SourceFile;
  try {
    parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  } catch {
    return null;
  }
  const diagnostics = (parsed as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  return diagnostics.length ? null : parsed;
}

/** Recognise declarations that are erased, never a filename or an unused value. */
export function moduleIsTypeOnly(source: string, filename = 'module.mts'): boolean {
  const parsed = parseModule(source, filename);
  if (!parsed) return false;
  const statements = parsed.statements.filter((statement) => !ts.isEmptyStatement(statement));
  return statements.length > 0 && statements.every((statement) =>
    ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)
    || ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly === true && !statement.attributes
    || ts.isExportDeclaration(statement) && statement.isTypeOnly && !statement.attributes);
}

/** Recognise a single value-forwarding declaration, not a module's behaviour. */
export function moduleForwardingSpecifier(source: string, filename = 'module.mts'): string | null {
  const parsed = parseModule(source, filename);
  if (!parsed) return null;
  const statements = parsed.statements.filter((statement) => !ts.isEmptyStatement(statement));
  const declaration = statements[0];
  if (statements.length !== 1
    || !declaration || !ts.isExportDeclaration(declaration)
    || declaration.isTypeOnly || declaration.exportClause || declaration.attributes
    || !declaration.moduleSpecifier || !ts.isStringLiteral(declaration.moduleSpecifier)) return null;
  return declaration.moduleSpecifier.text;
}
