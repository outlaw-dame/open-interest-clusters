import type { EntityExtractor, EntityLinker, LinkedEntity } from "./types.js";

export interface EntityPipelineOptions {
  extractor: EntityExtractor;
  linker?: EntityLinker;
}

export async function extractAndLinkEntities(
  text: string,
  options: EntityPipelineOptions
): Promise<LinkedEntity[]> {
  const extracted = options.extractor.extract(text);

  if (!options.linker) return extracted;

  return options.linker.link(extracted);
}
