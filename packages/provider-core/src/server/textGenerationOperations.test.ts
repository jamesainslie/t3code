import { assert, describe, it } from "@effect/vitest";
import { ProviderInstanceId, TextGenerationError } from "@lathe/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  decodeJsonReply,
  fromRunner,
  type Request,
  type Runner,
  withoutInvestigation,
} from "./textGenerationOperations.ts";

const modelSelection = { instanceId: ProviderInstanceId.make("fake"), model: "small" };
const Verdict = Schema.Struct({ ticks: Schema.Array(Schema.String), note: Schema.String });

/** A runner that answers with fixed text, decoded the way the real runners decode it. */
const fakeRunner = (reply: string) => {
  const requests: Array<Request<Schema.Top>> = [];
  const run: Runner = (request) => {
    requests.push(request);
    return decodeJsonReply(request, "Fake", reply);
  };
  return { requests, run };
};

describe("fromRunner generateStructured", () => {
  it.effect("sends the caller's prompt and schema and decodes the answer", () =>
    Effect.gen(function* () {
      const runner = fakeRunner('Here you go: {"ticks":["c1"],"note":"Turn 3 passed"}');
      const generation = fromRunner("Fake", runner.run);

      const verdict = yield* generation.generateStructured({
        cwd: "/work",
        prompt: "Relate the turns to the criteria.",
        outputSchema: Verdict,
        modelSelection,
      });

      assert.deepStrictEqual(verdict, { ticks: ["c1"], note: "Turn 3 passed" });
      assert.strictEqual(runner.requests.length, 1);
      const [request] = runner.requests;
      assert.strictEqual(request!.operation, "generateStructured");
      assert.strictEqual(request!.cwd, "/work");
      assert.strictEqual(request!.prompt, "Relate the turns to the criteria.");
      assert.strictEqual(request!.outputSchema, Verdict);
      assert.deepStrictEqual(request!.modelSelection, modelSelection);
      assert.isUndefined(request!.investigate);
    }),
  );

  it.effect("fails with a TextGenerationError when the answer does not match the schema", () =>
    Effect.gen(function* () {
      const generation = fromRunner("Fake", fakeRunner('{"ticks":"c1"}').run);
      const error = yield* Effect.flip(
        generation.generateStructured({
          cwd: "/work",
          prompt: "Relate the turns to the criteria.",
          outputSchema: Verdict,
          modelSelection,
        }),
      );
      assert.instanceOf(error, TextGenerationError);
      assert.strictEqual(error.operation, "generateStructured");
    }),
  );

  it.effect("runs on providers that cannot investigate, since it reads nothing itself", () =>
    Effect.gen(function* () {
      const runner = fakeRunner('{"ticks":[],"note":""}');
      const generation = fromRunner("Fake", withoutInvestigation("Fake", runner.run));
      const verdict = yield* generation.generateStructured({
        cwd: "/work",
        prompt: "Anything new?",
        outputSchema: Verdict,
        modelSelection,
      });
      assert.deepStrictEqual(verdict, { ticks: [], note: "" });
    }),
  );
});
