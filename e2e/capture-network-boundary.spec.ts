import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { test, expect } from './fixtures';

test('capture denies direct and teardown connections for the complete sandboxed browser lifetime', async () => {
  // Native Node owns the companion's worker modules; the browser-test
  // transform must not reinterpret their import.meta or package resolution.
  const result = await promisify(execFile)(process.execPath, [path.resolve(__dirname, '../tools/capture-browser-check.mts')], {
    timeout: 45_000, maxBuffer: 64 * 1024,
  });
  expect(JSON.parse(result.stdout)).toEqual({ directConnections: 0, rows: [
    { teardown: false, completeness: 'complete' }, { teardown: true, completeness: 'partial' },
  ] });
});
