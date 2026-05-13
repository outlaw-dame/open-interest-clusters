import { AnnProviderOrchestrator, type AnnOrchestratorOptions, type AnnProviderCandidate } from "./orchestrator.js";

export interface AnnProfileOptions extends AnnOrchestratorOptions {
  durable?: AnnProviderCandidate;
  local?: AnnProviderCandidate;
  fallback?: AnnProviderCandidate;
}

function definedCandidates(options: AnnProfileOptions): AnnProviderCandidate[] {
  return [options.durable, options.local, options.fallback].filter(
    (candidate): candidate is AnnProviderCandidate => candidate !== undefined
  );
}

export function createHybridAnnStack(options: AnnProfileOptions) {
  return new AnnProviderOrchestrator(definedCandidates(options), options);
}

export function createServerAnnStack(options: AnnProfileOptions) {
  const candidates = [options.durable, options.fallback].filter(
    (candidate): candidate is AnnProviderCandidate => candidate !== undefined
  );

  return new AnnProviderOrchestrator(candidates, options);
}

export function createBrowserAnnStack(options: AnnProfileOptions) {
  const candidates = [options.local, options.fallback].filter(
    (candidate): candidate is AnnProviderCandidate => candidate !== undefined
  );

  return new AnnProviderOrchestrator(candidates, options);
}

export function createDurableAnnStack(options: AnnProfileOptions) {
  if (options.durable === undefined) {
    throw new Error("Durable ANN provider candidate is required");
  }

  return new AnnProviderOrchestrator([options.durable], options);
}
