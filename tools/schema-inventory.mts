#!/usr/bin/env node

import {
  buildSchemaCompatibilityInventory,
  formatSchemaCompatibilityInventory,
} from './schema-compatibility.mts';
import { reconcileSchemaSourceCoverage } from './schema-source-coverage.mts';

const inventory = buildSchemaCompatibilityInventory();
await reconcileSchemaSourceCoverage(inventory.entries);
process.stdout.write(formatSchemaCompatibilityInventory(inventory));
