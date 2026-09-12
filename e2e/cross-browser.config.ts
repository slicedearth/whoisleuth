import { defineConfig, devices } from '@playwright/test';
import base from '../playwright.config.ts';
import { PLAYWRIGHT_FUNCTIONAL_PROJECT } from '../tools/playwright-execution-contract.mts';

const functional = base.projects?.find(project => project.name === PLAYWRIGHT_FUNCTIONAL_PROJECT);
if (!functional) throw new Error('Cross-browser checks require the ordinary functional configuration.');

// Reuse complete behavioural specifications, including their failure and
// narrow-screen cases. The full Chromium suite remains the primary boundary.
const specifications = [
  'auth.spec.ts',
  'browser-workspaces.spec.ts',
  'encrypted-workspaces.spec.ts',
  'case-draft-recovery.spec.ts',
  'case-views.spec.ts',
  'case-review-return.spec.ts',
  'case-packet-print.spec.ts',
  'capture-attachment-review.spec.ts',
  'case-attachments.spec.ts',
  'case-file-export.spec.ts',
  'case-images.spec.ts',
  'investigation-package.spec.ts',
  'lookup-replay.spec.ts',
  'lookup-source-progress.spec.ts',
  'public-product-batch3.spec.ts',
  'first-use-workflow.spec.ts',
];

export default defineConfig({
  ...base,
  testDir: __dirname,
  projects: [
    ...base.projects!.filter(project => functional.dependencies?.includes(project.name ?? '')),
    ...(['Desktop Firefox', 'Desktop Safari'] as const).map(device => ({
      ...functional,
      name: devices[device].defaultBrowserType,
      testMatch: specifications,
      use: { ...devices[device], storageState: functional.use!.storageState },
    })),
  ],
});
