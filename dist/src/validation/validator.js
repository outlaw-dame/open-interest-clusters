import { createRequire } from "node:module";
import schema from "../../schema/interest-cluster.schema.json" with { type: "json" };
const require = createRequire(import.meta.url);
const Ajv2020Ctor = require("ajv/dist/2020").default;
const addFormatsModule = require("ajv-formats");
const addFormats = (addFormatsModule.default ?? addFormatsModule);
const ajv = new Ajv2020Ctor({ allErrors: true, strict: true, strictTypes: false, strictRequired: false });
addFormats(ajv);
const validate = ajv.compile(schema);
export class DatasetValidationError extends Error {
    details;
    constructor(details) {
        super(`Dataset validation failed with ${details.length} error(s).`);
        this.name = "DatasetValidationError";
        this.details = details;
    }
}
export function validateDataset(input) {
    if (validate(input))
        return input;
    const details = (validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message ?? "validation error"}`.trim());
    throw new DatasetValidationError(details);
}
//# sourceMappingURL=validator.js.map