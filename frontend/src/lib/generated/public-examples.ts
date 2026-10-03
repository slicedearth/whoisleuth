// Generated from canonical runtime-neutral metadata. Do not edit by hand.
export const PUBLIC_EXAMPLE_LOADERS = {
  "lookup-preflight": () => import("./public-example-outputs/lookup-preflight.ts").then(module => module.PUBLIC_EXAMPLE),
  "offline-route-review": () => import("./public-example-outputs/offline-route-review.ts").then(module => module.PUBLIC_EXAMPLE),
  "workflow-plan": () => import("./public-example-outputs/workflow-plan.ts").then(module => module.PUBLIC_EXAMPLE),
  "case-handoff": () => import("./public-example-outputs/case-handoff.ts").then(module => module.PUBLIC_EXAMPLE),
  "case-pin-input": () => import("./public-example-outputs/case-pin-input.ts").then(module => module.PUBLIC_EXAMPLE),
  "case-assess-input": () => import("./public-example-outputs/case-assess-input.ts").then(module => module.PUBLIC_EXAMPLE),
  "case-recheck-input": () => import("./public-example-outputs/case-recheck-input.ts").then(module => module.PUBLIC_EXAMPLE),
} as const;
export type PublicExampleId = keyof typeof PUBLIC_EXAMPLE_LOADERS;
export type PublicExampleOutput = Awaited<ReturnType<typeof PUBLIC_EXAMPLE_LOADERS[PublicExampleId]>>;
