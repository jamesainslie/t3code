// @effect-diagnostics nodeBuiltinImport:off - reads the real exception files from the checkout.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { FORK_IDENTITY } from "@t3tools/shared/forkIdentity";
import { describe, expect, it } from "vite-plus/test";

import {
  FORK_BRAND_EXCEPTIONS,
  FORK_BRAND_SUBSTITUTIONS,
  FORK_BRAND_TOKEN,
  FORK_TRIAGE_PLAYBOOK_PATH,
  FORK_TRIAGE_PLAYBOOK_URL,
  forkTriagePlaybook,
  isBrandableModule,
  rebrandSource,
  rebrandText,
  type SourceMapV3,
} from "./forkBrand.ts";

const repoRoot = NodePath.resolve(import.meta.dirname, "..", "..");
const brand = FORK_IDENTITY.productBaseName;
const moduleId = (relativePath: string) => NodePath.join(repoRoot, relativePath);
const webModule = moduleId("apps/web/src/components/Example.tsx");
const serverModule = moduleId("apps/server/src/example.ts");
const readRepoFile = (relativePath: string) =>
  NodeFS.readFileSync(NodePath.join(repoRoot, relativePath), "utf8");

/** Decodes a v3 `mappings` string into [generatedColumn, originalLine, originalColumn] per line. */
const decodeMappings = (mappings: string) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let originalLine = 0;
  let originalColumn = 0;
  return mappings.split(";").map((line) => {
    let generatedColumn = 0;
    return line
      .split(",")
      .filter((segment) => segment.length > 0)
      .map((segment) => {
        const values: Array<number> = [];
        let value = 0;
        let shift = 0;
        for (const char of segment) {
          const digit = alphabet.indexOf(char);
          value += (digit & 31) << shift;
          if (digit & 32) {
            shift += 5;
          } else {
            values.push(value & 1 ? -(value >> 1) : value >> 1);
            value = 0;
            shift = 0;
          }
        }
        generatedColumn += values[0] ?? 0;
        originalLine += values[2] ?? 0;
        originalColumn += values[3] ?? 0;
        return [generatedColumn, originalLine, originalColumn] as const;
      });
  });
};

const originalPositionFor = (map: SourceMapV3, line: number, column: number) => {
  const segments = decodeMappings(map.mappings)[line] ?? [];
  const segment = segments.findLast(([generatedColumn]) => generatedColumn <= column);
  if (!segment) return undefined;
  return { line: segment[1], column: segment[2] + (column - segment[0]) };
};

describe("rebrandSource", () => {
  it("rewrites string literals in either quote style", () => {
    const result = rebrandSource(
      `const a = "Open T3 Code";\nconst b = 'Restart T3 Code.';\n`,
      serverModule,
    );
    expect(result.code).toBe(`const a = "Open ${brand}";\nconst b = 'Restart ${brand}.';\n`);
    expect(result.replacements).toBe(2);
  });

  it("rewrites template quasis and leaves the expressions alone", () => {
    const result = rebrandSource(
      "const m = `Restart T3 Code on ${host.label}. T3 Code reconnects ${T3Code}.`;\n",
      serverModule,
    );
    expect(result.code).toBe(
      `const m = \`Restart ${brand} on \${host.label}. ${brand} reconnects \${T3Code}.\`;\n`,
    );
  });

  it("rewrites template quasis in JavaScript modules, which the parser spans without delimiters", () => {
    const result = rebrandSource(
      "export const m = `Restart T3 Code on ${host}.`;\n",
      moduleId("apps/desktop/scripts/example.mjs"),
    );
    expect(result.code).toBe(`export const m = \`Restart ${brand} on \${host}.\`;\n`);
  });

  it("rewrites JSX text and JSX attribute strings", () => {
    const result = rebrandSource(
      `export const A = () => <p aria-label="T3 Code" className="x">Welcome to T3 Code&rsquo;s app</p>;\n`,
      webModule,
    );
    expect(result.code).toBe(
      `export const A = () => <p aria-label="${brand}" className="x">Welcome to ${brand}&rsquo;s app</p>;\n`,
    );
  });

  it("leaves module specifiers, keys, comments, regexes and types untouched", () => {
    const source = [
      `import label from "./T3 Code.ts";`,
      `import type { X } from "T3 Code";`,
      `export * from "./T3 Code/all.ts";`,
      `export { y as "T3 Code" } from "./y.ts";`,
      `const lazy = () => import("./T3 Code/lazy.ts");`,
      `const cjs = require("T3 Code");`,
      `// T3 Code in a line comment`,
      `/* T3 Code in a block comment */`,
      `const keys = { "T3 Code": 1, ["T3 Code"]: 2 };`,
      `const read = keys["T3 Code"];`,
      `const pattern = /T3 Code/u;`,
      `type Brand = "T3 Code" | \`T3 Code \${string}\`;`,
      `interface Named { readonly name: "T3 Code" }`,
      `const typed = value as "T3 Code";`,
      `class C { "T3 Code" = 1; }`,
      `enum E { "T3 Code" = 1 }`,
      `declare module "T3 Code" {}`,
    ].join("\n");
    const result = rebrandSource(source, serverModule);
    expect(result.code).toBe(source);
    expect(result.replacements).toBe(0);
  });

  it("rewrites runtime values that sit next to untouched keys", () => {
    const result = rebrandSource(
      `const labels = { "T3 Code": "T3 Code" };\nenum E { Name = "T3 Code" }\n`,
      serverModule,
    );
    expect(result.code).toBe(
      `const labels = { "T3 Code": "${brand}" };\nenum E { Name = "${brand}" }\n`,
    );
  });

  it("keeps UTF-16 positions right after astral characters", () => {
    const result = rebrandSource(
      `const s = "🚀 → T3 Code";\nconst t = "é T3 Code";\n`,
      serverModule,
    );
    expect(result.code).toBe(`const s = "🚀 → ${brand}";\nconst t = "é ${brand}";\n`);
  });

  it("returns files without the token unchanged, without parsing them", () => {
    const notJavaScript = "this is { not valid ( TypeScript";
    const result = rebrandSource(notJavaScript, serverModule);
    expect(result).toEqual({ code: notJavaScript, map: null, replacements: 0 });

    const large = "export const value = 'Lathe';\n".repeat(50_000);
    const started = performance.now();
    expect(rebrandSource(large, serverModule).code).toBe(large);
    expect(performance.now() - started).toBeLessThan(50);
  });

  it("leaves a file it cannot parse unchanged", () => {
    const broken = `const a = "T3 Code" +;`;
    expect(rebrandSource(broken, serverModule).code).toBe(broken);
  });

  it("maps rewritten columns back to the original source", () => {
    const source = `const a = 1;\nthrow new Error("T3 Code could not start: " + reason);\n`;
    const result = rebrandSource(source, serverModule);
    expect(result.map).not.toBeNull();
    const map = result.map!;
    expect(map.sources).toEqual([serverModule]);
    expect(map.mappings.split(";")).toHaveLength(source.split("\n").length);

    const generatedLine = result.code.split("\n")[1]!;
    const reasonColumn = generatedLine.indexOf("reason");
    expect(originalPositionFor(map, 1, reasonColumn)).toEqual({
      line: 1,
      column: source.split("\n")[1]!.indexOf("reason"),
    });
    expect(originalPositionFor(map, 1, generatedLine.indexOf("throw"))).toEqual({
      line: 1,
      column: 0,
    });
  });
});

describe("substitutions", () => {
  it("replaces the upstream product name with the fork's", () => {
    expect(FORK_BRAND_SUBSTITUTIONS).toContainEqual({ from: FORK_BRAND_TOKEN, to: brand });
  });

  it("applies the longest matching key at each position", () => {
    const substitutions = [
      { from: "T3 Code", to: "A" },
      { from: "T3 Code Desktop", to: "B" },
    ];
    expect(rebrandText("T3 Code Desktop and T3 Code", { substitutions }).text).toBe("B and A");
  });

  it("points the upstream site link at the fork's repository", () => {
    const result = rebrandSource(
      `const readme = ["Created in [T3 Code](https://t3.codes)."].join("\\n");\n`,
      serverModule,
    );
    expect(result.code).toContain(`Created in [${brand}](${FORK_IDENTITY.repositoryUrl}).`);
  });

  it("redraws the Codex sign-in page's split wordmark as the fork's name", () => {
    const result = rebrandSource(
      'const page = `<div class="brand"><strong>T3</strong> Code</div>`;\n',
      serverModule,
    );
    expect(result.code).toBe(
      `const page = \`<div class="brand"><strong>${brand}</strong></div>\`;\n`,
    );
  });
});

const cli = FORK_IDENTITY.cliBin;
const npxPackage = FORK_IDENTITY.npmPackageName;
const rebrandsTo = (text: string) => rebrandText(text).text;

describe("product words", () => {
  it("rewrites the bare T3 product name in prose", () => {
    expect(rebrandsTo("T3 needs your SSH password to connect to ")).toBe(
      `${brand} needs your SSH password to connect to `,
    );
    expect(rebrandsTo("This host is ready for T3's browser.")).toBe(
      `This host is ready for ${brand}'s browser.`,
    );
    expect(rebrandsTo("Delegate one task to a T3-owned child of a T3 thread.")).toBe(
      `Delegate one task to a ${brand}-owned child of a ${brand} thread.`,
    );
    expect(rebrandsTo("Restart T3")).toBe(`Restart ${brand}`);
  });

  it("points npx at the fork's package, so the command runs the fork", () => {
    expect(rebrandsTo("npx t3 pair")).toBe(`npx ${npxPackage} pair`);
    expect(rebrandsTo("sudo npx t3 browser setup")).toBe(`sudo npx ${npxPackage} browser setup`);
    expect(rebrandsTo("npx t3@nightly")).toBe(`npx ${npxPackage}@nightly`);
  });

  it("names the fork's CLI where the text names upstream's", () => {
    expect(rebrandsTo("Run `t3 connect link` to enable T3 Connect.")).toBe(
      `Run \`${cli} connect link\` to enable T3 Connect.`,
    );
    expect(rebrandsTo("t3 is uninstalled. Thanks for trying T3 Code.")).toBe(
      `${cli} is uninstalled. Thanks for trying ${brand}.`,
    );
    expect(rebrandsTo("Could not rewrite the t3 launcher at ")).toBe(
      `Could not rewrite the ${cli} launcher at `,
    );
    expect(rebrandsTo('Use "t3 --help" for commands.')).toBe(`Use "${cli} --help" for commands.`);
  });

  it("keeps upstream's services, company and sibling products", () => {
    const kept = [
      "Link an environment to make it available through T3 Connect.",
      "T3 Connect and the other T3 services it uses follow T3 Tools' privacy policy.",
      "The T3 relay client is required for T3 Connect.",
      "T3 Chat",
      "Lathe is a fork of T3 Code by T3 Tools.",
    ];
    for (const text of kept) expect(rebrandsTo(text), text).toBe(text);
  });

  it("leaves identifiers, paths and code that only look like the name", () => {
    const kept = [
      "T3CODE_HOME",
      "$env:T3_SET",
      "Add-Type -Namespace T3 -Name Env; [void][T3.Env]::SendMessageTimeout()",
      "T3-code.preview_click",
      "refs/t3/checkpoints",
      "t3code:themes:v1",
      "t3-code",
      "t3.json",
      "@t3tools/contracts",
      "https://app.t3.codes",
      "profile t3-chrome-headless-shell /**/chrome flags=(unconfined) {",
      "lathe/add-search",
      "t3 checkpoint ref=refs/t3/checkpoints/1",
      "For example, t3 or t3/ produces t3/add-search. Leave empty for no prefix.",
    ];
    for (const text of kept) expect(rebrandsTo(text), text).toBe(text);
  });

  it("leaves a literal without whitespace, which is a value rather than prose", () => {
    const kept = ["T3", "\n            T3\n          ", "t3", "t3.", "t3#build", "T3:"];
    for (const text of kept) expect(rebrandsTo(text), text).toBe(text);
    expect(rebrandsTo("Run the t3#build task")).toBe("Run the t3#build task");
  });

  it("keeps a protected phrase that JSX text wraps across lines", () => {
    const text =
      "T3 Connect and the other T3 services it uses follow T3\n            Tools' policy.";
    expect(rebrandsTo(text)).toBe(text);
    expect(rebrandsTo("available through T3\n          Connect.")).toBe(
      "available through T3\n          Connect.",
    );
  });

  it("keeps copy that names upstream T3 Code as the source of synced history", () => {
    const kept = [
      "Read-only conversation synced from T3 Code",
      "From T3 Code",
      "Sync from another T3 Code install",
      "Path to the T3 Code home, such as ~/.t3",
    ];
    for (const text of kept) expect(rebrandsTo(text), text).toBe(text);
  });

  it("rewrites product words in source the same way, and parses only modules that need it", () => {
    const result = rebrandSource(
      "const a = `Stop t3 on ${host}, then restart t3.`;\nconst b = <p>T3 could not ask for approval here.</p>;\n",
      webModule,
    );
    expect(result.code).toBe(
      `const a = \`Stop ${cli} on \${host}, then restart ${cli}.\`;\nconst b = <p>${brand} could not ask for approval here.</p>;\n`,
    );
    const untouched = `import { x } from "@t3tools/contracts";\nconst T3 = 1;\nconst key = "t3code:x";\n`;
    expect(rebrandSource(untouched, webModule)).toEqual({
      code: untouched,
      map: null,
      replacements: 0,
    });
  });
});

describe("exceptions", () => {
  it("gives every exception a reason", () => {
    for (const exception of FORK_BRAND_EXCEPTIONS) {
      expect(exception.reason.length).toBeGreaterThan(20);
    }
  });

  it("names files that exist in the checkout", () => {
    for (const exception of FORK_BRAND_EXCEPTIONS) {
      if (exception.kind === "phrase" || exception.file === undefined) continue;
      expect(NodeFS.existsSync(NodePath.join(repoRoot, exception.file))).toBe(true);
    }
  });

  it("keeps verbatim identifiers out of every substitution", () => {
    for (const exception of FORK_BRAND_EXCEPTIONS) {
      if (exception.kind !== "verbatim") continue;
      expect(rebrandText(exception.value).text, exception.value).toBe(exception.value);
    }
  });

  it("leaves wire identities, hosts, paths and keys byte-identical", () => {
    const verbatim = FORK_BRAND_EXCEPTIONS.flatMap((exception) =>
      exception.kind === "verbatim" ? [exception.value] : [],
    );
    const source = [
      `export const brand = "T3 Code";`,
      ...verbatim.map((value, index) => `export const v${index} = ${JSON.stringify(value)};`),
    ].join("\n");
    const result = rebrandSource(source, serverModule);
    expect(result.replacements).toBe(1);
    for (const value of verbatim) {
      expect(result.code).toContain(JSON.stringify(value));
    }
  });

  it("keeps a protected phrase while rewriting the rest of the literal", () => {
    const result = rebrandSource(
      `const m = "The T3 Code Relay API is down; restart T3 Code.";\n`,
      webModule,
    );
    expect(result.code).toBe(`const m = "The T3 Code Relay API is down; restart ${brand}.";\n`);
  });

  it("names the GNOME extension as its staged metadata does", () => {
    const result = rebrandSource(
      `const m = "Enable T3 Code SnapShots in GNOME Extensions.";\n`,
      webModule,
    );
    expect(result.code).toBe(`const m = "Enable ${brand} SnapShots in GNOME Extensions.";\n`);
  });

  it("leaves the relay API contract, which describes upstream's service", () => {
    const file = "packages/contracts/src/relay.ts";
    const source = readRepoFile(file);
    expect(source).toContain("T3 environment");
    expect(rebrandSource(source, moduleId(file)).code).toBe(source);
  });

  it("keeps the attribution to upstream", () => {
    const source = `const about = "${brand} is a fork of T3 Code.";\n`;
    expect(rebrandSource(source, webModule).code).toBe(source);
  });

  it("keeps Codex's clientInfo and rebrands the rest of CodexProvider.ts", () => {
    const file = "apps/server/src/provider/CodexProvider.ts";
    const source = readRepoFile(file);
    const result = rebrandSource(source, moduleId(file));
    expect(result.code).toMatch(/clientInfo: \{\s*name: "T3 Code",\s*title: "T3 Code",/);
    expect(result.code).toContain(`"Codex is disabled in ${brand} settings."`);
    expect(result.code).not.toContain(`"Codex is disabled in T3 Code settings."`);
  });

  it("keeps the ChatGPT agent name hint", () => {
    const file = "apps/server/src/provider/CodexChatGptAuth.ts";
    const result = rebrandSource(readRepoFile(file), moduleId(file));
    expect(result.code).toContain(`{ agent_name_hint: "T3 Code" }`);
  });

  it("keeps the property exception scoped to its own file", () => {
    const result = rebrandSource(
      `const params = { clientInfo: { name: "T3 Code", title: "T3 Code" } };\n`,
      serverModule,
    );
    expect(result.code).toBe(
      `const params = { clientInfo: { name: "${brand}", title: "${brand}" } };\n`,
    );
  });

  it("sends triage to the fork's source, issue tracker and playbook", () => {
    const file = "apps/server/src/cli/triagePrompt.ts";
    const code = rebrandSource(readRepoFile(file), moduleId(file)).code;
    expect(code).toContain(`# ${brand} triage playbook`);
    expect(code).toContain(
      `You are a support engineer for ${brand} (${FORK_IDENTITY.repositoryUrl})`,
    );
    expect(code).toContain(`${FORK_IDENTITY.repositoryUrl}/issues/new`);
    expect(code).toContain(FORK_TRIAGE_PLAYBOOK_URL);
    expect(code).toContain(`\\\`npx ${npxPackage} serve\\\``);
    expect(code).toContain(`\\\`${cli} triage\\\``);
    expect(code).not.toContain("pingdotgg");
    expect(code).not.toContain(FORK_BRAND_TOKEN);
  });

  it("keeps the fork's triage playbook in step with upstream's", () => {
    const upstream = readRepoFile(".github/triage/PLAYBOOK.md");
    expect(readRepoFile(FORK_TRIAGE_PLAYBOOK_PATH)).toBe(forkTriagePlaybook(upstream));
  });

  it("keeps the triage repository rewrite inside triage", () => {
    const source = `const manifest = "https://raw.githubusercontent.com/pingdotgg/t3code/main/apps/server/src/provider/model-manifest.json";\n`;
    expect(rebrandSource(source, serverModule).code).toBe(source);
  });

  it("finds the verbatim vendor identities where the exceptions say they live", () => {
    for (const exception of FORK_BRAND_EXCEPTIONS) {
      if (exception.kind !== "verbatim" || exception.file === undefined) continue;
      const source = readRepoFile(exception.file);
      expect(source, `${exception.file} holds ${exception.value}`).toContain(exception.value);
      const result = rebrandSource(source, moduleId(exception.file));
      expect(result.code).toContain(exception.value);
    }
  });
});

describe("isBrandableModule", () => {
  it("accepts repo app and package modules, with or without a query", () => {
    expect(isBrandableModule(moduleId("apps/web/src/routes/_chat.tsx"))).toBe(true);
    expect(
      isBrandableModule(`${moduleId("apps/web/src/routes/_chat.tsx")}?tsr-split=component`),
    ).toBe(true);
    expect(isBrandableModule(moduleId("packages/shared/src/relayClient.ts"))).toBe(true);
    expect(isBrandableModule(moduleId("apps/desktop/scripts/dev-electron.mjs"))).toBe(true);
  });

  it("rejects dependencies, vendored references, other folders and other file types", () => {
    expect(isBrandableModule(moduleId("node_modules/effect/dist/index.js"))).toBe(false);
    expect(isBrandableModule(moduleId("apps/web/node_modules/x/index.js"))).toBe(false);
    expect(isBrandableModule(moduleId(".repos/effect-smol/packages/effect/src/index.ts"))).toBe(
      false,
    );
    expect(isBrandableModule(moduleId("scripts/dev-runner.ts"))).toBe(false);
    expect(isBrandableModule(moduleId("apps/web/src/index.css"))).toBe(false);
    expect(isBrandableModule("\0virtual:module.ts")).toBe(false);
    expect(isBrandableModule("/elsewhere/apps/web/src/a.ts")).toBe(false);
  });
});
