export interface InterestClusterDataset {
    schema_version: string;
    dataset_id: string;
    dataset_version: string;
    locale_default: string;
    normalization: NormalizationSettings;
    clusters: InterestCluster[];
}
export interface NormalizationSettings {
    unicode_form: "NFC" | "NFD" | "NFKC" | "NFKD";
    casefold: boolean;
    strip_leading_hash_for_storage: boolean;
}
export interface InterestCluster {
    id: string;
    status: "active" | "deprecated" | "experimental";
    display: DisplayInfo;
    anchor: Anchor;
    follow_behavior: FollowBehavior;
    taxonomy: Taxonomy;
    hashtags: HashtagGroups;
    keywords: KeywordGroups;
    entities?: Entities;
    multilingual?: Multilingual;
    retrieval?: Retrieval;
    ranking_hints?: RankingHints;
    privacy: Privacy;
    sources: SourceMetadata;
}
export interface DisplayInfo {
    label: string;
    short_description?: string;
    category: string;
    subcategory?: string;
}
export interface Anchor {
    hashtag: string;
    follow_by_default_if_interest_selected: boolean;
}
export interface FollowBehavior {
    mode: "anchor_only" | "anchor_plus_related" | "manual_only";
    allow_user_opt_in_related_hashtags: boolean;
    max_auto_follow_hashtags: number;
}
export interface Taxonomy {
    parent_id?: string;
    primary_subcategories: string[];
    related_cluster_ids?: string[];
}
export interface HashtagGroups {
    anchor: string[];
    aliases: string[];
    adjacent: string[];
    excluded: string[];
}
export interface KeywordGroups {
    high_value: string[];
    secondary: string[];
    negative: string[];
}
export interface EntityReference {
    label: string;
    wikidata_id?: string;
    dbpedia_resource?: string;
    aliases?: string[];
}
export interface Entities {
    brands?: EntityReference[];
    products?: EntityReference[];
    people_or_orgs?: EntityReference[];
    custom?: EntityReference[];
}
export interface LanguageVariant {
    hashtags?: string[];
    keywords?: string[];
}
export interface Multilingual {
    language_variants: Record<string, LanguageVariant>;
    transliteration_enabled: boolean;
    embedding_profile: string;
}
export interface Retrieval {
    expand_hashtags_for_matching: boolean;
    expand_keywords_for_matching: boolean;
    expand_entities_for_matching: boolean;
    allow_embedding_expansion: boolean;
    embedding_only_requires_min_confidence: number;
}
export interface RankingHints {
    freshness_half_life_hours?: number;
    featured_tag_boost?: number;
    pinned_post_keyword_boost?: number;
    profile_bio_keyword_boost?: number;
}
export interface Privacy {
    respect_discoverable_false: boolean;
    respect_indexable_false: boolean;
    exclude_if_profile_or_posts_contain_opt_out_terms: boolean;
    opt_out_terms: string[];
}
export interface SourceMetadata {
    curated_by: string;
    seed_method: string;
    last_reviewed_at: string;
}
