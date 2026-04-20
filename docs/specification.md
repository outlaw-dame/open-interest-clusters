# Specification Notes

## Contract boundaries

This repository defines:
- the portable JSON data contract
- curated datasets
- safe validation and normalization helpers

This repository does **not** define:
- per-user adaptive state
- recommendation weights learned at runtime
- provider-specific indexing state
- mutable live curation in process memory

## Matching model

- `anchor` hashtags are the explicit follow candidates.
- `aliases` are near-equivalent hashtag forms.
- `adjacent` hashtags are retrieval-expansion forms.
- `keywords.high_value` are strong text signals.
- `keywords.secondary` are weaker text signals.
- `keywords.negative` and `hashtags.excluded` are suppression signals.

## Normalization

- Unicode form: NFKC
- casefold-like lowercasing for lookup
- leading `#` stripped for stored hashtag values
- duplicates removed after normalization

## Safety

- Validation fails closed.
- Dataset loading deep-freezes objects to prevent runtime mutation.
- Remote fetch is bounded and uses ETag caching and exponential backoff with jitter.
