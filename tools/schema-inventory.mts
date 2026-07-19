#!/usr/bin/env node

import {
  buildSchemaCompatibilityInventory,
  formatSchemaCompatibilityInventory,
} from './schema-compatibility.mts';

const inventory = buildSchemaCompatibilityInventory();
process.stdout.write(formatSchemaCompatibilityInventory(inventory));
