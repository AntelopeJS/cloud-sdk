import { isRecord, isString } from "../src/guards.js";

/** A value `JSON.parse` can return, and `JSON.stringify` writes back as is. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === "object") {
    return Array.isArray(value)
      ? value.every(isJsonValue)
      : Object.values(value).every(isJsonValue);
  }
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

export function parseJson(text: string): JsonValue {
  const parsed: unknown = JSON.parse(text);
  if (!isJsonValue(parsed)) throw new TypeError(`Not a JSON value: ${text}`);
  return parsed;
}

/** The lines that hold JSON, parsed: the lines of text between them are skipped. */
export function parseJsonLines(lines: string[]): JsonValue[] {
  return lines.flatMap((line) => {
    try {
      return [parseJson(line)];
    } catch {
      return [];
    }
  });
}

/** The member or element at `path`; it throws when the path leads nowhere. */
export function jsonAt(
  value: JsonValue,
  ...path: (string | number)[]
): JsonValue {
  let current = value;
  for (const step of path) {
    if (!Array.isArray(current) && !isRecord(current)) {
      throw new TypeError(`No ${step} in ${JSON.stringify(current)}`);
    }
    const next: JsonValue | undefined = Array.isArray(current)
      ? current[Number(step)]
      : current[String(step)];
    if (next === undefined) {
      throw new TypeError(`No ${step} in ${JSON.stringify(current)}`);
    }
    current = next;
  }
  return current;
}

/** The string at `path`; it throws unless there is one. */
export function textAt(value: JsonValue, ...path: (string | number)[]): string {
  const found = jsonAt(value, ...path);
  if (!isString(found)) {
    throw new TypeError(
      `${path.join(".")} is not a string: ${JSON.stringify(found)}`,
    );
  }
  return found;
}
