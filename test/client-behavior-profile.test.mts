import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const {
  CLIENT_BEHAVIOR_PROFILE_VERSION,
  analyzeClientBehavior,
} = await import('../lib/client-behavior-profile.mts');

describe('bounded client-side behaviour profile', () => {
  test('reports fixed static indicators without retaining scripts or references', () => {
    const result = analyzeClientBehavior({
      html: `
        <button onclick="submitPrivateValue()">Continue</button>
        <script src="/private/application.js?token=secret"></script>
        <script type="module">
          localStorage.setItem('private-key', 'private-value');
          navigator.serviceWorker.register('/worker.js');
          navigator.clipboard.writeText('private-copy');
          new WebSocket('wss://private.example/socket');
          document.querySelector('form').addEventListener('submit', event => event.preventDefault());
          history.pushState({}, '', '/private-route');
        </script>
      `,
      observedAt: '2026-07-29T01:02:03.000Z',
    });

    assert.equal(result.clientBehaviorProfileVersion, CLIENT_BEHAVIOR_PROFILE_VERSION);
    assert.equal(result.status, 'success');
    assert.deepEqual(result.scriptSummary, {
      elementsObserved: 2,
      referencedScripts: 1,
      inlineScripts: 1,
      moduleScripts: 1,
    });
    assert.deepEqual(result.indicators.map((indicator) => indicator.id), [
      'inline_event_handlers',
      'client_navigation',
      'form_interception',
      'service_worker',
      'browser_storage',
      'clipboard_access',
      'persistent_connection',
    ]);
    assert.doesNotMatch(
      JSON.stringify(result),
      /submitPrivateValue|private-key|private-value|private-copy|private\.example|application\.js|token=|private-route/u,
    );
  });

  test('keeps dynamic evaluation and fingerprinting neutral and explainable', () => {
    const result = analyzeClientBehavior({
      html: '<script>eval(code); canvas.toDataURL(); new AudioContext();</script>',
    });

    assert.deepEqual(result.indicators.map((indicator) => indicator.id), [
      'dynamic_code_evaluation',
      'browser_fingerprinting',
    ]);
    assert.match(result.limitations.join(' '), /does not establish vulnerability/iu);
  });

  test('does not inspect inert script-like text outside executable script elements', () => {
    const result = analyzeClientBehavior({
      html: '<p>localStorage eval( navigator.clipboard WebSocket(</p>',
    });

    assert.deepEqual(result.indicators, []);
  });

  test('marks source and tokenizer limits partial', () => {
    const result = analyzeClientBehavior({
      html: `<script>${'localStorage;'.repeat(6_000)}</script>`,
      sourceTruncated: true,
    });

    assert.equal(result.status, 'partial');
    assert.equal(result.complete, false);
    assert.equal(result.truncated, true);
    assert.equal(result.indicators[0]?.occurrences, 999);
  });
});
