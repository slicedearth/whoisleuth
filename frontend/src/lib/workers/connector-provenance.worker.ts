import type { ConnectorReviewRequest } from '../connector-provenance-worker.ts';
import { reviewConnectorConfigurationText } from '../../../../packages/investigation/connector-provenance-review.mts';

let started = false;
self.onmessage = (event: MessageEvent<ConnectorReviewRequest>) => {
  if (started) return;
  started = true;
  try { self.postMessage(reviewConnectorConfigurationText(event.data.current, event.data.previous, event.data.reviewedAt)); }
  catch { self.postMessage(null); }
};
