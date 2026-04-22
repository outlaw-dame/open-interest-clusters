import type { EntityExtractor, ExtractedEntity } from "./types.js";

export class SimpleEntityExtractor implements EntityExtractor {
  extract(text: string): ExtractedEntity[] {
    if (!text) return [];

    const tokens = text.split(/\s+/);
    const results: ExtractedEntity[] = [];
    let buffer: string[] = [];

    for (const token of tokens) {
      const clean = token.replace(/[^a-zA-Z0-9]/g, "");
      if (!clean) continue;

      const isCapitalized = clean[0] === clean[0].toUpperCase();

      if (isCapitalized && clean.length >= 3) {
        buffer.push(clean);
      } else {
        if (buffer.length > 0) {
          results.push(this.build(buffer));
          buffer = [];
        }
      }
    }

    if (buffer.length > 0) {
      results.push(this.build(buffer));
    }

    return results;
  }

  private build(words: string[]): ExtractedEntity {
    const label = words.join(" ");
    return {
      label,
      normalized: label.toLowerCase()
    };
  }
}
