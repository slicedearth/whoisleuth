#!/usr/bin/env node

import { chromium } from '@playwright/test';

import { captureRenderedPage, parseCaptureArguments } from '../capture.mts';

try {
  const options = parseCaptureArguments(process.argv.slice(2));
  const manifest = await captureRenderedPage(options, { launchBrowser: () => chromium.launch({ headless: true }) });
  const capture = manifest.captures[0];
  if (!capture) throw new Error('Rendered capture completed without manifest evidence.');
  process.stdout.write(`Captured ${capture.domain} to ${options.outputDirectory}\n`);
  process.stdout.write(`Manifest: ${options.outputDirectory}/manifest.json\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : 'Rendered capture failed.';
  process.stderr.write(`Capture error: ${message.replace(/[\u0000-\u001f\u007f]+/gu, ' ').slice(0, 500)}\n`);
  process.exitCode = 2;
}
