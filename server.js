'use strict';

// Stable executable entry point retained while the self-hosted runtime uses
// Node's native TypeScript support internally.
require('./server.mts').startServer();
