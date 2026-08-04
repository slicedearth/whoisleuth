// Privacy-minimized public contact handoff. The browser sends only a bounded
// contact category and a short-lived anti-bot token. Subject and message text
// stay in the browser and are never accepted by this server boundary.

import { readTextCapped, safeFetchDetailed } from './safe-fetch.mts';
import {
  MAX_CONTACT_ADDRESS_LENGTH,
  normalizeContactAddress,
} from './contact-address.mts';

type EnvironmentInput = Record<string, unknown>;
type ContactCategory = 'privacy' | 'outbound' | 'security';
type ContactRouteRequest = (
  url: string,
  options: RequestInit,
  dependencies?: { maxRedirects?: number },
) => Promise<{
  response: Response;
  finalUrl: string;
  redirected: boolean;
  redirectLimitReached: boolean;
}>;
type ContactRouteDependencies = {
  request?: ContactRouteRequest;
  readText?: typeof readTextCapped;
};
type ContactRoutePublicConfig = {
  available: boolean;
  siteKey: string | null;
  categories: ContactCategory[];
};
type ContactRouteResolution =
  | { status: 'ok'; category: ContactCategory; route: string }
  | { status: 'invalid_request' | 'challenge_failed' | 'unavailable' };

const CONTACT_CATEGORIES = Object.freeze([
  'privacy',
  'outbound',
  'security',
] as const);
const CONTACT_ROUTE_ENV_KEYS: Readonly<Record<ContactCategory, string>> = Object.freeze({
  privacy: 'WHOISLEUTH_PRIVACY_CONTACT',
  outbound: 'WHOISLEUTH_OUTBOUND_CONTACT',
  security: 'WHOISLEUTH_SECURITY_CONTACT',
});
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_EXPECTED_ACTION = 'contact_route';
const MAX_CONTACT_ROUTE_BODY_BYTES = 8 * 1024;
const MAX_TURNSTILE_RESPONSE_BYTES = 16 * 1024;
const MAX_TURNSTILE_TOKEN_LENGTH = 2_048;
const MAX_TURNSTILE_SITE_KEY_LENGTH = 128;
const MAX_TURNSTILE_SECRET_LENGTH = 256;
const MAX_ALLOWED_HOSTNAMES_LENGTH = 1_024;
const MAX_ALLOWED_HOSTNAMES = 10;
const TURNSTILE_TIMEOUT_MS = 8_000;

function boundedEnvironmentText(
  env: EnvironmentInput | null | undefined,
  key: string,
  maximum: number,
): string | null {
  const value = env?.[key];
  if (typeof value !== 'string' || !value || value.length > maximum) return null;
  if (/[^\x20-\x7e]/u.test(value)) return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maximum ? trimmed : null;
}

function contactCategory(value: unknown): ContactCategory | null {
  return typeof value === 'string'
    && (CONTACT_CATEGORIES as readonly string[]).includes(value)
    ? value as ContactCategory
    : null;
}

function allowedHostnames(env: EnvironmentInput | null | undefined): string[] {
  const raw = boundedEnvironmentText(
    env,
    'TURNSTILE_ALLOWED_HOSTNAMES',
    MAX_ALLOWED_HOSTNAMES_LENGTH,
  );
  if (!raw) return [];
  const hostnames: string[] = [];
  for (const part of raw.split(',').slice(0, MAX_ALLOWED_HOSTNAMES + 1)) {
    const hostname = part.trim().toLowerCase().replace(/\.$/u, '');
    if (!hostname || hostname.length > 253 || hostnames.includes(hostname)) continue;
    if (hostname !== 'localhost' && hostname.split('.').some((label) => (
      !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label)
    ))) continue;
    hostnames.push(hostname);
  }
  return hostnames.length <= MAX_ALLOWED_HOSTNAMES ? hostnames : [];
}

function configuredRoutes(env: EnvironmentInput | null | undefined): Map<ContactCategory, string> {
  const routes = new Map<ContactCategory, string>();
  for (const category of CONTACT_CATEGORIES) {
    const route = normalizeContactAddress(env?.[CONTACT_ROUTE_ENV_KEYS[category]]);
    if (route) routes.set(category, route);
  }
  return routes;
}

function contactRoutePublicConfig(
  env: EnvironmentInput | null | undefined = process.env,
): ContactRoutePublicConfig {
  const siteKey = boundedEnvironmentText(env, 'TURNSTILE_SITE_KEY', MAX_TURNSTILE_SITE_KEY_LENGTH);
  const secret = boundedEnvironmentText(env, 'TURNSTILE_SECRET_KEY', MAX_TURNSTILE_SECRET_LENGTH);
  const hostnames = allowedHostnames(env);
  const categories = [...configuredRoutes(env).keys()];
  const available = Boolean(siteKey && secret && hostnames.length && categories.length);
  return {
    available,
    siteKey: available ? siteKey : null,
    categories: available ? categories : [],
  };
}

function parseContactRouteBody(body: unknown): {
  category: ContactCategory;
  token: string;
} | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const entries = Object.entries(body);
  if (entries.length !== 2 || !Object.hasOwn(body, 'category') || !Object.hasOwn(body, 'token')) {
    return null;
  }
  const record = body as { category?: unknown; token?: unknown };
  const category = contactCategory(record.category);
  if (!category || typeof record.token !== 'string') return null;
  const token = record.token.trim();
  if (!token || token.length > MAX_TURNSTILE_TOKEN_LENGTH || /[\u0000-\u001f\u007f]/u.test(token)) {
    return null;
  }
  return { category, token };
}

async function verifyContactRoute(
  categoryValue: unknown,
  tokenValue: unknown,
  {
    env = process.env,
    dependencies = {},
  }: {
    env?: EnvironmentInput | null;
    dependencies?: ContactRouteDependencies;
  } = {},
): Promise<ContactRouteResolution> {
  const parsed = parseContactRouteBody({ category: categoryValue, token: tokenValue });
  if (!parsed) return { status: 'invalid_request' };

  const siteKey = boundedEnvironmentText(env, 'TURNSTILE_SITE_KEY', MAX_TURNSTILE_SITE_KEY_LENGTH);
  const secret = boundedEnvironmentText(env, 'TURNSTILE_SECRET_KEY', MAX_TURNSTILE_SECRET_LENGTH);
  const hostnames = allowedHostnames(env);
  const route = configuredRoutes(env).get(parsed.category);
  if (!siteKey || !secret || !hostnames.length || !route) return { status: 'unavailable' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TURNSTILE_TIMEOUT_MS);
  try {
    const request = dependencies.request ?? safeFetchDetailed as ContactRouteRequest;
    const result = await request(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ secret, response: parsed.token }).toString(),
      signal: controller.signal,
    }, { maxRedirects: 0 });
    if (
      result.response.status !== 200
      || result.redirected
      || result.redirectLimitReached
      || result.finalUrl !== TURNSTILE_VERIFY_URL
    ) {
      await result.response.body?.cancel().catch(() => {});
      return { status: 'challenge_failed' };
    }
    const readText = dependencies.readText ?? readTextCapped;
    const responseBody = await readText(result.response, MAX_TURNSTILE_RESPONSE_BYTES);
    if (responseBody.truncated) return { status: 'challenge_failed' };
    let payload: unknown;
    try {
      payload = JSON.parse(responseBody.text);
    } catch {
      return { status: 'challenge_failed' };
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { status: 'challenge_failed' };
    }
    const record = payload as Record<string, unknown>;
    const hostname = typeof record.hostname === 'string'
      ? record.hostname.trim().toLowerCase().replace(/\.$/u, '')
      : '';
    if (
      record.success !== true
      || record.action !== TURNSTILE_EXPECTED_ACTION
      || !hostnames.includes(hostname)
    ) {
      return { status: 'challenge_failed' };
    }
    return { status: 'ok', category: parsed.category, route };
  } catch {
    return { status: 'challenge_failed' };
  } finally {
    clearTimeout(timeout);
  }
}

export {
  CONTACT_CATEGORIES,
  CONTACT_ROUTE_ENV_KEYS,
  MAX_CONTACT_ADDRESS_LENGTH,
  MAX_CONTACT_ROUTE_BODY_BYTES,
  MAX_TURNSTILE_TOKEN_LENGTH,
  TURNSTILE_EXPECTED_ACTION,
  TURNSTILE_VERIFY_URL,
  contactRoutePublicConfig,
  parseContactRouteBody,
  verifyContactRoute,
};
export type {
  ContactCategory,
  ContactRouteDependencies,
  ContactRoutePublicConfig,
  ContactRouteResolution,
};
