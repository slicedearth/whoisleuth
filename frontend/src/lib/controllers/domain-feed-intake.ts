/** Fences local scans and explicit queries without owning any durable mutation. */
export class DomainFeedIntakeOperation {
  private generation = 0;
  private controller: AbortController | null = null;

  begin(context: string) {
    this.invalidate();
    const controller = new AbortController();
    this.controller = controller;
    return { generation: this.generation, context, signal: controller.signal };
  }

  current(operation: ReturnType<DomainFeedIntakeOperation['begin']>, context: string): boolean {
    return operation.generation === this.generation && operation.context === context && !operation.signal.aborted;
  }

  finish(operation: ReturnType<DomainFeedIntakeOperation['begin']>): void {
    if (operation.generation === this.generation) this.controller = null;
  }

  invalidate(): void {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
  }
}
