import { createRequire } from "node:module";
import type { ErrorObject } from "ajv";
import schema from "../../schema/interest-cluster.schema.json" with { type: "json" };
import type { InterestClusterDataset } from "../types/schema.js";

const require = createRequire(import.meta.url);
const Ajv2020Ctor = require("ajv/dist/2020").default as new (options?: Record<string, unknown>) => {
  compile<T>(schemaObject: unknown): (input: unknown) => input is T;
};
const addFormatsModule = require("ajv-formats");
const addFormats = (addFormatsModule.default ?? addFormatsModule) as (ajvInstance: unknown) => void;

const ajv = new Ajv2020Ctor({ allErrors: true, strict: true, strictTypes: false, strictRequired: false });
addFormats(ajv);
const validate = ajv.compile<InterestClusterDataset>(schema) as ((input: unknown) => input is InterestClusterDataset) & {
  errors?: ErrorObject[];
};

export class DatasetValidationError extends Error {
  public readonly details: string[];
  public constructor(details: string[]) {
    super(`Dataset validation failed with ${details.length} error(s).`);
    this.name = "DatasetValidationError";
    this.details = details;
  }
}

export function validateDataset(input: unknown): InterestClusterDataset {
  if (validate(input)) return input;
  const details = (validate.errors ?? []).map((error: ErrorObject) => `${error.instancePath || "/"} ${error.message ?? "validation error"}`.trim());
  throw new DatasetValidationError(details);
}
