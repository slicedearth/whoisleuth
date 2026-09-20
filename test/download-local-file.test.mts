import assert from 'node:assert/strict';
import { test } from 'node:test';
import { downloadLocalFile } from '../frontend/src/lib/download-local-file.ts';

for (const failureAt of [null, 'create', 'click'] as const) {
  test(`local file download revokes its URL after ${failureAt ?? 'successful activation'}`, (context) => {
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    context.after(() => {
      if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
      else Reflect.deleteProperty(globalThis, 'document');
    });
    const events: string[] = [];
    const file = new Blob(['reserved evidence']);
    const url = 'blob:local-download-fixture';
    const failure = new Error('Synthetic download failure');
    const anchor = {
      href: '', download: '',
      click() {
        events.push('click');
        assert.equal(this.href, url);
        assert.equal(this.download, 'evidence.json');
        if (failureAt === 'click') throw failure;
      },
    };
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        createElement(tag: string) {
          events.push('create');
          assert.equal(tag, 'a');
          if (failureAt === 'create') throw failure;
          return anchor;
        },
      },
    });
    context.mock.method(URL, 'createObjectURL', (input: Blob) => {
      assert.equal(input, file);
      events.push('allocate');
      return url;
    });
    context.mock.method(URL, 'revokeObjectURL', (input: string) => {
      assert.equal(input, url);
      events.push('revoke');
    });
    if (failureAt) assert.throws(() => downloadLocalFile(file, 'evidence.json'), cause => cause === failure);
    else downloadLocalFile(file, 'evidence.json');
    assert.deepEqual(events, failureAt === 'create'
      ? ['allocate', 'create', 'revoke']
      : ['allocate', 'create', 'click', 'revoke']);
  });
}
