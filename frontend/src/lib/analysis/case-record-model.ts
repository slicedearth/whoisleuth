// Stable case-record facade. Core validation, evidence history/comparison,
// and analyst-record operations remain framework-neutral and independently
// testable while existing consumers keep one compatibility import.

export * from './case-record-contracts.ts';
export * from './case-record-core.ts';
export * from './case-brand-profile-references.ts';
export * from './case-evidence-model.ts';
export * from './case-record-operations.ts';
export * from './case-investigation-branch-model.ts';
