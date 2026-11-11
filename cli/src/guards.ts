/** Whether `value` is a string primitive. */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** Whether `value` is a number primitive. */
export function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

/** Whether `value` is a non-null object that is not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
