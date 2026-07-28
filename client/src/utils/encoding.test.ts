import { describe, expect, it } from "vitest";

import { arrayBufferToBase64, base64ToArray } from "./encoding";

describe("arrayBufferToBase64", () => {
  it("encodes bytes the same way the server's base64 decoder expects", () => {
    const buffer = new Uint8Array([104, 101, 108, 108, 111]).buffer;

    expect(arrayBufferToBase64(buffer)).toBe("aGVsbG8=");
  });

  it("encodes an empty buffer to an empty string", () => {
    expect(arrayBufferToBase64(new ArrayBuffer(0))).toBe("");
  });

  it("encodes raw PCM bytes above the ASCII range without corruption", () => {
    // 16-bit PCM samples routinely contain bytes >= 0x80. A naive
    // String.fromCharCode(...bytes) over a UTF-8 decoded string would mangle
    // these, so assert the full byte range survives a round trip.
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;

    const decoded = base64ToArray(arrayBufferToBase64(bytes.buffer));

    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });

  it("handles a buffer large enough to exercise the loop", () => {
    const bytes = new Uint8Array(4096).fill(0xab);

    const decoded = base64ToArray(arrayBufferToBase64(bytes.buffer));

    expect(decoded.length).toBe(4096);
    expect(decoded.every((byte) => byte === 0xab)).toBe(true);
  });
});

describe("base64ToArray", () => {
  it("decodes base64 audio from the server into a Uint8Array", () => {
    const decoded = base64ToArray("aGVsbG8=");

    expect(decoded).toBeInstanceOf(Uint8Array);
    expect(Array.from(decoded)).toEqual([104, 101, 108, 108, 111]);
  });

  it("decodes an empty string to an empty array", () => {
    expect(base64ToArray("").length).toBe(0);
  });

  it("returns a Uint8Array whose buffer can be transferred to the audio worklet", () => {
    // useLiveConnection posts `bytes.buffer` as a transferable, which requires
    // the view to own its whole buffer.
    const decoded = base64ToArray("aGVsbG8=");

    expect(decoded.byteOffset).toBe(0);
    expect(decoded.buffer.byteLength).toBe(decoded.length);
  });
});
