#!/usr/bin/env node

import { chromium } from '@playwright/test';

import { captureRenderedPage, parseCaptureArguments, sanitizeCaptureText } from '../capture.mts';
import {
  compareRenderedCaptures,
  formatRenderedCaptureComparison,
  parseCaptureCompareArguments,
} from '../compare.mts';

try {
  const argv = process.argv.slice(2);
  if (argv[0] === 'compare') {
    const options = parseCaptureCompareArguments(argv.slice(1));
    const comparison = await compareRenderedCaptures(options.leftManifest, options.rightManifest);
    process.stdout.write(options.output === 'json'
      ? `${JSON.stringify(comparison, null, 2)}\n`
      : formatRenderedCaptureComparison(comparison));
  } else {
    const options = parseCaptureArguments(argv);
    const manifest = await captureRenderedPage(options, { launchBrowser: () => chromium.launch({ headless: true }) });
    const capture = manifest.captures[0];
    if (!capture) throw new Error('Rendered capture completed without manifest evidence.');
    const safeDomain = sanitizeCaptureText(capture.domain, 253);
    const safeOutputDirectory = sanitizeCaptureText(options.outputDirectory, 2048);
    process.stdout.write(`Captured ${safeDomain} to ${safeOutputDirectory}\n`);
    process.stdout.write(`Manifest: ${safeOutputDirectory}/manifest.json\n`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'Rendered capture failed.';
  process.stderr.write(`Capture error: ${sanitizeCaptureText(message, 500)}\n`);
  process.exitCode = 2;
}
