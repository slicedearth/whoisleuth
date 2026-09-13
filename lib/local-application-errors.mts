export class LocalWorkspaceError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options); this.name = 'LocalWorkspaceError'; this.code = code;
  }
}
