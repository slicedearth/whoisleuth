import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DOMAIN_PORTFOLIO_INPUT_SCHEMA,
  reviewDomainPortfolio,
} from '../lib/domain-portfolio-review.mts';

const NOW = '2026-08-05T00:00:00.000Z';

describe('domain portfolio review', () => {
  test('separates analyst assertions while exposing concentration, renewal, and recovery cycles', () => {
    const result = reviewDomainPortfolio({
      schema: DOMAIN_PORTFOLIO_INPUT_SCHEMA,
      version: 1,
      portfolioLabel: 'Defensive domains',
      assets: [
        {
          domain: 'one.example', criticality: 'critical', registrar: 'Registrar A', registrarAccount: 'Primary',
          expiresAt: '2026-08-20T00:00:00Z', autoRenew: true, dnsProviders: ['DNS A'], mailProviders: ['Mail A'],
          certificateProviders: ['CA A'], recoveryDomains: ['two.example'], reviewedAt: NOW,
        },
        {
          domain: 'two.example', criticality: 'high', registrar: 'Registrar A', registrarAccount: 'Primary',
          expiresAt: null, autoRenew: null, dnsProviders: ['DNS A'], mailProviders: [],
          certificateProviders: ['CA B'], recoveryDomains: ['one.example'], reviewedAt: NOW,
        },
      ],
    }, NOW);
    assert.equal(result.simulations.find((item) => item.dependencyType === 'registrar')?.share, 100);
    assert.equal(result.simulations.find((item) => item.dependencyType === 'dns')?.affectedCriticalDomains.length, 2);
    assert.equal(result.recoveryCycles.every((item) => item.reciprocal), true);
    assert.equal(result.renewalQueue.length, 2);
    assert.equal(result.unknownCounts.expiry, 1);
    assert.match(result.limitations.join(' '), /analyst-supplied/u);
  });

  test('rejects duplicate assets, secrets-by-shape, and unbounded provider arrays', () => {
    const base = {
      schema: DOMAIN_PORTFOLIO_INPUT_SCHEMA, version: 1, portfolioLabel: 'Fixture',
      assets: [{
        domain: 'one.example', criticality: 'standard', registrar: null, registrarAccount: null,
        expiresAt: null, autoRenew: null, dnsProviders: [], mailProviders: [], certificateProviders: [], recoveryDomains: [], reviewedAt: NOW,
      }],
    };
    assert.throws(() => reviewDomainPortfolio({ ...base, assets: [...base.assets, ...base.assets] }, NOW), /unique/u);
    assert.throws(() => reviewDomainPortfolio({
      ...base,
      assets: [{ ...base.assets[0], credential: 'not accepted' }],
    }, NOW), /unknown field/u);
    assert.throws(() => reviewDomainPortfolio({
      ...base,
      assets: [{ ...base.assets[0], dnsProviders: Array.from({ length: 17 }, (_, index) => `Provider ${index}`) }],
    }, NOW), /no more than 16/u);
  });
});
