# Reference onboarding examples

These files show how an app can wire the engine into a first-run onboarding flow. They are not a UI, not a template and not a recommendation of any provider. Everything runs in memory against fakes, so nothing here touches the network or the disk.

They are not part of the npm package. `package.json` lists `!dist/examples` in `files`, and a test checks the pack output.

| File | What it shows |
| --- | --- |
| `fakes.ts` | A clock you move by hand, a fake provider that records every request, a fake candidate source and account lookup, and an in-memory profile store with a device manifest and a pod manifest. |
| `view-models.ts` | Plain-data view models: the reason for a suggestion, the evidence label, the empty and partial states, and the plan summary. All wording is in tables at the top of the file. |
| `onboarding-flow.ts` | `createReferenceOnboarding`: select, recommend, plan, confirm, edit, withdraw, report a set change, delete. |
| `device-to-pod.ts` | Moving the stored profile between the device and a user-owned pod, and checking whether a store may hold it at all. |

The tests are `tests/phase8-reference-*.test.ts`. They run with `pnpm test`, which is what keeps these files from going stale.

## Rules the examples follow

- They import only `../src/index.js`, the same surface a package consumer gets. A test fails on any other import from `src/`.
- They add no dependency and use no DOM or UI framework.
- Nothing follows, subscribes or joins by itself. `confirm` is the only call that reaches a provider, it needs `confirmed: true`, and it checks the plan, the account and the provider's capabilities again first.
- No request to a provider carries profile or signal content. The privacy test records what the fakes receive and checks it.

## What is guidance only

IndexedDB and SQLite stores are not implemented. The in-memory adapter stands in for them, and the shape a real one should have is written up in `docs/phase8-reference-onboarding.md`. The pod example uses a second in-memory adapter, not a live ActivityPods server.

## Where the public API was awkward

Listed at the end of `docs/phase8-reference-onboarding.md`.
