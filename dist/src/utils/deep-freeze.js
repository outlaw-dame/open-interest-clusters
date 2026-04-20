export function deepFreeze(value) {
    if (value === null || typeof value !== "object")
        return value;
    const objectValue = value;
    const propertyNames = Reflect.ownKeys(objectValue);
    for (const propertyName of propertyNames) {
        const propertyValue = objectValue[propertyName];
        if (propertyValue && typeof propertyValue === "object" && !Object.isFrozen(propertyValue)) {
            deepFreeze(propertyValue);
        }
    }
    return Object.freeze(value);
}
//# sourceMappingURL=deep-freeze.js.map