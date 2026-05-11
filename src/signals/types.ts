export type NativeProtocol = "activitypub" | "atproto";
export type UpstreamOrigin = NativeProtocol | "nostr" | "unknown";
export type SignalKind = "post" | "profile" | "repost" | "reply" | "quote" | "like" | "follow" | "unknown";
export type SignalVisibility = "public" | "unlisted" | "followers" | "private" | "direct" | "unknown";

export interface SignalEntityReference {
  label: string;
  wikidataId?: string;
  dbpediaResource?: string;
  aliases?: string[];
}

export interface SignalFacetLink {
  url: string;
  title?: string;
  domain?: string;
}

export interface UnifiedSignal {
  id: string;
  canonicalUrl?: string;
  kind: SignalKind;
  nativeProtocol: NativeProtocol;
  upstreamOrigin?: UpstreamOrigin;
  sourceHint?: string;
  authorId: string;
  authorHandle?: string;
  authorDisplayName?: string;
  text: string;
  language?: string;
  hashtags: string[];
  keywords: string[];
  entities: SignalEntityReference[];
  links: SignalFacetLink[];
  createdAt: string;
  visibility: SignalVisibility;
  indexable?: boolean;
  discoverableAuthor?: boolean;
  replyToId?: string;
  quoteOfId?: string;
  repostOfId?: string;
  rawTagStrings?: string[];
  rawMentions?: string[];
  rawProtocolMetadata?: Record<string, unknown>;
}
