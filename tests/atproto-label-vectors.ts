// Generated once with @ipld/dag-cbor 9.2.7 and @atproto/crypto 0.5.8 (scratch install, not a dependency).
// cbor is what dag-cbor produced for the label without sig. sig is what the official Keypair.sign
// returned over those bytes, and verifySignature from @atproto/crypto accepted every entry here.
export const KEYS = {
  "secp256k1": "zQ3shRoyxFdysojH6ats8WBoyx6bZ9WTpQTKVKaD8JsP9XrFd",
  "p256": "zDnaeoj8NwyqCrMZTWtWTcvSX62yTVUh5YxDAEPubhuqb8iRb"
} as const;

export interface SignedLabelVector {
  label: Record<string, string | number | boolean>;
  cbor: string;
  sig: string;
}

export const SIGNED_LABELS: Record<"secp256k1" | "p256", SignedLabelVector[]> = {
  "secp256k1": [
    {
      "label": {
        "ver": 1,
        "src": "did:plc:ewvi7nxzyoun6zhxrhs64oiz",
        "uri": "at://did:plc:abcdefghijklmnopqrstuvwx/app.bsky.feed.post/3kabc",
        "cid": "bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5uxgf5kpqcsgz7soitae",
        "val": "spam",
        "neg": false,
        "cts": "2024-01-02T03:04:05.000Z",
        "exp": "2030-01-01T00:00:00.000Z"
      },
      "cbor": "a863636964783b62616679726569623272786b337279626b33616f626d7635636a75716c33626d32747768346a6f3575786766356b70716373677a37736f69746165636374737818323032342d30312d30325430333a30343a30352e3030305a636578707818323033302d30312d30315430303a30303a30302e3030305a636e6567f46373726378206469643a706c633a65777669376e787a796f756e367a687872687336346f697a63757269783e61743a2f2f6469643a706c633a6162636465666768696a6b6c6d6e6f7071727374757677782f6170702e62736b792e666565642e706f73742f336b6162636376616c647370616d6376657201",
      "sig": "I9J5E3bfHJ/9pNSzI260e6VrMrpZCBllnnbWDUYQemUFts/8iJ7QoR8tnTT/qilHffhG9IVdCPyAQcXc422Q/g=="
    },
    {
      "label": {
        "ver": 1,
        "src": "did:plc:ewvi7nxzyoun6zhxrhs64oiz",
        "uri": "did:plc:abcdefghijklmnopqrstuvwx",
        "val": "!hide",
        "cts": "2024-01-02T03:04:05.000Z"
      },
      "cbor": "a5636374737818323032342d30312d30325430333a30343a30352e3030305a6373726378206469643a706c633a65777669376e787a796f756e367a687872687336346f697a6375726978206469643a706c633a6162636465666768696a6b6c6d6e6f7071727374757677786376616c6521686964656376657201",
      "sig": "0rsEugV3Lp4JyuAa9GOvD1i2MuTgWQzqItJHN0K1GiJiPP3Nojdgd7rsDPMXiPltJJT4R8mmOQHIUnLtOxw8BA=="
    },
    {
      "label": {
        "ver": 1,
        "src": "did:plc:ewvi7nxzyoun6zhxrhs64oiz",
        "uri": "did:plc:abcdefghijklmnopqrstuvwx",
        "val": "café-😀",
        "neg": true,
        "cts": "2024-01-02T03:04:05.000Z"
      },
      "cbor": "a6636374737818323032342d30312d30325430333a30343a30352e3030305a636e6567f56373726378206469643a706c633a65777669376e787a796f756e367a687872687336346f697a6375726978206469643a706c633a6162636465666768696a6b6c6d6e6f7071727374757677786376616c6a636166c3a92df09f98806376657201",
      "sig": "9odH+7/x/ZiFy7zUWdZMgK3urfUKR5TMSepa6jLyXyBb59KP9IcWXkC0uIug9+tbD32WBViELIGEbCHbuWvIQQ=="
    }
  ],
  "p256": [
    {
      "label": {
        "ver": 1,
        "src": "did:plc:ewvi7nxzyoun6zhxrhs64oiz",
        "uri": "at://did:plc:abcdefghijklmnopqrstuvwx/app.bsky.feed.post/3kabc",
        "cid": "bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5uxgf5kpqcsgz7soitae",
        "val": "spam",
        "neg": false,
        "cts": "2024-01-02T03:04:05.000Z",
        "exp": "2030-01-01T00:00:00.000Z"
      },
      "cbor": "a863636964783b62616679726569623272786b337279626b33616f626d7635636a75716c33626d32747768346a6f3575786766356b70716373677a37736f69746165636374737818323032342d30312d30325430333a30343a30352e3030305a636578707818323033302d30312d30315430303a30303a30302e3030305a636e6567f46373726378206469643a706c633a65777669376e787a796f756e367a687872687336346f697a63757269783e61743a2f2f6469643a706c633a6162636465666768696a6b6c6d6e6f7071727374757677782f6170702e62736b792e666565642e706f73742f336b6162636376616c647370616d6376657201",
      "sig": "WgrfOPLbBd79iJ5sSxehQheXD4XsrGZE4bb7bsMw7qtMHrNvS/U9kNgGLzwDneXlAfoBL0Z0aSoJfm0gETnZEg=="
    },
    {
      "label": {
        "ver": 1,
        "src": "did:plc:ewvi7nxzyoun6zhxrhs64oiz",
        "uri": "did:plc:abcdefghijklmnopqrstuvwx",
        "val": "!hide",
        "cts": "2024-01-02T03:04:05.000Z"
      },
      "cbor": "a5636374737818323032342d30312d30325430333a30343a30352e3030305a6373726378206469643a706c633a65777669376e787a796f756e367a687872687336346f697a6375726978206469643a706c633a6162636465666768696a6b6c6d6e6f7071727374757677786376616c6521686964656376657201",
      "sig": "Nfp0e9me08Yb6zCA5bGK4O5OLihDjl/OTNuhJtwqAbcDNWMszphpKV92L4l2AlOeSuI/vUXUxcpMO3NxLUO7WQ=="
    },
    {
      "label": {
        "ver": 1,
        "src": "did:plc:ewvi7nxzyoun6zhxrhs64oiz",
        "uri": "did:plc:abcdefghijklmnopqrstuvwx",
        "val": "café-😀",
        "neg": true,
        "cts": "2024-01-02T03:04:05.000Z"
      },
      "cbor": "a6636374737818323032342d30312d30325430333a30343a30352e3030305a636e6567f56373726378206469643a706c633a65777669376e787a796f756e367a687872687336346f697a6375726978206469643a706c633a6162636465666768696a6b6c6d6e6f7071727374757677786376616c6a636166c3a92df09f98806376657201",
      "sig": "izWILaiwKgfDsOPggBhzd24rbyNiXXKXl6qrw6HWbsFIxzpakWNGtNIuA1VKnRgStXwRntdGtYxqOGAcYDof+w=="
    }
  ]
};

export const INTEGER_VECTORS: Array<{ v: number; cbor: string }> = [
  {
    "v": 0,
    "cbor": "a16376657200"
  },
  {
    "v": 1,
    "cbor": "a16376657201"
  },
  {
    "v": 23,
    "cbor": "a16376657217"
  },
  {
    "v": 24,
    "cbor": "a1637665721818"
  },
  {
    "v": 255,
    "cbor": "a16376657218ff"
  },
  {
    "v": 256,
    "cbor": "a163766572190100"
  },
  {
    "v": 65535,
    "cbor": "a16376657219ffff"
  },
  {
    "v": 65536,
    "cbor": "a1637665721a00010000"
  },
  {
    "v": 4294967295,
    "cbor": "a1637665721affffffff"
  }
];

export const STRING_VECTORS: Array<{ s: string; cbor: string }> = [
  {
    "s": "",
    "cbor": "a16376616c60"
  },
  {
    "s": "a",
    "cbor": "a16376616c6161"
  },
  {
    "s": "xxxxxxxxxxxxxxxxxxxxxxx",
    "cbor": "a16376616c777878787878787878787878787878787878787878787878"
  },
  {
    "s": "xxxxxxxxxxxxxxxxxxxxxxxx",
    "cbor": "a16376616c7818787878787878787878787878787878787878787878787878"
  },
  {
    "s": "é中😀",
    "cbor": "a16376616c69c3a9e4b8adf09f9880"
  }
];

// Long strings: the value is the letter x repeated, so only the map and string header is listed.
export const REPEATED_STRING_VECTORS: Array<{ repeat: number; head: string }> = [
  {
    "repeat": 255,
    "head": "a16376616c78ff"
  },
  {
    "repeat": 256,
    "head": "a16376616c790100"
  }
];
