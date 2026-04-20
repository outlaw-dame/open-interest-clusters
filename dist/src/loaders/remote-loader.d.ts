import type { InterestClusterDataset } from "../types/schema.js";
export interface RemoteDatasetCache {
    etag?: string;
    dataset?: Readonly<InterestClusterDataset>;
}
export interface FetchRemoteDatasetOptions {
    attempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    signal?: AbortSignal;
    cache?: RemoteDatasetCache;
    headers?: Record<string, string>;
    fetchImpl?: typeof fetch;
}
export interface FetchRemoteDatasetResult {
    dataset: Readonly<InterestClusterDataset>;
    etag?: string;
    notModified: boolean;
}
export declare class RemoteDatasetFetchError extends Error {
    constructor(message: string);
}
export declare function fetchRemoteDataset(url: string, options?: FetchRemoteDatasetOptions): Promise<FetchRemoteDatasetResult>;
