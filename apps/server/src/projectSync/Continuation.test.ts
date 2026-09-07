import { expect, it } from "vite-plus/test";
import { continuationInput } from "./Continuation.ts";

it("gives a new provider session the imported history without resending it to an existing session", () => {
  const messages = [
    { role: "user" as const, text: "Use the red theme", attachments: [] },
    { role: "assistant" as const, text: "I changed the theme to red", attachments: [] },
  ];
  expect(continuationInput(messages, "Now make the heading larger", true)).toContain(
    "Use the red theme",
  );
  expect(continuationInput(messages, "Now make the heading larger", true)).toContain(
    "I changed the theme to red",
  );
  expect(continuationInput(messages, "Now make the heading larger", true)).toContain(
    "Now make the heading larger",
  );
  expect(continuationInput(messages, "Next change", false)).toBe("Next change");
});
