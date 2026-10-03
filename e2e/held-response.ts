import type { Page, Request, Route } from '@playwright/test';
import { ALLOWED_ORIGIN } from './constants';

/** A single admitted fixture request, with explicit arrival and route-completion barriers. */
export async function holdFixtureResponse(
  page: Page,
  matches: (url: URL) => boolean,
  response: Parameters<Route['fulfill']>[0],
) {
  let release = () => {};
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let arrive!: (request: Request) => void;
  const received = new Promise<Request>(resolve => { arrive = resolve; });
  let finish = () => {};
  const handled = new Promise<void>(resolve => { finish = resolve; });
  let calls = 0;
  let failure: unknown;
  const handler = async (route: Route) => {
    calls += 1;
    if (calls !== 1) throw new Error('The held fixture received more than one request.');
    const request = route.request();
    arrive(request);
    await barrier;
    try { await route.fulfill(response); }
    catch (error) {
      // A cancelled transport can refuse fulfilment. Any other error is real.
      if (!request.failure()) failure = error;
    } finally { finish(); }
  };
  const routeMatch = (url: URL) => url.origin === ALLOWED_ORIGIN && matches(url);
  await page.route(routeMatch, handler);
  return {
    received,
    async release() {
      release();
      await handled;
      if (failure) throw failure;
      await page.unroute(routeMatch, handler);
    },
  };
}
