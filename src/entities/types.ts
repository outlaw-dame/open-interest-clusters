export interface ExtractedEntity {
  label: string;
  normalized: string;
}

export interface LinkedEntity {
  label: string;
  normalized: string;
  wikidataId?: string;
  dbpediaResource?: string;
}

export interface EntityExtractor {
  extract(text: string): ExtractedEntity[];
}

export interface EntityLinker {
  link(entities: ExtractedEntity[]): Promise<LinkedEntity[]>;
}

export type EntityRelation =
  | "same_as"
  | "instance_of"
  | "subclass_of"
  | "part_of"
  | "manufacturer"
  | "developer"
  | "publisher"
  | "owned_by"
  | "fandom_of"
  | "related_to";

export interface EntityRelationEdge {
  sourceId: string;
  targetId: string;
  relation: EntityRelation;
  weight: number;
}

export interface EntityGraphResolver {
  resolveNeighbors(entityIds: readonly string[]): Promise<EntityRelationEdge[]>;
}

export interface ClusterEntityMatch {
  clusterId: string;
  score: number;
  matchedEntityIds: string[];
  relationHits: EntityRelationEdge[];
}
