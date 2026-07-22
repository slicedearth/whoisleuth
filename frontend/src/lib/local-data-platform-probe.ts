// Maintainer-only browser probe for the local data platform evaluation. It
// uses a unique temporary database, fixed synthetic records, and guaranteed
// cleanup. Production browser stores never import or call this module.

export interface IndexedDbFeasibilityProbeResult {
  supported: boolean;
  opened: boolean;
  transactionCommitted: boolean;
  keyedReadMatched: boolean;
  indexedCollectionReadMatched: boolean;
  abortedTransactionRolledBack: boolean;
  deleteMatched: boolean;
  cleanupSucceeded: boolean;
  error: string | null;
}

/**
 * This function is deliberately self-contained so Playwright can serialize it
 * into the browser execution context without exposing a production route.
 */
export async function runIndexedDbFeasibilityProbe(): Promise<IndexedDbFeasibilityProbeResult> {
  const factory = (globalThis as typeof globalThis & { indexedDB?: IDBFactory }).indexedDB;
  const result: IndexedDbFeasibilityProbeResult = {
    supported: Boolean(factory),
    opened: false,
    transactionCommitted: false,
    keyedReadMatched: false,
    indexedCollectionReadMatched: false,
    abortedTransactionRolledBack: false,
    deleteMatched: false,
    cleanupSucceeded: false,
    error: null,
  };
  if (!factory) return result;

  const databaseName = `whoisleuth-local-data-probe-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  const storeName = 'records';
  const operationTimeoutMs = 3_000;
  let database: IDBDatabase | null = null;

  function requestResult<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('IndexedDB request timed out.')), operationTimeoutMs);
      request.onsuccess = () => { clearTimeout(timer); resolve(request.result); };
      request.onerror = () => { clearTimeout(timer); reject(request.error || new Error('IndexedDB request failed.')); };
    });
  }

  function transactionComplete(transaction: IDBTransaction, allowAbort = false): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        try { transaction.abort(); } catch { /* the transaction may already be inactive */ }
        reject(new Error('IndexedDB transaction timed out.'));
      }, operationTimeoutMs);
      transaction.oncomplete = () => { clearTimeout(timer); resolve(true); };
      transaction.onabort = () => {
        clearTimeout(timer);
        if (allowAbort) resolve(false);
        else reject(transaction.error || new Error('IndexedDB transaction was aborted.'));
      };
      transaction.onerror = () => {
        if (!allowAbort) {
          clearTimeout(timer);
          reject(transaction.error || new Error('IndexedDB transaction failed.'));
        }
      };
    });
  }

  async function deleteDatabase(): Promise<boolean> {
    return new Promise((resolve) => {
      const request = factory.deleteDatabase(databaseName);
      const timer = setTimeout(() => resolve(false), operationTimeoutMs);
      request.onsuccess = () => { clearTimeout(timer); resolve(true); };
      request.onerror = () => { clearTimeout(timer); resolve(false); };
      request.onblocked = () => { clearTimeout(timer); resolve(false); };
    });
  }

  try {
    database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(databaseName, 1);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        reject(new Error('IndexedDB database open timed out.'));
      }, operationTimeoutMs);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(storeName, { keyPath: 'key' });
        store.createIndex('collection', 'collection', { unique: false });
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        if (timedOut) {
          request.result.close();
          factory.deleteDatabase(databaseName);
          return;
        }
        resolve(request.result);
      };
      request.onerror = () => { clearTimeout(timer); reject(request.error || new Error('IndexedDB database could not be opened.')); };
      request.onblocked = () => { clearTimeout(timer); reject(new Error('IndexedDB database open was blocked.')); };
    });
    result.opened = true;

    const write = database.transaction(storeName, 'readwrite');
    const writeDone = transactionComplete(write);
    const writable = write.objectStore(storeName);
    writable.put({
      key: 'cases:case-1',
      collection: 'cases',
      recordId: 'case-1',
      schemaVersion: 2,
      value: { domain: 'candidate.invalid', status: 'reviewing' },
    });
    writable.put({
      key: 'campaigns:campaign-1',
      collection: 'campaigns',
      recordId: 'campaign-1',
      schemaVersion: 1,
      value: { name: 'Synthetic review' },
    });
    result.transactionCommitted = await writeDone;

    const read = database.transaction(storeName, 'readonly');
    const readDone = transactionComplete(read);
    const storedCase = await requestResult(read.objectStore(storeName).get('cases:case-1'));
    await readDone;
    result.keyedReadMatched = storedCase?.value?.domain === 'candidate.invalid'
      && storedCase?.schemaVersion === 2;

    const list = database.transaction(storeName, 'readonly');
    const listDone = transactionComplete(list);
    const caseRecords = await requestResult(list.objectStore(storeName).index('collection').getAll('cases'));
    await listDone;
    result.indexedCollectionReadMatched = Array.isArray(caseRecords)
      && caseRecords.length === 1
      && caseRecords[0]?.recordId === 'case-1';

    const abort = database.transaction(storeName, 'readwrite');
    const abortDone = transactionComplete(abort, true);
    abort.objectStore(storeName).put({
      key: 'cases:rolled-back',
      collection: 'cases',
      recordId: 'rolled-back',
      schemaVersion: 2,
      value: { domain: 'rollback.invalid' },
    });
    abort.abort();
    await abortDone;

    const rollbackRead = database.transaction(storeName, 'readonly');
    const rollbackReadDone = transactionComplete(rollbackRead);
    const rolledBack = await requestResult(rollbackRead.objectStore(storeName).get('cases:rolled-back'));
    await rollbackReadDone;
    result.abortedTransactionRolledBack = rolledBack === undefined;

    const remove = database.transaction(storeName, 'readwrite');
    const removeDone = transactionComplete(remove);
    remove.objectStore(storeName).delete('cases:case-1');
    await removeDone;
    const removedRead = database.transaction(storeName, 'readonly');
    const removedReadDone = transactionComplete(removedRead);
    const removed = await requestResult(removedRead.objectStore(storeName).get('cases:case-1'));
    await removedReadDone;
    result.deleteMatched = removed === undefined;
  } catch (error) {
    result.error = (error instanceof Error ? error.message : 'IndexedDB feasibility probe failed.')
      .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 240) || 'IndexedDB feasibility probe failed.';
  } finally {
    try { database?.close(); } catch { /* cleanup continues through deleteDatabase */ }
    result.cleanupSucceeded = await deleteDatabase();
  }

  return result;
}
