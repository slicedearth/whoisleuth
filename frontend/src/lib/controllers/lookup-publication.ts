import type { LookupOperation } from './lookup-request-controller.ts';

/** The request token remains authoritative through storage reconciliation and UI
 * readiness. Adapters retain ownership of writes and navigation. */
export async function publishLookupResult(
  operation: LookupOperation,
  actions: {
    publish: () => void;
    reconcile: () => Promise<unknown>;
    retain: () => Promise<unknown>;
    ready: () => Promise<void>;
    reveal: () => void;
  },
): Promise<boolean> {
  if (!operation.current()) return false;
  actions.publish();
  await actions.reconcile();
  if (!operation.current()) return false;
  await actions.retain();
  if (!operation.current()) return false;
  await actions.ready();
  if (!operation.current()) return false;
  actions.reveal();
  return true;
}
