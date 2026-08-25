#!/usr/bin/env node

import { SCHEMA_LIFECYCLE_REGISTRY } from '../packages/contracts/schema-lifecycle-registry.mts';
import {
  buildSchemaCompatibilityInventory,
  formatSchemaCompatibilityInventory,
} from './schema-compatibility.mts';
import { validateSchemaLifecycleRepository } from './schema-lifecycle-repository.mts';
import {
  discoverSchemaSources,
  validateSchemaSourceCoverage,
} from './schema-source-coverage.mts';

const inventory = buildSchemaCompatibilityInventory();
const discovery = await discoverSchemaSources();
await validateSchemaLifecycleRepository(SCHEMA_LIFECYCLE_REGISTRY, discovery);
await validateSchemaSourceCoverage(inventory.entries, discovery);
process.stdout.write(formatSchemaCompatibilityInventory(inventory));
