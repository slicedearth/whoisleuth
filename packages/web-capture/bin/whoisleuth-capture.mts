#!/usr/bin/env node

import manifest from '../package.json' with { type: 'json' };
import { launchCaptureBrowser } from '../browser.mts';

import { captureRenderedPage, parseCaptureArguments, sanitizeCaptureText } from '../capture.mts';
import {
  compareRenderedCaptures,
  formatRenderedCaptureComparison,
  parseCaptureCompareArguments,
} from '../compare.mts';

const HELP = `WHOISleuth rendered capture companion

Usage:
  whoisleuth-capture <url> --output-dir <new-directory> --authorize-rendered-capture [--timeout-ms <1000-30000>]
  whoisleuth-capture compare <left-manifest.json> <right-manifest.json> [--mask <left,top,width,height>] [--json]
  whoisleuth-capture --version

Capture executes page JavaScript for one explicitly authorised public hostname.
It writes a screenshot, bounded DOM digest and manifest into a new directory.
Each admitted resource receives its exact URL; no cookies or credentials are forwarded.
Compare verifies selected local artefacts and makes no network requests.
Capture accepts optional --observer and --vantage declarations. Labels do not verify network independence.
Compare reports capture conditions and every changed pixel in a bounded grid. Repeat --mask to exclude rectangles explicitly.

Browser installation is separate: run playwright install chromium explicitly.
The browser sandbox remains enabled. Use a disposable, network-restricted environment for untrusted pages.
Exit 0 means the operation completed; exit 2 means invalid input or an operation failure.
`;

try {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.length === 1 && ['--help', '-h'].includes(argv[0]!) || argv.length === 2 && argv[0] === 'compare' && ['--help', '-h'].includes(argv[1]!)) {
    process.stdout.write(HELP);
  } else if (argv.length === 1 && argv[0] === '--version') {
    process.stdout.write(`${manifest.version}\n`);
  } else if (argv[0] === 'compare') {
    const options = parseCaptureCompareArguments(argv.slice(1));
    const comparison = await compareRenderedCaptures(options.leftManifest, options.rightManifest, undefined, options.masks);
    process.stdout.write(options.output === 'json'
      ? `${JSON.stringify(comparison, null, 2)}\n`
      : formatRenderedCaptureComparison(comparison));
  } else {
    const options = parseCaptureArguments(argv);
    const manifest = await captureRenderedPage(options, {
      launchBrowser: launchCaptureBrowser,
    });
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
