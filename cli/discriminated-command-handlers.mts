type DiscriminatedCommand = Readonly<{ action: string }>;

type DiscriminatedCommandHandlerMap<
  Arguments extends DiscriminatedCommand,
  Tail extends unknown[],
  Result,
> = Readonly<{
  [Action in Arguments['action']]: (
    args: Extract<Arguments, { action: Action }>,
    ...tail: Tail
  ) => Promise<Result>;
}>;

function runDiscriminatedCommandHandler<
  Arguments extends DiscriminatedCommand,
  Tail extends unknown[],
  Result,
>(
  handlers: DiscriminatedCommandHandlerMap<Arguments, Tail, Result>,
  args: Arguments,
  ...tail: Tail
): Promise<Result> {
  // TypeScript cannot retain the correlation between a discriminated union and
  // an indexed mapped type. The map's public type proves that correlation;
  // this local cast only performs the already-checked lookup.
  const handler = (handlers as Readonly<Record<
    Arguments['action'],
    (candidate: Arguments, ...rest: Tail) => Promise<Result>
  >>)[args.action as Arguments['action']];
  if (typeof handler !== 'function') {
    throw new Error(`No command handler is registered for ${String(args.action)}.`);
  }
  return handler(args, ...tail);
}

export { runDiscriminatedCommandHandler };
export type { DiscriminatedCommandHandlerMap };
