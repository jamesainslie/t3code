// @effect-diagnostics nodeBuiltinImport:off - the entry writes straight to process stdout.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NetService from "@t3tools/shared/Net";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestConsole from "effect/testing/TestConsole";
import { CliOutput, Command } from "effect/cli";
import { it } from "@effect/vitest";
import { afterEach, describe, expect, vi } from "vite-plus/test";

import packageJson from "../package.json" with { type: "json" };
import { cli } from "./binCli.ts";
import { cliEntryLoaders, runCliEntry } from "./cliEntry.ts";

const fullCliMustNotLoad = () =>
  vi.fn(async (): Promise<never> => {
    throw new Error("the full CLI was loaded");
  });

const captureStdout = () => vi.spyOn(process.stdout, "write").mockReturnValue(true);

const stdoutText = (spy: ReturnType<typeof captureStdout>) =>
  spy.mock.calls.map(([chunk]) => String(chunk)).join("");

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("runCliEntry", () => {
  it.effect("prints --version exactly as the full CLI does, without loading it", () =>
    Effect.gen(function* () {
      const fullCli = fullCliMustNotLoad();
      const stdout = captureStdout();

      yield* Effect.promise(() =>
        runCliEntry(["--version"], {
          loaders: { ...cliEntryLoaders, fullCli },
          stdoutIsTty: false,
        }),
      );
      const fastOutput = stdoutText(stdout);
      vi.restoreAllMocks();

      const logged = yield* Command.runWith(cli, { version: packageJson.version })([
        "--version",
      ]).pipe(
        Effect.andThen(TestConsole.logLines),
        Effect.provide(
          Layer.mergeAll(
            NodeServices.layer,
            NetService.layer,
            TestConsole.layer,
            // effect/cli only colors a TTY stdout; the launch script captures it.
            CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
          ),
        ),
      );

      expect(fullCli).not.toHaveBeenCalled();
      expect(fastOutput).toBe(`${logged.join("\n")}\n`);
      expect(fastOutput).toMatch(/^lathe v\d/);
    }),
  );

  // A terminal gets effect/cli's colored output, which only the full CLI renders.
  it("leaves --version on a TTY to the full CLI", async () => {
    const runCli = vi.fn();
    const fullCli = vi.fn(async () => ({ runCli }));

    await runCliEntry(["--version"], {
      loaders: { ...cliEntryLoaders, fullCli },
      stdoutIsTty: true,
    });

    expect(fullCli).toHaveBeenCalledOnce();
    expect(runCli).toHaveBeenCalledOnce();
  });

  it("runs runtime-port without loading the full CLI", async () => {
    const fullCli = fullCliMustNotLoad();
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-cli-entry-test-"));
    const runtimeFile = NodePath.join(dir, "runtime.json");
    NodeFS.writeFileSync(
      runtimeFile,
      JSON.stringify({ pid: process.pid, port: 4773, origin: "http://127.0.0.1:4773" }),
    );
    const stdout = captureStdout();

    await runCliEntry(["__ssh-helper", "runtime-port", runtimeFile], {
      loaders: { ...cliEntryLoaders, fullCli },
      stdoutIsTty: false,
    });

    expect(fullCli).not.toHaveBeenCalled();
    expect(stdoutText(stdout)).toBe(`${process.pid} 4773`);
    expect(process.exitCode).toBeUndefined();
  });

  it.effect("matches the full CLI's runtime-port output and exit code", () =>
    Effect.gen(function* () {
      const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-cli-entry-test-"));
      const runtimeFile = NodePath.join(dir, "runtime.json");
      NodeFS.writeFileSync(
        runtimeFile,
        JSON.stringify({ pid: process.pid, port: 4773, origin: "http://localhost:4773" }),
      );
      const runFull = (args: ReadonlyArray<string>) =>
        Command.runWith(cli, { version: packageJson.version })(args).pipe(
          Effect.provide(Layer.mergeAll(NodeServices.layer, NetService.layer, TestConsole.layer)),
        );

      for (const file of [runtimeFile, NodePath.join(dir, "absent.json")]) {
        const args = ["__ssh-helper", "runtime-port", file];
        const fast = captureStdout();
        yield* Effect.promise(() => runCliEntry(args, { stdoutIsTty: false }));
        const fastResult = { stdout: stdoutText(fast), exitCode: process.exitCode };
        vi.restoreAllMocks();
        process.exitCode = undefined;

        const full = captureStdout();
        yield* runFull(args);
        const fullResult = { stdout: stdoutText(full), exitCode: process.exitCode };
        vi.restoreAllMocks();
        process.exitCode = undefined;

        expect(fastResult).toEqual(fullResult);
      }
    }),
  );

  it("exits 1 with no output for a bad runtime file", async () => {
    const fullCli = fullCliMustNotLoad();
    const stdout = captureStdout();

    await runCliEntry(["__ssh-helper", "runtime-port", "/nonexistent/runtime.json"], {
      loaders: { ...cliEntryLoaders, fullCli },
      stdoutIsTty: false,
    });

    expect(fullCli).not.toHaveBeenCalled();
    expect(stdoutText(stdout)).toBe("");
    expect(process.exitCode).toBe(1);
  });

  it("hands malformed helper arguments to the full CLI", async () => {
    const runCli = vi.fn();
    const fullCli = vi.fn(async () => ({ runCli }));

    await runCliEntry(["__ssh-helper", "wait-ready", "not-a-port", "1", "1"], {
      loaders: { ...cliEntryLoaders, fullCli },
      stdoutIsTty: false,
    });

    expect(runCli).toHaveBeenCalledOnce();
  });

  it("hands every other command to the full CLI", async () => {
    const runCli = vi.fn();
    const fullCli = vi.fn(async () => ({ runCli }));

    await runCliEntry(["serve", "--version"], {
      loaders: { ...cliEntryLoaders, fullCli },
      stdoutIsTty: false,
    });

    expect(runCli).toHaveBeenCalledOnce();
  });
});
