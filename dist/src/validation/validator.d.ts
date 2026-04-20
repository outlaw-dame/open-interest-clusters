import type { InterestClusterDataset } from "../types/schema.js";
export declare class DatasetValidationError extends Error {
    readonly details: string[];
    constructor(details: string[]);
}
export declare function validateDataset(input: unknown): InterestClusterDataset;
