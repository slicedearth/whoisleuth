import {
  MAX_WORKSPACE_INPUT_ARRAY_LENGTH,
  MAX_WORKSPACE_INPUT_GRAPH_DEPTH,
  MAX_WORKSPACE_INPUT_GRAPH_NODES,
  MAX_WORKSPACE_INPUT_OBJECT_KEYS,
  MAX_WORKSPACE_INPUT_STRING_CODE_UNITS,
} from '../contracts/workspace-portability.mts';

type UnknownRecord = Record<string, unknown>;

function inputError(label: string, detail: string): TypeError {
  return new TypeError(`${label} must be bounded ordinary JSON data; ${detail}.`);
}

function ownDataDescriptors(
  value: object,
  label: string,
): ReadonlyArray<readonly [string, PropertyDescriptor]> {
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw inputError(label, 'its property keys could not be inspected safely');
  }
  if (keys.some((key) => typeof key !== 'string')) {
    throw inputError(label, 'symbol keys are not supported');
  }
  return (keys as readonly string[]).map((key) => {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      throw inputError(label, 'a property descriptor could not be inspected safely');
    }
    if (!descriptor || !('value' in descriptor)) {
      throw inputError(label, 'accessor properties are not supported');
    }
    return [key, descriptor] as const;
  });
}

export function ordinaryWorkspaceRecord(value: unknown, label = 'Workspace input'): UnknownRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    throw inputError(label, 'its prototype could not be inspected safely');
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw inputError(label, 'custom object prototypes are not supported');
  }
  const descriptors = ownDataDescriptors(value, label);
  if (descriptors.length > MAX_WORKSPACE_INPUT_OBJECT_KEYS) {
    throw inputError(label, 'an object exceeds the key ceiling');
  }
  if (descriptors.some(([, descriptor]) => !descriptor.enumerable)) {
    throw inputError(label, 'non-enumerable object fields are not supported');
  }
  return value as UnknownRecord;
}

export function assertWorkspaceInputGraph(value: unknown, label = 'Workspace input'): void {
  const pending: Array<Readonly<{ value: unknown; depth: number; label: string }>> = [{ value, depth: 0, label }];
  const seen = new WeakSet<object>();
  let nodes = 0;
  let stringCodeUnits = 0;
  while (pending.length) {
    const current = pending.pop()!;
    const candidate = current.value;
    if (typeof candidate === 'string') {
      stringCodeUnits += candidate.length;
      if (stringCodeUnits > MAX_WORKSPACE_INPUT_STRING_CODE_UNITS) {
        throw inputError(label, 'aggregate text exceeds the string ceiling');
      }
      continue;
    }
    if (candidate === null
      || candidate === undefined
      || typeof candidate === 'boolean'
      || typeof candidate === 'number') continue;
    if (typeof candidate !== 'object') {
      throw inputError(current.label, 'non-JSON values are not supported');
    }
    if (current.depth > MAX_WORKSPACE_INPUT_GRAPH_DEPTH) {
      throw inputError(label, 'the nesting depth exceeds the graph ceiling');
    }
    nodes += 1;
    if (nodes > MAX_WORKSPACE_INPUT_GRAPH_NODES) {
      throw inputError(label, 'the graph exceeds the node ceiling');
    }
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    if (Array.isArray(candidate)) {
      let prototype: object | null;
      try {
        prototype = Object.getPrototypeOf(candidate);
      } catch {
        throw inputError(current.label, 'its array prototype could not be inspected safely');
      }
      if (prototype !== Array.prototype) {
        throw inputError(current.label, 'custom array prototypes are not supported');
      }
      const descriptors = ownDataDescriptors(candidate, current.label);
      const lengthDescriptor = descriptors.find(([key]) => key === 'length')?.[1];
      const length = lengthDescriptor?.value;
      if (!Number.isSafeInteger(length)
        || Number(length) < 0
        || Number(length) > MAX_WORKSPACE_INPUT_ARRAY_LENGTH) {
        throw inputError(current.label, 'an array exceeds the length ceiling');
      }
      if (descriptors.length !== Number(length) + 1) {
        throw inputError(current.label, 'sparse arrays and custom array fields are not supported');
      }
      const byKey = new Map(descriptors);
      for (let index = 0; index < Number(length); index += 1) {
        const descriptor = byKey.get(String(index));
        if (!descriptor?.enumerable) {
          throw inputError(current.label, 'sparse or non-enumerable array entries are not supported');
        }
        pending.push({
          value: descriptor.value,
          depth: current.depth + 1,
          label: `${current.label}[${index}]`,
        });
      }
      continue;
    }

    const record = ordinaryWorkspaceRecord(candidate, current.label)!;
    const descriptors = ownDataDescriptors(record, current.label);
    for (const [key, descriptor] of descriptors) {
      pending.push({
        value: descriptor.value,
        depth: current.depth + 1,
        label: `${current.label}.${key}`,
      });
    }
  }
}

export function assertWorkspacePortableVersion(
  value: unknown,
  currentVersion: number,
  label: string,
): number | null {
  if (!Number.isSafeInteger(currentVersion) || currentVersion < 1) {
    throw new TypeError(`${label} current version is invalid.`);
  }
  if (Array.isArray(value)) {
    return null;
  }
  const record = ordinaryWorkspaceRecord(value, label);
  if (!record) throw inputError(label, 'the root must be an object');
  const descriptor = Object.getOwnPropertyDescriptor(record, 'version');
  if (!descriptor) return null;
  if (!('value' in descriptor)) throw inputError(label, 'the version must be a positive safe integer');
  if (typeof descriptor.value === 'number'
    && Number.isFinite(descriptor.value)
    && descriptor.value > currentVersion) {
    return descriptor.value;
  }
  if (!Number.isSafeInteger(descriptor.value) || Number(descriptor.value) < 1) {
    throw inputError(label, 'the version must be a positive safe integer');
  }
  const version = Number(descriptor.value);
  return version;
}

export function assertWorkspaceDeclaredVersion(value: unknown, label: string): void {
  if (Array.isArray(value) || value === null || value === undefined) return;
  const record = ordinaryWorkspaceRecord(value, label);
  if (!record) return;
  const descriptor = Object.getOwnPropertyDescriptor(record, 'version');
  if (!descriptor) return;
  if (!('value' in descriptor)
    || !Number.isSafeInteger(descriptor.value)
    || Number(descriptor.value) < 1) {
    throw inputError(label, 'a declared version must be a positive safe integer');
  }
}
