// Covers lib/html-signals.mts - the regex-based signals pulled from an
// already-fetched homepage HTML (page title, password field, phishing
// language, external asset hotlinking). Pure text-in/object-out, no
// network access needed.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_FORM_ACTION_ORIGINS,
  MAX_FORMS,
  MAX_CONTACT_DOMAINS,
  MAX_EMBEDDED_ORIGINS,
  MAX_IDENTITY_TAGS,
  MAX_RESOURCE_ORIGINS,
  MAX_RESOURCE_TAGS,
  MAX_TRACKING_IDENTIFIERS,
  PAGE_IDENTITY_VERSION,
  PAGE_PUBLICATION_METADATA_VERSION,
  extractHtmlSignals,
  extractPageIdentity,
} from '../lib/html-signals.mts';
import {
  PAGE_PUBLICATION_LIMITATIONS,
  validPagePublicationMetadata,
} from '../lib/homepage-metadata-contract.mts';
import { requiredValue } from './value-assertions.mts';

describe('pageTitle', () => {
  test('extracts and trims a <title> tag', () => {
    const html = '<html><head><title>  Acme Bank - Secure Login  </title></head></html>';
    assert.equal(extractHtmlSignals(html, 'example.com').pageTitle, 'Acme Bank - Secure Login');
  });

  test('collapses internal whitespace/newlines', () => {
    const html = '<title>Acme\n  Bank\tLogin</title>';
    assert.equal(extractHtmlSignals(html, 'example.com').pageTitle, 'Acme Bank Login');
  });

  test('strips terminal controls and default-ignorable characters before retaining a title', () => {
    const html = '<title>Account\x00\x07\x7f\u009b\u202e review\u00ad centre</title>';
    const title = extractHtmlSignals(html, 'example.com').pageTitle;
    assert.equal(title, 'Account review centre');
    assert.equal(/[\u0000-\u001f\u007f-\u009f]|\p{Default_Ignorable_Code_Point}/u.test(title), false);
  });

  test('is null when there is no title tag', () => {
    const html = '<html><body>no title here</body></html>';
    assert.equal(extractHtmlSignals(html, 'example.com').pageTitle, null);
  });

  test('is null for an empty title tag', () => {
    assert.equal(extractHtmlSignals('<title></title>', 'example.com').pageTitle, null);
  });

  test('truncates a very long title', () => {
    const longTitle = 'A'.repeat(300);
    const result = requiredValue(extractHtmlSignals(`<title>${longTitle}</title>`, 'example.com').pageTitle);
    assert.ok(result.length <= 201); // 200 chars + the ellipsis character
    assert.ok(result.endsWith('…'));
  });
});

describe('reviewed static page-pattern inputs', () => {
  test('retains a bounded wallet prompt through the existing language cue', () => {
    const result = extractHtmlSignals('<main><p>Enter your recovery phrase to continue</p></main>', 'example.test');
    assert.equal(result.phishingLanguageMatch, 'Reviewed English wallet or recovery-secret language');
  });

  test('retains only whether a static form points off-origin', () => {
    const result = extractHtmlSignals(
      '<form method="post" action="https://collector.test/private?token=secret"><input type="password"></form>',
      'example.test',
      { baseUrl: 'https://example.test/' },
    );
    assert.equal(result.hasExternalFormAction, true);
    assert.doesNotMatch(JSON.stringify({
      hasExternalFormAction: result.hasExternalFormAction,
    }), /collector|private|token|secret/u);
  });
});

describe('hasPasswordField', () => {
  test('detects a password input regardless of attribute order/quoting', () => {
    assert.equal(extractHtmlSignals('<input type="password" name="pw">', 'example.com').hasPasswordField, true);
    assert.equal(extractHtmlSignals("<input name='pw' type='password'>", 'example.com').hasPasswordField, true);
  });

  test('is false with no password field', () => {
    assert.equal(extractHtmlSignals('<input type="text" name="q">', 'example.com').hasPasswordField, false);
  });
});

describe('phishingLanguageMatch', () => {
  test('matches known urgency/credential-harvesting phrasing', () => {
    const html = '<body>Please verify your account to continue.</body>';
    assert.equal(extractHtmlSignals(html, 'example.com').phishingLanguageMatch, 'Reviewed English account-verification language');
  });

  test('is case-insensitive', () => {
    const html = '<body>SECURITY ALERT: unusual activity detected</body>';
    assert.equal(extractHtmlSignals(html, 'example.com').phishingLanguageMatch, 'Reviewed English urgent-action language');
  });

  test('is null for ordinary copy', () => {
    const html = '<body>Welcome to our site. Browse our products below.</body>';
    assert.equal(extractHtmlSignals(html, 'example.com').phishingLanguageMatch, null);
  });

  test('control-bearing page text does not produce a retained signal', () => {
    const match = extractHtmlSignals('<body>security alert\x07</body>', 'example.com').phishingLanguageMatch;
    assert.equal(match, null);
  });

  test('does not treat quoted attribute text after a greater-than character as visible copy', () => {
    const match = extractHtmlSignals(
      '<main data-rule="len>5" aria-label="Verify your account">Account help</main>',
      'example.com',
    ).phishingLanguageMatch;
    assert.equal(match, null);
  });
});

describe('externalAssetHosts', () => {
  test('collects hosts from absolute img/script/link src/href, deduped', () => {
    const html = `
      <img src="https://evil-cdn.example/logo.png">
      <script src="//evil-cdn.example/app.js"></script>
      <link rel="stylesheet" href="https://other.example/style.css">
    `;
    const hosts = extractHtmlSignals(html, 'lookalike.test').externalAssetHosts;
    assert.deepEqual([...hosts].sort(), ['evil-cdn.example', 'other.example']);
  });

  test('ignores relative URLs (same-origin, nothing external to extract)', () => {
    const html = '<img src="/img/logo.png"><script src="app.js"></script>';
    assert.deepEqual(extractHtmlSignals(html, 'example.com').externalAssetHosts, []);
  });

  test('excludes the domain\'s own host (with or without a www. prefix)', () => {
    const html = '<img src="https://www.example.com/logo.png"><img src="https://example.com/hero.png">';
    assert.deepEqual(extractHtmlSignals(html, 'example.com').externalAssetHosts, []);
  });

  test('only looks at img/script/link tags, not ordinary <a href> links', () => {
    const html = '<a href="https://example.com/real-site">Visit the real site</a>';
    assert.deepEqual(extractHtmlSignals(html, 'lookalike.test').externalAssetHosts, []);
  });

  test('rejects control-bearing external asset hosts', () => {
    const html = '<img src="https://evil\x07.example/logo.png"><img src="https://safe.example/logo.png">';
    assert.deepEqual(extractHtmlSignals(html, 'lookalike.test').externalAssetHosts, ['safe.example']);
  });
});

describe('pageIdentity', () => {
  const observedAt = '2026-07-13T04:05:06.000Z';

  function identity(
    html: string,
    options: Parameters<typeof extractPageIdentity>[2] = {},
  ) {
    return extractPageIdentity(html, 'example.com', {
      baseUrl: 'https://example.com/start/index.html',
      observedAt,
      ...options,
    });
  }

  test('extracts bounded document and Open Graph identity metadata', () => {
    const result = identity(`
      <html lang="EN-au"><head>
        <link rel="alternate canonical" href="/account?token=secret#section">
        <meta property="og:title" content=" Example Account Centre ">
        <meta property="og:site_name" content="Example Portal">
        <meta property="og:url" content="https://www.example.com/welcome?campaign=private">
        <meta name="generator" content="Example CMS 4">
      </head></html>
    `);

    assert.equal(result.identityVersion, PAGE_IDENTITY_VERSION);
    assert.equal(result.version, 1);
    assert.equal(result.status, 'success');
    assert.equal(result.observedAt, observedAt);
    assert.equal(result.source, 'html');
    assert.equal(result.documentLanguage, 'en-au');
    assert.deepEqual(result.canonical, {
      url: 'https://example.com/account', queryOmitted: true, pathTruncated: false,
    });
    assert.equal(result.openGraph.title, 'Example Account Centre');
    assert.equal(result.openGraph.siteName, 'Example Portal');
    assert.deepEqual(result.openGraph.url, {
      url: 'https://www.example.com/welcome', queryOmitted: true, pathTruncated: false,
    });
    assert.equal(result.generator, 'Example CMS 4');
    assert.match(result.limitations.join(' '), /Query strings and fragments were omitted/);
    assert.doesNotMatch(JSON.stringify(result), /secret|campaign=private/);
  });

  test('sanitises terminal controls and bidi formatting in retained identity metadata', () => {
    const result = identity(`
      <meta property="og:title" content="Account\u009b\u202e centre">
      <meta property="og:site_name" content="Example\u00ad portal">
      <meta name="generator" content="Fixture\u2066 generator">
    `);
    assert.equal(result.openGraph.title, 'Account centre');
    assert.equal(result.openGraph.siteName, 'Example portal');
    assert.equal(result.generator, 'Fixture generator');
    assert.doesNotMatch(JSON.stringify(result), /[\u0080-\u009f]|\p{Default_Ignorable_Code_Point}/u);
  });

  test('resolves a meta-refresh target against the final response URL', () => {
    const result = identity('<meta content="0; URL=../login?session=secret" http-equiv="refresh">');
    assert.deepEqual(result.metaRefresh, {
      url: 'https://example.com/login', queryOmitted: true, pathTruncated: false,
    });
  });

  test('rejects credential-bearing, non-HTTP, control-bearing, and empty URLs', () => {
    const result = identity(`
      <link rel="canonical" href="https://user:password@example.com/private">
      <meta property="og:url" content="javascript:alert(1)">
      <meta http-equiv="refresh" content="0; url=https://safe.example/\u0007bad">
      <form action="   "></form>
    `);
    assert.equal(result.canonical, null);
    assert.equal(result.openGraph.url, null);
    assert.equal(result.metaRefresh, null);
    assert.equal(result.forms.count, 1);
    assert.equal(result.diagnostics.discardedUrls, 3);
    assert.doesNotMatch(JSON.stringify(result), /password/);
  });

  test('normalizes forms without retaining action paths or query values', () => {
    const result = identity(`
      <form method="POST" action="/session?csrf=secret"></form>
      <form method="post" action="http://collect.example/submit?credential=secret"></form>
      <form action="https://collect.example/other"></form>
      <form></form>
    `);
    assert.deepEqual(result.forms, {
      count: 4,
      postCount: 2,
      insecureActionCount: 1,
      externalActionOrigins: ['http://collect.example', 'https://collect.example'],
      truncated: false,
    });
    assert.doesNotMatch(JSON.stringify(result.forms), /session|submit|credential|csrf|secret/);
  });

  test('sorts and deduplicates external form-action origins', () => {
    const result = identity(`
      <form action="https://z.example/one"></form>
      <form action="https://a.example/two"></form>
      <form action="https://z.example/three"></form>
    `);
    assert.deepEqual(result.forms.externalActionOrigins, ['https://a.example', 'https://z.example']);
  });

  test('bounds forms while preserving explicit partial provenance', () => {
    const html = Array.from({ length: MAX_FORMS + 1 }, (_, index) => `<form method="post" action="/form-${index}"></form>`).join('');
    const result = identity(html);
    assert.equal(result.forms.count, MAX_FORMS);
    assert.equal(result.forms.postCount, MAX_FORMS);
    assert.equal(result.forms.truncated, true);
    assert.equal(result.status, 'partial');
    assert.equal(result.complete, false);
    assert.equal(result.truncated, true);
    assert.match(result.limitations.join(' '), new RegExp(`first ${MAX_FORMS} forms`));
  });

  test('bounds external form-action origins independently of form count', () => {
    const html = Array.from({ length: MAX_FORM_ACTION_ORIGINS + 1 }, (_, index) => `<form action="https://external-${index}.example/path"></form>`).join('');
    const result = identity(html);
    assert.equal(result.forms.count, MAX_FORM_ACTION_ORIGINS + 1);
    assert.equal(result.forms.externalActionOrigins.length, MAX_FORM_ACTION_ORIGINS);
    assert.equal(result.forms.truncated, true);
    assert.equal(result.status, 'partial');
  });

  test('reports an upstream body cap as partial even when extracted fields are valid', () => {
    const result = identity('<html lang="en"><form></form></html>', { sourceTruncated: true });
    assert.equal(result.documentLanguage, 'en');
    assert.equal(result.status, 'partial');
    assert.equal(result.truncated, true);
    assert.match(result.limitations.join(' '), /body capture reached its byte limit/);
  });

  test('caps the number and length of inspected tags', () => {
    const tooManyTags = Array.from({ length: MAX_IDENTITY_TAGS + 1 }, () => '<meta name="generator" content="cms">').join('');
    const countLimited = identity(tooManyTags);
    assert.equal(countLimited.diagnostics.tagsExamined, MAX_IDENTITY_TAGS);
    assert.equal(countLimited.status, 'partial');

    const oversized = identity(`<meta name="generator" content="${'x'.repeat(5000)}">`);
    assert.equal(oversized.generator, null);
    assert.equal(oversized.status, 'partial');
  });

  test('replaces an overlong retained path with its bounded origin', () => {
    const result = identity(`<link rel="canonical" href="https://example.com/${'a'.repeat(2500)}?secret=value">`);
    assert.deepEqual(result.canonical, {
      url: 'https://example.com/', queryOmitted: true, pathTruncated: true,
    });
    assert.equal(result.status, 'partial');
    assert.match(result.limitations.join(' '), /path was replaced by its origin/);
  });

  test('falls back safely when the supplied domain and base URL are invalid', () => {
    const result = extractPageIdentity('<link rel="canonical" href="/safe">', '\u0000', {
      baseUrl: 'not a URL', observedAt,
    });
    assert.equal(requiredValue(result.canonical).url, 'https://invalid.example/safe');
  });

  test('returns an empty, complete summary when no identity tags are present', () => {
    const result = identity('<main>ordinary text</main>');
    assert.equal(result.status, 'success');
    assert.equal(result.complete, true);
    assert.equal(result.documentLanguage, null);
    assert.equal(result.canonical, null);
    assert.deepEqual(result.openGraph, { title: null, siteName: null, url: null });
    assert.deepEqual(result.forms.externalActionOrigins, []);
  });

  test('can leave page identity absent while preserving established flat signals', () => {
    const result = extractHtmlSignals('<title>Example</title><input type="password">', 'example.com', {
      includePageIdentity: false,
    });
    assert.equal(result.pageIdentity, null);
    assert.equal(result.credentialSurfaceProfile, null);
    assert.equal(result.structuredDataIdentity, null);
    assert.equal(result.technologyProfile, null);
    assert.equal(result.pageRoleProfile, null);
    assert.equal(result.clientBehaviorProfile, null);
    assert.equal(result.pageTitle, 'Example');
    assert.equal(result.hasPasswordField, true);
  });

  test('derives bounded technology indicators from the same captured HTML', () => {
    const result = extractHtmlSignals('<meta name="generator" content="Hugo 0.1"><astro-island></astro-island>', 'example.com', {
      httpServer: 'Caddy',
      responseHeaders: { 'x-powered-by': 'Express', 'x-private': 'discarded' },
      observedAt,
    });
    const technologyProfile = requiredValue(result.technologyProfile);
    assert.deepEqual(technologyProfile.findings.map((item) => item.id), ['hugo', 'astro', 'express', 'caddy']);
    assert.equal(technologyProfile.source, 'derived');
    assert.equal(technologyProfile.observedAt, observedAt);
    assert.doesNotMatch(JSON.stringify(technologyProfile), /x-private|discarded/);
  });

  test('derives page-role and static behaviour profiles from the shared parse', () => {
    const result = extractHtmlSignals(`
      <main><form class="login"><input type="password"></form></main>
      <script>localStorage.setItem('private-key', 'private-value')</script>
    `, 'example.com', { observedAt });

    const role = requiredValue(result.pageRoleProfile);
    const behavior = requiredValue(result.clientBehaviorProfile);
    assert.equal(role.primaryRole, 'authentication');
    assert.equal(role.observedAt, observedAt);
    assert.deepEqual(behavior.indicators.map((item) => item.id), ['browser_storage']);
    assert.equal(behavior.observedAt, observedAt);
    assert.doesNotMatch(JSON.stringify({ role, behavior }), /private-key|private-value|class="login"/u);
  });

  test('summarizes bounded homepage publication declarations and static structure without retaining values', () => {
    const result = extractHtmlSignals(`
      <html><head>
        <meta name="robots" content="index, noindex, follow, custom-directive">
        <meta name="twitter:card" content="summary_large_image">
        <meta name="twitter:title" content="Private retained page title">
        <meta property="twitter:description" content="Private retained description">
        <meta name="twitter:image" content="https://cdn.example/private.png?token=secret">
        <script src="/blocking.js"></script>
        <script async src="/async.js"></script>
        <script defer src="/defer.js"></script>
        <script type="module" src="/module.js"></script>
        <link rel="stylesheet" href="/blocking.css">
        <link rel="preload" as="style" href="/preload.css">
      </head><body>
        <h1>Private heading</h1><h2>Another heading</h2>
        <img src="one.png"><img src="two.png" alt=""><img src="three.png" alt="Private alternative">
        <script src="/body.js"></script>
      </body></html>
    `, 'example.com', { observedAt });
    const publication = requiredValue(requiredValue(result.pageIdentity).publicationMetadata);
    assert.equal(publication.version, PAGE_PUBLICATION_METADATA_VERSION);
    assert.equal(publication.status, 'success');
    assert.equal(publication.complete, true);
    assert.deepEqual(publication.robots, {
      status: 'observed',
      complete: true,
      truncated: false,
      directives: ['follow', 'index', 'noindex'],
      recognizedDirectiveCount: 3,
      unknownDirectiveCount: 1,
      conflicting: true,
    });
    assert.deepEqual(publication.twitterCard, {
      status: 'observed',
      complete: true,
      truncated: false,
      cardType: 'summary_large_image',
      declarationCount: 4,
      titlePresent: true,
      descriptionPresent: true,
      imagePresent: true,
      imageAltPresent: false,
      sitePresent: false,
      creatorPresent: false,
      playerPresent: false,
      appPresent: false,
    });
    assert.deepEqual(publication.headings, { complete: true, truncated: false, total: 2, h1: 1, h2: 1, h3: 0, h4: 0, h5: 0, h6: 0 });
    assert.deepEqual(publication.images, {
      totalComplete: true, classificationComplete: true, truncated: false,
      total: 3, altMissing: 1, altEmpty: 1, altNonEmpty: 1, altUnclassified: 0,
    });
    assert.deepEqual(publication.renderBlockingCandidates, {
      complete: true, truncated: false,
      script: 1, stylesheet: 1, total: 2, scope: 'explicit-head-static-v1',
    });
    assert.doesNotMatch(JSON.stringify(publication), /Private|token=|blocking\.js|blocking\.css/u);
  });

  test('keeps absent declarations distinct from partial or malformed captured metadata', () => {
    const complete = requiredValue(requiredValue(extractHtmlSignals('<body><h3>Example</h3></body>', 'example.com').pageIdentity).publicationMetadata);
    assert.equal(complete.robots.status, 'not_observed');
    assert.equal(complete.twitterCard.status, 'not_observed');
    assert.equal(complete.complete, true);

    const partial = requiredValue(requiredValue(extractHtmlSignals('<meta name="robots" content="index">', 'example.com', {
      sourceTruncated: true,
    }).pageIdentity).publicationMetadata);
    assert.equal(partial.status, 'partial');
    assert.equal(partial.robots.status, 'partial');
    assert.equal(partial.twitterCard.status, 'partial');
    assert.equal(partial.complete, false);
    assert.equal(partial.truncated, true);

    const malformed = requiredValue(requiredValue(extractHtmlSignals(
      `<head><meta name="robots"><meta name="twitter:card" content="${'x'.repeat(1_025)}"></head>`,
      'example.com',
    ).pageIdentity).publicationMetadata);
    assert.equal(malformed.robots.status, 'malformed');
    assert.equal(malformed.twitterCard.status, 'partial');
    assert.equal(malformed.status, 'partial');
    assert.equal(malformed.complete, false);
  });

  test('observes implicit-head declarations while ignoring matching body metadata', () => {
    const implicit = requiredValue(requiredValue(extractHtmlSignals(
      '<meta name="robots" content="noindex"><meta name="twitter:card" content="summary"><body>Example</body>',
      'example.com',
    ).pageIdentity).publicationMetadata);
    assert.equal(implicit.robots.status, 'observed');
    assert.deepEqual(implicit.robots.directives, ['noindex']);
    assert.equal(implicit.twitterCard.status, 'observed');
    assert.equal(implicit.twitterCard.cardType, 'summary');

    const bodyOnly = requiredValue(requiredValue(extractHtmlSignals(
      '<body><meta name="robots" content="noindex"><meta name="twitter:card" content="summary"></body>',
      'example.com',
    ).pageIdentity).publicationMetadata);
    assert.equal(bodyOnly.robots.status, 'not_observed');
    assert.equal(bodyOnly.twitterCard.status, 'not_observed');

    const afterBodyText = requiredValue(requiredValue(extractHtmlSignals(
      'Body text<meta name="robots" content="noindex"><meta name="twitter:card" content="summary">',
      'example.com',
    ).pageIdentity).publicationMetadata);
    assert.equal(afterBodyText.robots.status, 'not_observed');
    assert.equal(afterBodyText.twitterCard.status, 'not_observed');

    const afterLeadingTrivia = requiredValue(requiredValue(extractHtmlSignals(
      '  <!-- comment --><meta name="robots" content="noindex">',
      'example.com',
    ).pageIdentity).publicationMetadata);
    assert.equal(afterLeadingTrivia.robots.status, 'observed');
  });

  test('keeps bounded ambiguous meta attributes inside the publication validator contract', () => {
    const fixtures = [
      `<meta name="${'x'.repeat(121)}" content="ignored">`,
      `<meta name="description" ${Array.from({ length: 129 }, (_, index) => `data-${index}="x"`).join(' ')}>`,
      `<meta name="${'x'.repeat(121)}" property="twitter:title" content="Example">`,
    ];
    for (const html of fixtures) {
      const publication = requiredValue(requiredValue(extractHtmlSignals(html, 'example.com').pageIdentity).publicationMetadata);
      assert.equal(publication.status, 'partial');
      assert.equal(publication.truncated, true);
      assert.equal(publication.robots.truncated, true);
      assert.equal(publication.twitterCard.truncated, true);
      assert.equal(validPagePublicationMetadata(publication), true);
    }
  });

  test('keeps combined malformed and truncated declarations inside the publication validator contract', () => {
    const fixtures = [
      {
        html: '<meta name="robots">',
        options: { sourceTruncated: true },
      },
      {
        html: `<meta name="robots" property="${'x'.repeat(121)}">`,
        options: {},
      },
      {
        html: `<meta name="twitter:card" content="${'x'.repeat(1_025)}">`,
        options: {},
      },
    ];
    for (const fixture of fixtures) {
      const publication = requiredValue(requiredValue(extractHtmlSignals(
        fixture.html,
        'example.com',
        fixture.options,
      ).pageIdentity).publicationMetadata);
      assert.equal(publication.status, 'partial');
      assert.equal(publication.truncated, true);
      assert.equal(publication.limitations.includes(PAGE_PUBLICATION_LIMITATIONS.malformed), true);
      assert.equal(validPagePublicationMetadata(publication), true);
    }
  });

  test('rejects impossible publication states and unrelated limitations', () => {
    const publication = requiredValue(requiredValue(extractHtmlSignals(
      '<head><meta name="robots" content="index"><meta name="twitter:title" content="Example"></head>',
      'example.com',
    ).pageIdentity).publicationMetadata);
    assert.equal(validPagePublicationMetadata(publication), true);

    const emptyObservedRobots = structuredClone(publication);
    emptyObservedRobots.robots.directives = [];
    emptyObservedRobots.robots.recognizedDirectiveCount = 0;
    assert.equal(validPagePublicationMetadata(emptyObservedRobots), false);

    const emptyObservedTwitter = structuredClone(publication);
    emptyObservedTwitter.twitterCard.declarationCount = 0;
    assert.equal(validPagePublicationMetadata(emptyObservedTwitter), false);

    const spuriousLimitation = structuredClone(publication);
    spuriousLimitation.limitations.push(PAGE_PUBLICATION_LIMITATIONS.bounds);
    assert.equal(validPagePublicationMetadata(spuriousLimitation), false);

    const spuriousMalformedLimitation = structuredClone(publication);
    spuriousMalformedLimitation.limitations.push(PAGE_PUBLICATION_LIMITATIONS.malformed);
    assert.equal(validPagePublicationMetadata(spuriousMalformedLimitation), false);

    const malformed = requiredValue(requiredValue(extractHtmlSignals(
      '<meta name="robots">',
      'example.com',
    ).pageIdentity).publicationMetadata);
    assert.equal(malformed.robots.status, 'malformed');
    const missingMalformedLimitation = structuredClone(malformed);
    missingMalformedLimitation.limitations = missingMalformedLimitation.limitations.filter(
      (limitation) => limitation !== PAGE_PUBLICATION_LIMITATIONS.malformed,
    );
    assert.equal(validPagePublicationMetadata(missingMalformedLimitation), false);
  });

  test('separates exact image totals from locally unclassified attributes and document caps', () => {
    const localAttributeCap = requiredValue(requiredValue(extractHtmlSignals(
      `<body><img alt="${'x'.repeat(2_049)}"></body>`,
      'example.com',
    ).pageIdentity).publicationMetadata);
    assert.equal(localAttributeCap.images.total, 1);
    assert.equal(localAttributeCap.images.totalComplete, true);
    assert.equal(localAttributeCap.images.classificationComplete, false);
    assert.equal(localAttributeCap.images.altUnclassified, 1);

    const documentCap = requiredValue(requiredValue(extractHtmlSignals(
      '<body><h1>Example</h1><img></body>',
      'example.com',
      { sourceTruncated: true },
    ).pageIdentity).publicationMetadata);
    assert.equal(documentCap.headings.complete, false);
    assert.equal(documentCap.images.totalComplete, false);
    assert.equal(documentCap.renderBlockingCandidates.complete, false);
  });

  test('reduces an early CSP meta policy to bounded qualification metadata', () => {
    const result = extractHtmlSignals(`
      <html><head>
        <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'sha256-private-value'">
        <script>window.example = true</script>
      </head></html>
    `, 'example.com');

    assert.deepEqual(result.cspMetaPolicy, {
      cspMetaPolicyVersion: 1,
      policiesObserved: 1,
      policiesParsed: 1,
      inlineScriptConstrained: true,
      truncated: false,
    });
    assert.doesNotMatch(JSON.stringify(result.cspMetaPolicy), /private-value|sha256-/u);

    const late = extractHtmlSignals(`
      <html><head>
        <script>window.example = true</script>
        <meta http-equiv="Content-Security-Policy" content="script-src 'self'">
      </head></html>
    `, 'example.com');
    assert.equal(late.cspMetaPolicy?.inlineScriptConstrained, false);
  });

  test('derives structured identity from the same captured HTML', () => {
    const result = extractHtmlSignals(`
      <script type="application/ld+json">
        {"@type":"Organization","name":"Example publisher","url":"/about"}
      </script>
    `, 'example.com', {
      baseUrl: 'https://www.example.com/start',
      observedAt,
    });

    const structuredDataIdentity = requiredValue(result.structuredDataIdentity);
    assert.equal(structuredDataIdentity.source, 'html');
    assert.equal(structuredDataIdentity.observedAt, observedAt);
    assert.deepEqual(structuredDataIdentity.entities, [{
      types: ['Organization'],
      name: 'Example publisher',
      declaredOrigin: 'https://www.example.com',
      sameAsHosts: [],
    }]);
  });

  test('derives a privacy-minimized credential surface from the same captured HTML', () => {
    const result = extractHtmlSignals(`
      <form method="post" action="https://identity.example/private?token=secret">
        <input type="email" name="private-email">
        <input autocomplete="current-password" value="private-password">
      </form>
    `, 'example.com', {
      baseUrl: 'https://www.example.com/start',
      observedAt,
      includeCredentialSurfaceProfile: true,
    });

    const credentialSurfaceProfile = requiredValue(result.credentialSurfaceProfile);
    assert.equal(credentialSurfaceProfile.source, 'html');
    assert.equal(credentialSurfaceProfile.observedAt, observedAt);
    assert.deepEqual(credentialSurfaceProfile.inputs, {
      count: 2,
      classifiedCount: 2,
      categories: { password: 1, email: 1, username: 0, one_time_code: 0, payment: 0 },
    });
    assert.deepEqual(credentialSurfaceProfile.forms.actions, {
      sameOrigin: 0,
      external: 1,
      missing: 0,
      cleartext: 0,
      unclassified: 0,
    });
    assert.doesNotMatch(JSON.stringify(credentialSurfaceProfile), /private-email|private-password|token=|\/private/iu);
  });

  test('can omit technology analysis while preserving page identity', () => {
    const result = extractHtmlSignals('<meta name="generator" content="Hugo 0.1">', 'example.com', {
      includeTechnologyProfile: false,
    });
    assert.equal(requiredValue(result.pageIdentity).source, 'html');
    assert.equal(result.technologyProfile, null);
  });

  test('can omit structured identity analysis while preserving page identity', () => {
    const result = extractHtmlSignals(
      '<script type="application/ld+json">{"@type":"Organization","name":"Example"}</script>',
      'example.com',
      { includeStructuredDataIdentity: false },
    );
    assert.equal(requiredValue(result.pageIdentity).source, 'html');
    assert.equal(result.structuredDataIdentity, null);
  });

  test('can omit credential-surface analysis while preserving page identity', () => {
    const result = extractHtmlSignals(
      '<form><input type="password"></form>',
      'example.com',
      { includeCredentialSurfaceProfile: false },
    );
    assert.equal(requiredValue(result.pageIdentity).source, 'html');
    assert.equal(result.credentialSurfaceProfile, null);
  });

  test('summarizes normalized resource types and external origins without retaining paths', () => {
    const result = identity(`
      <img src="https://cdn.example/images/logo.png?token=secret">
      <img src="https://cdn.example/images/logo.png?token=other">
      <script src="/assets/app.js"></script>
      <link rel="stylesheet" href="https://style.example/css/main.css">
      <link rel="canonical" href="/not-a-resource">
      <video src="https://media.example/movie.mp4" poster="https://cdn.example/poster.jpg"></video>
    `);
    assert.equal(result.resources.count, 5);
    assert.deepEqual(result.resources.byType, {
      image: 2, script: 1, stylesheet: 1, link: 0, frame: 0, media: 1, object: 0,
    });
    assert.deepEqual(result.resources.externalOrigins, [
      'https://cdn.example', 'https://media.example', 'https://style.example',
    ]);
    assert.doesNotMatch(JSON.stringify(result.resources), /logo\.png|app\.js|main\.css|movie\.mp4|secret|token=/);
  });

  test('retains bounded embedded origins separately from general resources', () => {
    const result = identity(`
      <iframe src="https://frame.example/login?secret=value"></iframe>
      <object data="https://object.example/plugin.bin"></object>
      <embed src="/same-origin.bin">
    `);
    assert.deepEqual(result.embeddedOrigins, ['https://frame.example', 'https://object.example']);
    assert.equal(result.resources.byType.frame, 1);
    assert.equal(result.resources.byType.object, 2);
    assert.doesNotMatch(JSON.stringify(result.embeddedOrigins), /login|plugin|secret/);
  });

  test('extracts only normalized domains from mail contact links', () => {
    const result = identity(`
      <a href="mailto:person@example.com,other@Sub.Example.com?subject=private">Contact</a>
      <a href="mailto:user@bücher.example">International contact</a>
      <a href="mailto:local@localhost">Invalid local address</a>
      <a href="mailto:not-an-address">Invalid</a>
    `);
    assert.deepEqual(result.contactDomains, ['example.com', 'sub.example.com', 'xn--bcher-kva.example']);
    assert.doesNotMatch(JSON.stringify(result.contactDomains), /person|other|user|subject|private/);
  });

  test('summarizes explicit and risky download destinations without retaining filenames', () => {
    const result = identity(`
      <a download href="https://files.example/reports/ordinary.pdf?account=secret">Report</a>
      <a href="https://payload.example/releases/tool.EXE?token=secret">Installer</a>
      <a href="/archive.zip">Archive</a>
      <a href="/ordinary-page">Page</a>
    `);
    assert.deepEqual(result.downloads, {
      count: 3,
      explicitCount: 1,
      riskyCount: 2,
      externalOrigins: ['https://files.example', 'https://payload.example'],
      riskyFileTypes: ['exe', 'zip'],
      truncated: false,
    });
    assert.doesNotMatch(JSON.stringify(result.downloads), /ordinary\.pdf|tool\.EXE|archive\.zip|account|token|secret/);
  });

  test('extracts, normalizes, deduplicates, and sorts recognized tracking identifiers', () => {
    const result = identity(`
      <script src="https://metrics.example/tag.js?id=gtm-ab12"></script>
      <script>window.ids = ['GTM-AB12', 'G-ABC1234567', 'ua-123456-7', 'AW-123456789'];</script>
    `);
    assert.deepEqual(result.trackingIdentifiers, [
      { type: 'advertising-property', value: 'AW-123456789' },
      { type: 'analytics-property', value: 'G-ABC1234567' },
      { type: 'legacy-analytics-property', value: 'UA-123456-7' },
      { type: 'tag-container', value: 'GTM-AB12' },
    ]);
  });

  test('caps external resource origins and reports partial provenance', () => {
    const html = Array.from({ length: MAX_RESOURCE_ORIGINS + 1 }, (_, index) => `<script src="https://cdn-${index}.example/app.js"></script>`).join('');
    const result = identity(html);
    assert.equal(result.resources.externalOrigins.length, MAX_RESOURCE_ORIGINS);
    assert.equal(result.resources.truncated, true);
    assert.equal(result.status, 'partial');
    assert.match(result.limitations.join(' '), /external resource origins were retained/);
  });

  test('caps embedded origins and contact domains independently', () => {
    const frames = Array.from({ length: MAX_EMBEDDED_ORIGINS + 1 }, (_, index) => `<iframe src="https://frame-${index}.example/"></iframe>`).join('');
    const contacts = Array.from({ length: MAX_CONTACT_DOMAINS + 1 }, (_, index) => `<a href="mailto:user@contact-${index}.example">Mail</a>`).join('');
    const result = identity(`${frames}${contacts}`);
    assert.equal(result.embeddedOrigins.length, MAX_EMBEDDED_ORIGINS);
    assert.equal(result.contactDomains.length, MAX_CONTACT_DOMAINS);
    assert.equal(result.status, 'partial');
  });

  test('caps relationship tags, srcset candidates, and tracking identifiers', () => {
    const tags = Array.from({ length: MAX_RESOURCE_TAGS + 1 }, () => '<img src="/same.png">').join('');
    const srcset = Array.from({ length: 21 }, (_, index) => `/image-${index}.png ${index + 1}w`).join(',');
    const trackers = Array.from({ length: MAX_TRACKING_IDENTIFIERS + 1 }, (_, index) => `GTM-${index.toString(36).toUpperCase().padStart(4, '0')}`).join(' ');
    const result = identity(`${tags}<img srcset="${srcset}"><script>${trackers}</script>`);
    assert.equal(result.resources.truncated, true);
    assert.equal(result.trackingIdentifiers.length, MAX_TRACKING_IDENTIFIERS);
    assert.equal(result.status, 'partial');
  });

  test('skips data-bearing srcsets rather than parsing encoded commas as resources', () => {
    const result = identity('<img srcset="data:image/svg+xml,%3Csvg%3E,%3C/svg%3E 1x, /real.png 2x">');
    assert.equal(result.resources.count, 0);
    assert.equal(result.resources.truncated, true);
    assert.equal(result.status, 'partial');
    assert.match(result.limitations.join(' '), /srcset URL candidates could not be safely enumerated/);
  });

  test('caps ordinary srcset candidates deterministically', () => {
    const srcset = Array.from({ length: 21 }, (_, index) => `/image-${index}.png ${index + 1}w`).join(',');
    const result = identity(`<img srcset="${srcset}">`);
    assert.equal(result.resources.count, 20);
    assert.equal(result.resources.truncated, true);
    assert.equal(result.status, 'partial');
  });

  test('does not treat comments or raw-text element bodies as live markup', () => {
    const result = identity(`
      <!-- <iframe src="https://comment.example/"></iframe> -->
      <!-- GTM-NOPE -->
      <script>const fake = '<form action="https://script.example/submit"></form><img src="https://script.example/pixel.png">'; const tracker = 'GTM-REAL';</script>
      <template><a href="mailto:hidden@template.example">Hidden</a> GTM-HIDE</template>
      <iframe src="https://real.example/frame"></iframe>
    `);
    assert.deepEqual(result.embeddedOrigins, ['https://real.example']);
    assert.deepEqual(result.resources.externalOrigins, ['https://real.example']);
    assert.deepEqual(result.contactDomains, []);
    assert.equal(result.forms.count, 0);
    assert.deepEqual(result.trackingIdentifiers, [{ type: 'tag-container', value: 'GTM-REAL' }]);
  });
});
