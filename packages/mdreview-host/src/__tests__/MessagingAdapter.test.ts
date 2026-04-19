import { describe, expect, it } from "vitest";

import { T3NullMessagingAdapter } from "../MessagingAdapter.ts";

describe("T3NullMessagingAdapter", () => {
  it("send resolves with undefined and does not throw", async () => {
    const adapter = new T3NullMessagingAdapter();
    const result = await adapter.send({ type: "any.message", payload: 1 });
    expect(result).toBeUndefined();
  });

  it("send never rejects even for malformed envelopes", async () => {
    const adapter = new T3NullMessagingAdapter();
    const result = await adapter.send({
      type: "",
      payload: Symbol("weird"),
    });
    expect(result).toBeUndefined();
  });

  it("send returns a Promise (so await / .then() both work)", () => {
    const adapter = new T3NullMessagingAdapter();
    const ret = adapter.send({ type: "x" });
    expect(ret).toBeInstanceOf(Promise);
  });
});
