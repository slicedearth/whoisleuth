const APPLICATION_SOURCES = '^(?:bin|cli|frontend/src|lib|netlify/functions|tools)(?:/|$)|^server\\.mts$';

const SERVER_ONLY_LIBRARIES = [
  'abusech-auth',
  'auth',
  'availability',
  'capabilities',
  'ct-search',
  'distributed-operation-budget',
  'dns-intelligence',
  'dns-mx',
  'domain-posture',
  'favicon',
  'feature-policy',
  'http',
  'http-intelligence',
  'lookup',
  'lookup-cache',
  'netlify-function-types',
  'netlify-network-guard',
  'observed-network-context',
  'operation-budget',
  'rate-limit',
  'rdap',
  'safe-fetch',
  'scheduled-monitor-configuration',
  'scheduled-monitor-crypto',
  'scheduled-monitor-cycle',
  'scheduled-monitor-management',
  'scheduled-monitor-netlify-store',
  'scheduled-monitor-repository',
  'scheduled-monitor-runtime',
  'security-txt',
  'service-binding-dns',
  'threatfox-intelligence',
  'tls-intelligence',
  'urlhaus-intelligence',
  'urlscan-intelligence',
  'whois',
];

const SERVER_ONLY_PATH = [
  '^(?:bin|cli|netlify/functions|tools)(?:/|$)',
  '^server\\.mts$',
  `^lib/(?:${SERVER_ONLY_LIBRARIES.join('|')})\\.mts$`,
];

const DEEP_ONLY_COLLECTORS = [
  'observed-network-context',
  'security-txt',
  'threatfox-intelligence',
  'urlhaus-intelligence',
  'urlscan-intelligence',
];

const FAST_COMPACT_ENTRY_POINTS = [
  '^lib/scheduled-monitor-(?:cycle|runtime)\\.mts$',
  '^netlify/functions/scheduled-monitor\\.mts$',
];

const PROVIDER_ADAPTERS = '^lib/(?:threatfox|urlhaus|urlscan)-intelligence\\.mts$';

export default {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Application modules must not participate in circular dependencies.',
      from: {
        path: APPLICATION_SOURCES,
      },
      to: {
        circular: true,
      },
    },
    {
      name: 'frontend-no-server-only',
      severity: 'error',
      comment: 'Browser code must not reach server networking, secrets, authentication, filesystem, CLI, or function modules.',
      from: {
        path: '^frontend/src/',
      },
      to: {
        path: SERVER_ONLY_PATH,
        reachable: true,
      },
    },
    {
      name: 'frontend-no-node-core',
      severity: 'error',
      comment: 'Browser code must not import Node core modules.',
      from: {
        path: '^frontend/src/',
      },
      to: {
        dependencyTypes: ['core'],
      },
    },
    {
      name: 'fast-compact-no-direct-deep-collector',
      severity: 'error',
      comment: 'Scheduled fast and compact entry points may use the guarded Lookup dispatcher but must not bypass it to call deep-only collectors.',
      from: {
        path: FAST_COMPACT_ENTRY_POINTS,
      },
      to: {
        path: `^lib/(?:${DEEP_ONLY_COLLECTORS.join('|')})\\.mts$`,
      },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment: 'Application imports must resolve under the locked TypeScript and workspace configuration.',
      from: {
        path: APPLICATION_SOURCES,
      },
      to: {
        couldNotResolve: true,
        pathNot: '^(?:\\$app/|svelte/internal/)',
      },
    },
  ],
  required: [
    {
      name: 'provider-adapters-use-contract',
      severity: 'error',
      comment: 'Optional intelligence adapters must depend directly on the provider-neutral evidence contract.',
      module: {
        path: PROVIDER_ADAPTERS,
      },
      to: {
        path: '^lib/threat-intelligence-contract\\.mts$',
      },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    exclude: {
      path: '^(?:frontend/(?:\\.svelte-kit|build)|node_modules|playwright-report|test-results)(?:/|$)',
    },
    tsConfig: {
      fileName: 'tsconfig.dependency-cruiser.json',
    },
    enhancedResolveOptions: {
      extensions: ['.mts', '.ts', '.svelte', '.mjs', '.js', '.json'],
    },
  },
};
