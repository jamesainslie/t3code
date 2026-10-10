// @effect-diagnostics nodeBuiltinImport:off - Drives the real shell installer through a PTY and a gated HTTP fixture.
import { HostProcessArchitecture, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

// Fork: a release after the Lathe rename publishes each archive as lathe-* and
// t3-*, holding `lathe` and `t3`; one from before it has only t3-* holding
// `t3`. The real installer runs without a terminal against each. Executables
// name themselves, and the current release's t3-* asset is a pre-rename
// archive, so the output shows which asset and executable the installer chose.
describe.skipIf(HostProcessPlatform.defaultValue() === "win32")("installer archive names", () => {
  const host = HostProcessPlatform.defaultValue() === "darwin" ? "darwin" : "linux";
  const key = `${host}-${HostProcessArchitecture.defaultValue()}`;
  const version = "1.2.3";

  const pack = async (root: string, name: string, executables: Record<string, string>) => {
    const stage = NodePath.join(root, `stage-${name}`);
    const stem = `t3-${version}-${key}`;
    await NodeFSP.mkdir(NodePath.join(stage, stem), { recursive: true });
    for (const [file, output] of Object.entries(executables)) {
      await NodeFSP.writeFile(NodePath.join(stage, stem, file), `#!/bin/sh\necho '${output}'\n`, {
        mode: 0o755,
      });
    }
    NodeChildProcess.execFileSync("tar", ["-czf", NodePath.join(root, name), "-C", stage, stem]);
    return NodeFSP.readFile(NodePath.join(root, name));
  };

  it.each([
    ["a current release", true, "lathe v1.2.3", "lathe"],
    ["a release from before the rename", false, "t3 v1.2.3", "t3"],
  ] as const)("installs from %s", async (_, current, expectedOutput, linkedName) => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-install-names-"));
    const assets = new Map<string, Buffer>();
    assets.set(`t3-${version}-${key}.tar.gz`, await pack(root, "legacy", { t3: "t3 v1.2.3" }));
    if (current) {
      assets.set(
        `lathe-${version}-${key}.tar.gz`,
        await pack(root, "current", { lathe: "lathe v1.2.3", t3: "alias t3 v1.2.3" }),
      );
    }
    const sums = [...assets]
      .map(
        ([name, bytes]) =>
          `${NodeCrypto.createHash("sha256").update(bytes).digest("hex")}  ${name}\n`,
      )
      .join("");
    const requested: string[] = [];
    const server = NodeHttp.createServer((request, response) => {
      const name = request.url?.split("/").at(-1) ?? "";
      requested.push(name);
      const body = name === "SHA256SUMS" ? Buffer.from(sums) : assets.get(name);
      if (body === undefined) response.writeHead(404).end();
      else response.writeHead(200, { "Content-Length": body.length }).end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
    try {
      const child = NodeChildProcess.spawn(
        "sh",
        [NodePath.resolve(import.meta.dirname, "install.sh")],
        {
          env: {
            ...process.env,
            NO_COLOR: "1",
            T3CODE_VERSION: version,
            T3CODE_HOME: NodePath.join(root, "home"),
            T3CODE_INSTALL_BIN_DIR: NodePath.join(root, "bin"),
            T3CODE_RELEASE_BASE_URL: `http://127.0.0.1:${address.port}`,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
      const code = await new Promise<number | null>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", resolve);
      });
      expect(code, output).toBe(0);
      expect(requested).toEqual([
        "SHA256SUMS",
        `${current ? "lathe" : "t3"}-${version}-${key}.tar.gz`,
      ]);
      const launcher = NodePath.join(root, "bin/lathe");
      expect(NodePath.basename(await NodeFSP.readlink(launcher))).toBe(linkedName);
      expect(
        NodeChildProcess.execFileSync(launcher, ["--version"], { encoding: "utf8" }).trim(),
      ).toBe(expectedOutput);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });
});

// util-linux's script gives the real installer a terminal without a browser or extra packages.
describe.skipIf(HostProcessPlatform.defaultValue() !== "linux")("installer terminal", () => {
  it.each([false, true])(
    "preserves download and install behavior (HTTP failure: %s)",
    async (fail) => {
      const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-install-progress-"));
      const version = "1.2.3";
      const stem = `t3-${version}-linux-${HostProcessArchitecture.defaultValue()}`;
      const archiveName = `${stem}.tar.gz`;
      let resumeDownload: (() => void) | undefined;
      let sawPartialProgress = false;
      let output = "";
      await NodeFSP.mkdir(NodePath.join(root, stem));
      await NodeFSP.writeFile(NodePath.join(root, stem, "t3"), "#!/bin/sh\necho 't3 v1.2.3'\n", {
        mode: 0o755,
      });
      await NodeFSP.writeFile(
        NodePath.join(root, stem, "payload"),
        NodeCrypto.randomBytes(64 * 1024),
      );
      NodeChildProcess.execFileSync("tar", [
        "-czf",
        NodePath.join(root, archiveName),
        "-C",
        root,
        stem,
      ]);
      const archive = await NodeFSP.readFile(NodePath.join(root, archiveName));
      const checksum = NodeCrypto.createHash("sha256").update(archive).digest("hex");
      const server = NodeHttp.createServer((request, response) => {
        if (request.url?.endsWith("/SHA256SUMS")) {
          response.end(`${checksum}  ${archiveName}\n`);
        } else if (fail) {
          response.writeHead(500).end();
        } else {
          response.writeHead(200, { "Content-Length": archive.length });
          resumeDownload = () => response.end(archive.subarray(Math.floor(archive.length / 2)));
          response.write(archive.subarray(0, Math.floor(archive.length / 2)));
        }
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
      const installer = NodePath.resolve(import.meta.dirname, "install.sh").replaceAll(
        "'",
        "'\\''",
      );
      const child = NodeChildProcess.spawn("script", ["-qec", `sh '${installer}'`, "/dev/null"], {
        env: {
          ...process.env,
          TERM: "xterm",
          NO_COLOR: "1",
          T3CODE_VERSION: version,
          T3CODE_HOME: NodePath.join(root, "home"),
          T3CODE_INSTALL_BIN_DIR: NodePath.join(root, "bin"),
          T3CODE_RELEASE_BASE_URL: `http://127.0.0.1:${address.port}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const collect = (chunk: Buffer) => {
        output += chunk.toString();
        if (!sawPartialProgress && /\b[1-9]\d?%/.test(output)) {
          sawPartialProgress = true;
          resumeDownload?.();
        }
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      try {
        const code = await new Promise<number | null>((resolve, reject) => {
          child.on("error", reject);
          child.on("close", resolve);
        });
        const versions = NodePath.join(root, "home/runtime/versions");
        if (fail) {
          expect(code).not.toBe(0);
          expect(output).toContain("500");
          expect(output).not.toContain("100%");
          expect(output).not.toContain("Installed Lathe");
          expect(await NodeFSP.readdir(versions)).toEqual([]);
        } else {
          expect(code).toBe(0);
          expect(sawPartialProgress).toBe(true);
          expect(output).toContain("100%");
          expect(output).toContain("0.1 / 0.1 MB");
          expect(output).toContain("Installed Lathe 1.2.3");
          expect(
            await NodeFSP.readFile(NodePath.join(versions, version, ".install-complete"), "utf8"),
          ).toBe("1.2.3\n");
          expect(
            NodeChildProcess.execFileSync(NodePath.join(root, "bin/lathe"), ["--version"], {
              encoding: "utf8",
            }).trim(),
          ).toBe("t3 v1.2.3");
          expect(await NodeFSP.readdir(versions)).toEqual([version]);
        }
      } finally {
        if (child.exitCode === null) child.kill();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await NodeFSP.rm(root, { recursive: true, force: true });
      }
    },
  );
});
