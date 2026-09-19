export function environmentWithoutV8Coverage(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  // Node restores an omitted value from its parent even with an explicit env.
  // An explicit undefined override prevents transformed or interrupted execution from
  // contaminating the native unit coverage collector.
  return { ...source, NODE_V8_COVERAGE: undefined };
}
