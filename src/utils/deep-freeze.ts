export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  const objectValue = value as Record<string, unknown>;
  const propertyNames = Reflect.ownKeys(objectValue);
  for (const propertyName of propertyNames) {
    const propertyValue = objectValue[propertyName as keyof typeof objectValue];
    if (propertyValue && typeof propertyValue === "object" && !Object.isFrozen(propertyValue)) {
      deepFreeze(propertyValue);
    }
  }
  return Object.freeze(value);
}
