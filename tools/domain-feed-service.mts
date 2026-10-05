import { domainFeedServiceConfiguration } from '../lib/server/domain-feed-config.mts';
import { startDomainFeedService } from '../lib/server/domain-feed-service.mts';

async function main() {
  if (process.argv.slice(2).join(' ') !== '--serve') throw new Error('Usage: node tools/domain-feed-service.mts --serve');
  const configuration = domainFeedServiceConfiguration();
  const service = await startDomainFeedService(configuration);
  process.stdout.write('Optional domain feed service is listening on loopback.\n');
  let closing = false;
  const stop = () => {
    if (closing) return;
    closing = true;
    void service.close().then(() => { process.exitCode = 0; }, () => { process.exitCode = 1; });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

void main().catch(() => { process.stderr.write('Domain feed service could not start; review its local configuration.\n'); process.exitCode = 1; });
