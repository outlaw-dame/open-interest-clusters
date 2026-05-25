import test from "node:test";
import assert from "node:assert/strict";

import { mapAtprotoProviderRecordToNormalizedEvent } from "../src/index.js";

const observedAt = "2026-05-25T18:00:00.000Z";

function mapPost(overrides: Partial<Parameters<typeof mapAtprotoProviderRecordToNormalizedEvent>[0]> = {}) {
  return mapAtprotoProviderRecordToNormalizedEvent({
    operation: "create",
    repositoryDid: "did:plc:alice123",
    collection: "app.bsky.feed.post",
    rkey: "post1",
    observedAt,
    record: {
      text: "hello",
      createdAt: "2026-05-25T17:59:00.000Z"
    },
    ...overrides
  });
}

test("ATProto provider records accept explicit AT URIs that match the DID, collection, and rkey tuple", () => {
  const event = mapPost({ atUri: "at://did:plc:alice123/app.bsky.feed.post/post1" });

  assert.equal(event.repositoryDid, "did:plc:alice123");
  assert.equal(event.collection, "app.bsky.feed.post");
  assert.equal(event.rkey, "post1");
  assert.equal(event.atUri, "at://did:plc:alice123/app.bsky.feed.post/post1");
});

test("ATProto provider records accept explicit AT URIs whose handle authority matches the provider handle", () => {
  const event = mapPost({
    handle: "Alice.Example.COM",
    atUri: "at://Alice.Example.COM/app.bsky.feed.post/post1"
  });

  assert.equal(event.handle, "alice.example.com");
  assert.equal(event.atUri, "at://Alice.Example.COM/app.bsky.feed.post/post1");
});

test("ATProto provider records reject handle-authority AT URIs without a matching provider handle", () => {
  assert.throws(
    () => mapPost({ atUri: "at://alice.example.com/app.bsky.feed.post/post1" }),
    /repository mismatch/u
  );

  assert.throws(
    () => mapPost({ handle: "mallory.example.com", atUri: "at://alice.example.com/app.bsky.feed.post/post1" }),
    /repository mismatch/u
  );
});

test("ATProto provider records can derive rkey from a matching explicit AT URI", () => {
  const event = mapAtprotoProviderRecordToNormalizedEvent({
    operation: "create",
    repositoryDid: "did:plc:alice123",
    collection: "app.bsky.feed.post",
    observedAt,
    atUri: "at://did:plc:alice123/app.bsky.feed.post/post-from-uri",
    record: {
      text: "hello",
      createdAt: "2026-05-25T17:59:00.000Z"
    }
  });

  assert.equal(event.rkey, "post-from-uri");
  assert.equal(event.atUri, "at://did:plc:alice123/app.bsky.feed.post/post-from-uri");
});

test("ATProto provider records accept spec-valid percent record keys", () => {
  const event = mapPost({ rkey: "post%3A1" });

  assert.equal(event.rkey, "post%3A1");
  assert.equal(event.atUri, "at://did:plc:alice123/app.bsky.feed.post/post%3A1");
});

test("ATProto provider records accept mixed-case handle authorities in subject AT URIs", () => {
  const like = mapAtprotoProviderRecordToNormalizedEvent({
    operation: "create",
    repositoryDid: "did:plc:alice123",
    collection: "app.bsky.feed.like",
    rkey: "like1",
    observedAt,
    record: {
      subject: {
        uri: "at://Alice.Example.COM/app.bsky.feed.post/post1",
        cid: "bafyreibob"
      }
    }
  });

  assert.equal(like.subjectAtUri, "at://Alice.Example.COM/app.bsky.feed.post/post1");
});

test("ATProto provider records accept AT URI collections with hyphenated final NSID segments", () => {
  const event = mapAtprotoProviderRecordToNormalizedEvent({
    operation: "create",
    repositoryDid: "did:plc:alice123",
    collection: "app.bsky.feed.like",
    rkey: "like-with-hyphenated-collection-subject",
    observedAt,
    record: {
      subject: {
        uri: "at://did:plc:bob456/com.example.my-cool-record/rkey1",
        cid: "bafyreibob"
      }
    }
  });

  assert.equal(event.subjectAtUri, "at://did:plc:bob456/com.example.my-cool-record/rkey1");
});

test("ATProto provider records reject malformed repository DIDs", () => {
  assert.throws(
    () => mapPost({ repositoryDid: "DID:plc:alice123" }),
    /repository DID/u
  );

  assert.throws(
    () => mapPost({ repositoryDid: "did:m123:alice" }),
    /repository DID/u
  );

  assert.throws(
    () => mapPost({ repositoryDid: "did:plc:alice/evil" }),
    /repository DID/u
  );
});

test("ATProto provider records reject malformed record keys", () => {
  assert.throws(() => mapPost({ rkey: "." }), /record key/u);
  assert.throws(() => mapPost({ rkey: ".." }), /record key/u);
  assert.throws(() => mapPost({ rkey: "post/evil" }), /record key/u);
  assert.throws(() => mapPost({ rkey: "post?evil" }), /record key/u);
});

test("ATProto provider records reject malformed explicit AT URIs", () => {
  assert.throws(() => mapPost({ atUri: "https://did:plc:alice123/app.bsky.feed.post/post1" }), /AT URI/u);
  assert.throws(() => mapPost({ atUri: "at://did:plc:alice123/app.bsky.feed.post/post1?x=1" }), /AT URI/u);
  assert.throws(() => mapPost({ atUri: "at://did:plc:alice123/app.bsky.feed.post/post1#fragment" }), /AT URI/u);
  assert.throws(() => mapPost({ atUri: "at://did:plc:alice123/app.bsky.feed.post/post1/extra" }), /AT URI/u);
  assert.throws(() => mapPost({ atUri: "at://@alice.example.com/app.bsky.feed.post/post1" }), /AT URI/u);
});

test("ATProto provider records reject explicit AT URI tuple mismatches", () => {
  assert.throws(
    () => mapPost({ atUri: "at://did:plc:bob456/app.bsky.feed.post/post1" }),
    /repository mismatch/u
  );

  assert.throws(
    () => mapPost({ atUri: "at://did:plc:alice123/app.bsky.actor.profile/post1" }),
    /collection mismatch/u
  );

  assert.throws(
    () => mapPost({ atUri: "at://did:plc:alice123/app.bsky.feed.post/post2" }),
    /record key mismatch/u
  );
});

test("ATProto provider records validate feed and graph subjects strictly", () => {
  const like = mapAtprotoProviderRecordToNormalizedEvent({
    operation: "create",
    repositoryDid: "did:plc:alice123",
    collection: "app.bsky.feed.like",
    rkey: "like1",
    observedAt,
    record: {
      subject: {
        uri: "at://did:plc:bob456/app.bsky.feed.post/post1",
        cid: "bafyreibob"
      }
    }
  });
  assert.equal(like.subjectAtUri, "at://did:plc:bob456/app.bsky.feed.post/post1");

  assert.throws(
    () =>
      mapAtprotoProviderRecordToNormalizedEvent({
        operation: "create",
        repositoryDid: "did:plc:alice123",
        collection: "app.bsky.feed.like",
        rkey: "like2",
        observedAt,
        record: {
          subject: {
            uri: "at://did:plc:bob456/app.bsky.feed.post/post1?x=1"
          }
        }
      }),
    /subject URI/u
  );

  const follow = mapAtprotoProviderRecordToNormalizedEvent({
    operation: "create",
    repositoryDid: "did:plc:alice123",
    collection: "app.bsky.graph.follow",
    rkey: "follow1",
    observedAt,
    record: { subject: "did:plc:bob456" }
  });
  assert.equal(follow.subjectDid, "did:plc:bob456");

  assert.throws(
    () =>
      mapAtprotoProviderRecordToNormalizedEvent({
        operation: "create",
        repositoryDid: "did:plc:alice123",
        collection: "app.bsky.graph.follow",
        rkey: "follow2",
        observedAt,
        record: { subject: "DID:plc:bob456" }
      }),
    /graph subject/u
  );
});

test("ATProto provider handles are normalized and invalid handles are rejected", () => {
  const event = mapPost({ handle: "Alice.Example.COM" });
  assert.equal(event.handle, "alice.example.com");

  assert.throws(() => mapPost({ handle: "alice" }), /handle/u);
  assert.throws(() => mapPost({ handle: "alice..example.com" }), /handle/u);
  assert.throws(() => mapPost({ handle: "alice.example.123" }), /handle/u);
  assert.throws(() => mapPost({ handle: "alice:3000.example.com" }), /handle/u);
});
