# Open Interest Clusters

Portable schema, starter dataset, validation, normalization, and runtime helpers for canonical hashtag interest clusters.

## What this repo contains

- A strict JSON Schema for interest-cluster datasets
- A starter global dataset
- TypeScript runtime helpers for:
  - strict dataset validation
  - Unicode + hashtag normalization
  - immutable dataset loading
  - remote dataset fetch with ETag support and bounded exponential backoff
- Minimal scripts for validation and normalization
- Tests for normalization, validation, and loader behavior

## Install

```bash
npm install
```

## Validate the starter dataset

```bash
npm run validate:dataset
```

## Build

```bash
npm run build
```
