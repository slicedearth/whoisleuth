export function environmentWithoutV8Coverage(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment = { ...source };
  delete environment.NODE_V8_COVERAGE;
  return environment;
}
