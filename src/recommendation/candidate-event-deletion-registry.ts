/**
 * Internal wiring between the candidate event store, the onboarding lifecycle and the derived-state
 * orchestrator. Not exported from the package entry point.
 *
 * A lifecycle that has an event store registers it with the library's own derived-state orchestrator,
 * so `deleteSubject` clears the subject's stored events without the app wrapping an invalidator by
 * hand. An invalidator built with `createRecommendationCandidateEventDeletionInvalidator` is marked
 * here too, so the orchestrator can skip a store the app already wrapped.
 */
import { getSharedRecommendationKeyedSerializer } from "./keyed-serializer.js";

/** The one method this module needs. Kept structural so this file does not import the store module. */
interface DeletableStore {
  delete(subjectId: string): Promise<void>;
}

const registeredStores = new WeakMap<object, Set<DeletableStore>>();
const markedInvalidators = new WeakMap<object, DeletableStore>();

/**
 * Deletes one subject's stored events through the same per-subject queue the lifecycle saves through,
 * so a save already in flight finishes first and is then cleared.
 */
export function deleteStoredRecommendationCandidateEvents(store: DeletableStore, subjectId: string): Promise<void> {
  return getSharedRecommendationKeyedSerializer(store).run(subjectId, () => store.delete(subjectId));
}

export function markRecommendationCandidateEventDeletionInvalidator(invalidator: object, store: DeletableStore): void {
  markedInvalidators.set(invalidator, store);
}

/** The store an invalidator clears on deletion, when it was built by the library's helper. */
export function recommendationCandidateEventDeletionInvalidatorStore(invalidator: unknown): DeletableStore | undefined {
  return invalidator !== null && typeof invalidator === "object" ? markedInvalidators.get(invalidator) : undefined;
}

/** Adds a store to the set the orchestrator `owner` clears on deletion. Registering twice is a no-op. */
export function registerRecommendationCandidateEventStoreForDeletion(owner: object, store: DeletableStore): void {
  let stores = registeredStores.get(owner);
  if (stores === undefined) {
    stores = new Set();
    registeredStores.set(owner, stores);
  }
  stores.add(store);
}

export function registeredRecommendationCandidateEventStores(owner: object): readonly DeletableStore[] {
  const stores = registeredStores.get(owner);
  return stores === undefined ? [] : [...stores];
}
