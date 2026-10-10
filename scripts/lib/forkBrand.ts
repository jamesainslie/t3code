// @effect-diagnostics nodeBuiltinImport:off - a bundler plugin and Node load hook that run before an Effect runtime exists.
/**
 * Fork-only. Rebrands the built product from "T3 Code" to the fork's product
 * name at build time, so upstream-owned files keep upstream's strings and
 * merges from upstream stay mechanical. See docs/internals/fork-brand-layer.md.
 *
 * Only string literals, template-literal static parts and JSX text are
 * rewritten, located with Rolldown's oxc parser. Identifiers, module
 * specifiers, property keys, comments, regex literals and types never change.
 */
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { FORK_IDENTITY } from "@t3tools/shared/forkIdentity";
import { parseSync, type Plugin } from "vite-plus";
import type { PackUserConfig } from "vite-plus/pack";

/** The upstream product name. A module without it is never parsed. */
export const FORK_BRAND_TOKEN = "T3 Code";

export interface BrandSubstitution {
  readonly from: string;
  readonly to: string;
}

const byLongestKey = (entries: ReadonlyArray<BrandSubstitution>) =>
  entries.toSorted((a, b) => b.from.length - a.from.length);

/** Every replacement, longest key first so a longer phrase wins over the bare name. */
export const FORK_BRAND_SUBSTITUTIONS: ReadonlyArray<BrandSubstitution> = byLongestKey([
  // The README of a project folder the app creates links the product name to its site.
  {
    from: `[${FORK_BRAND_TOKEN}](https://t3.codes)`,
    to: `[${FORK_IDENTITY.productBaseName}](${FORK_IDENTITY.repositoryUrl})`,
  },
  { from: FORK_BRAND_TOKEN, to: FORK_IDENTITY.productBaseName },
]);

export type ForkBrandException =
  /** A file left untouched. */
  | { readonly kind: "file"; readonly file: string; readonly reason: string }
  /**
   * A string that is the value of `property` (a dotted key path, matched as a
   * suffix of the enclosing object keys) in `file`.
   */
  | {
      readonly kind: "property";
      readonly file: string;
      readonly property: string;
      readonly reason: string;
    }
  /** A phrase kept wherever it appears; the rest of its literal is still rebranded. */
  | { readonly kind: "phrase"; readonly phrase: string; readonly reason: string }
  /**
   * A value that must stay byte-identical. It holds no substitution key today,
   * so nothing rewrites it; the tests fail if a new key would.
   */
  | {
      readonly kind: "verbatim";
      readonly value: string;
      readonly file?: string;
      readonly reason: string;
    };

export const FORK_BRAND_EXCEPTIONS: ReadonlyArray<ForkBrandException> = [
  {
    kind: "file",
    file: "apps/server/src/cli/triagePrompt.ts",
    reason:
      "The triage playbook sends users to upstream's issue tracker and must stay byte-identical to upstream.",
  },
  {
    kind: "property",
    file: "apps/server/src/provider/CodexProvider.ts",
    property: "clientInfo.name",
    reason: "Codex app-server client identity that OpenAI sees; the fork reports as upstream.",
  },
  {
    kind: "property",
    file: "apps/server/src/provider/CodexProvider.ts",
    property: "clientInfo.title",
    reason: "Codex app-server client identity that OpenAI sees; the fork reports as upstream.",
  },
  {
    kind: "property",
    file: "apps/server/src/provider/CodexChatGptAuth.ts",
    property: "agent_name_hint",
    reason: "ChatGPT OAuth agent identity registered for upstream; OpenAI keys consent on it.",
  },
  {
    kind: "phrase",
    phrase: "T3 Code SnapShots",
    reason:
      "Name of the GNOME extension in apps/desktop/gnome-extension/metadata.json, which the UI must match.",
  },
  {
    kind: "phrase",
    phrase: "T3 Code Relay API",
    reason: "Title of upstream's T3 Connect relay API, a service the fork uses unchanged.",
  },
  {
    kind: "phrase",
    phrase: "fork of T3 Code",
    reason: "Attribution of the fork to upstream, which must keep upstream's name.",
  },
  {
    kind: "verbatim",
    value: `const T3_CODE_OAUTH_REFERRER = "t3code"`,
    file: "packages/provider-grok/src/server/acpSupport.ts",
    reason: "Grok OAuth referrer registered with xAI for upstream.",
  },
  {
    kind: "verbatim",
    value: `clientInfo: { name: "t3-code", version: "0.0.0" }`,
    file: "packages/provider-acp/src/server/adapter.ts",
    reason: "ACP client identity that agents see.",
  },
  {
    kind: "verbatim",
    value: `clientInfo: { name: "t3-code-text", version: "0.0.0" }`,
    file: "apps/server/src/provider/Drivers/AntigravityDriver.ts",
    reason: "Antigravity client identity that the agent sees.",
  },
  { kind: "verbatim", value: "T3 Connect", reason: "Upstream's tunnel service, used as-is." },
  { kind: "verbatim", value: "https://app.t3.codes", reason: "Upstream's hosted app origin." },
  {
    kind: "verbatim",
    value: "https://relay.t3.codes",
    reason: "Upstream's T3 Connect relay host.",
  },
  { kind: "verbatim", value: "https://clerk.t3.codes", reason: "Upstream's Clerk auth host." },
  { kind: "verbatim", value: "T3CODE_HOME", reason: "T3CODE_* environment names are an API." },
  { kind: "verbatim", value: "refs/t3/", reason: "Checkpoint refs shared with upstream installs." },
  { kind: "verbatim", value: "t3code/", reason: "Pre-rename worktree branch prefix." },
  { kind: "verbatim", value: "lathe/", reason: "The fork's worktree branch prefix." },
  {
    kind: "verbatim",
    value: "t3code:",
    reason: "Browser storage key prefix; renaming loses state.",
  },
  { kind: "verbatim", value: "@t3tools/", reason: "Workspace package specifiers." },
  { kind: "verbatim", value: "t3-code", reason: "MCP server name agents address tools by." },
  { kind: "verbatim", value: "t3_thread_list", reason: "MCP tool names (t3_*) agents call." },
  { kind: "verbatim", value: "/.well-known/t3/", reason: "Discovery path shared with upstream." },
  { kind: "verbatim", value: "/api/t3-connect/", reason: "T3 Connect HTTP routes." },
  { kind: "verbatim", value: "t3.json", reason: "Project file name shared with upstream." },
  {
    kind: "verbatim",
    value: "https://t3.codes/schema/t3.json",
    reason: "Schema URL of the shared t3.json format.",
  },
  { kind: "verbatim", value: "pingdotgg/t3code", reason: "Upstream repository slug." },
  { kind: "verbatim", value: "jamesainslie/t3code", reason: "The fork's repository slug." },
];

const PROTECTED_PHRASES = FORK_BRAND_EXCEPTIONS.flatMap((exception) =>
  exception.kind === "phrase" ? [exception.phrase] : [],
);

for (const { to } of FORK_BRAND_SUBSTITUTIONS) {
  // A replacement lands inside quotes, templates and JSX text unescaped.
  if (/["'`\\$<>{}&\r\n]/.test(to)) {
    throw new Error(`Fork brand replacement ${JSON.stringify(to)} needs escaping in source.`);
  }
}

const REPO_ROOT = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const toPosix = (path: string) => path.replaceAll("\\", "/");
const stripQuery = (id: string) => id.replace(/[?#].*$/s, "");
const POSIX_REPO_ROOT = toPosix(REPO_ROOT);
const BRANDABLE_EXTENSION = /\.(?:ts|tsx|js|mjs)$/;

/** Repo-relative POSIX path of a module id, or undefined outside the checkout. */
const repoRelativePath = (id: string): string | undefined => {
  const path = toPosix(stripQuery(id));
  return path.startsWith(`${POSIX_REPO_ROOT}/`)
    ? path.slice(POSIX_REPO_ROOT.length + 1)
    : undefined;
};

/** Whether a bundled module is fork or upstream source the brand layer rewrites. */
export const isBrandableModule = (id: string): boolean => {
  const relative = repoRelativePath(id);
  return (
    relative !== undefined &&
    /^(?:apps|packages)\//.test(relative) &&
    !relative.includes("/node_modules/") &&
    BRANDABLE_EXTENSION.test(relative)
  );
};

interface Replacement {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

interface TextRebrandOptions {
  readonly substitutions?: ReadonlyArray<BrandSubstitution>;
  readonly protectedPhrases?: ReadonlyArray<string>;
}

const protectedRanges = (text: string, phrases: ReadonlyArray<string>) => {
  const ranges: Array<readonly [number, number]> = [];
  for (const phrase of phrases) {
    for (let at = text.indexOf(phrase); at !== -1; at = text.indexOf(phrase, at + 1)) {
      ranges.push([at, at + phrase.length]);
    }
  }
  return ranges;
};

const planTextReplacements = (
  text: string,
  offset: number,
  {
    substitutions = FORK_BRAND_SUBSTITUTIONS,
    protectedPhrases = PROTECTED_PHRASES,
  }: TextRebrandOptions = {},
): Array<Replacement> => {
  const ordered = byLongestKey(substitutions);
  const kept = protectedRanges(text, protectedPhrases);
  const replacements: Array<Replacement> = [];
  let index = 0;
  while (index < text.length) {
    const match = ordered.find(({ from }) => text.startsWith(from, index));
    const end = match ? index + match.from.length : index;
    if (!match || kept.some(([start, stop]) => index < stop && end > start)) {
      index += 1;
      continue;
    }
    replacements.push({ start: offset + index, end: offset + end, text: match.to });
    index = end;
  }
  return replacements;
};

const applyReplacements = (code: string, replacements: ReadonlyArray<Replacement>) => {
  let output = "";
  let cursor = 0;
  for (const { start, end, text } of replacements) {
    output += code.slice(cursor, start) + text;
    cursor = end;
  }
  return output + code.slice(cursor);
};

/** Rebrands plain text such as HTML, keeping protected phrases. */
export const rebrandText = (text: string, options?: TextRebrandOptions) => {
  const substitutions = options?.substitutions ?? FORK_BRAND_SUBSTITUTIONS;
  if (!substitutions.some(({ from }) => text.includes(from))) return { text, replacements: 0 };
  const replacements = planTextReplacements(text, 0, options);
  return { text: applyReplacements(text, replacements), replacements: replacements.length };
};

interface AstNode {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

const isAstNode = (value: unknown): value is AstNode =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { type?: unknown }).type === "string" &&
  typeof (value as { start?: unknown }).start === "number";

/** Declarations that only name modules or types; nothing inside them ships as text. */
const SKIPPED_NODE_TYPES = new Set([
  "ImportDeclaration",
  "ExportAllDeclaration",
  "ImportExpression",
  "TSImportEqualsDeclaration",
  "TSExternalModuleReference",
  "TSTypeAliasDeclaration",
  "TSInterfaceDeclaration",
  "TSDeclareFunction",
  "TSImportType",
]);

/** Child keys that hold types, which the build erases. */
const TYPE_KEYS = new Set([
  "typeAnnotation",
  "typeArguments",
  "typeParameters",
  "returnType",
  "superTypeArguments",
  "implements",
]);

/** Child keys that name things: property keys, specifiers, module ids, enum members. */
const skippedKeys = (node: AstNode): ReadonlySet<string> | undefined => {
  switch (node.type) {
    case "Property":
    case "MethodDefinition":
    case "PropertyDefinition":
    case "AccessorProperty":
    case "TSAbstractMethodDefinition":
    case "TSAbstractPropertyDefinition":
    case "TSAbstractAccessorProperty":
      return new Set(["key"]);
    case "MemberExpression":
      return new Set(["property"]);
    case "ExportNamedDeclaration":
      return new Set(["source", "specifiers", "attributes"]);
    case "TSEnumMember":
    case "TSModuleDeclaration":
      return new Set(["id"]);
    case "JSXAttribute":
      return new Set(["name"]);
    case "CallExpression": {
      const callee = node.callee;
      return isAstNode(callee) && callee.type === "Identifier" && callee.name === "require"
        ? new Set(["arguments"])
        : undefined;
    }
    default:
      return undefined;
  }
};

const propertyName = (node: AstNode): string | undefined => {
  if (node.computed === true || !isAstNode(node.key)) return undefined;
  const key = node.key;
  if (key.type === "Identifier" && typeof key.name === "string") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return undefined;
};

/** The source range between a text-bearing node's delimiters, when it has one. */
const textRange = (code: string, node: AstNode): readonly [number, number] | undefined => {
  if (node.type === "JSXText") return [node.start, node.end];
  if (node.type === "Literal") {
    if (typeof node.value !== "string") return undefined;
    const quote = code[node.start];
    return quote === '"' || quote === "'" ? [node.start + 1, node.end - 1] : undefined;
  }
  if (node.type === "TemplateElement") {
    const raw = (node.value as { raw?: unknown } | undefined)?.raw;
    if (typeof raw !== "string") return undefined;
    const start = node.start + 1;
    const end = code.startsWith("${", node.end - 2) ? node.end - 2 : node.end - 1;
    return code.slice(start, end) === raw ? [start, end] : undefined;
  }
  return undefined;
};

interface TextSite {
  readonly start: number;
  readonly end: number;
  readonly keyPath: ReadonlyArray<string>;
}

/** Every string literal, template quasi and JSX text that can reach the user. */
const collectTextSites = (code: string, program: unknown): Array<TextSite> => {
  const sites: Array<TextSite> = [];
  const visit = (value: unknown, keyPath: ReadonlyArray<string>): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, keyPath);
      return;
    }
    if (!isAstNode(value) || SKIPPED_NODE_TYPES.has(value.type)) return;
    if (value.type === "ExpressionStatement" && typeof value.directive === "string") return;
    const range = textRange(code, value);
    if (range) {
      sites.push({ start: range[0], end: range[1], keyPath });
      return;
    }
    const skipped = skippedKeys(value);
    const name = value.type === "Property" ? propertyName(value) : undefined;
    for (const [key, child] of Object.entries(value)) {
      if (TYPE_KEYS.has(key) || skipped?.has(key) || typeof child !== "object") continue;
      visit(child, name !== undefined && key === "value" ? [...keyPath, name] : keyPath);
    }
  };
  visit(program, []);
  return sites;
};

const endsWithPath = (keyPath: ReadonlyArray<string>, property: string) => {
  const wanted = property.split(".");
  return (
    keyPath.length >= wanted.length &&
    wanted.every((key, index) => keyPath[keyPath.length - wanted.length + index] === key)
  );
};

export interface SourceMapV3 {
  readonly version: 3;
  readonly file: string;
  readonly sources: Array<string>;
  readonly sourcesContent: Array<string>;
  readonly names: Array<string>;
  readonly mappings: string;
}

const VLQ_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const encodeVlq = (value: number) => {
  let rest = value < 0 ? (-value << 1) | 1 : value << 1;
  let encoded = "";
  do {
    let digit = rest & 31;
    rest >>>= 5;
    if (rest > 0) digit |= 32;
    encoded += VLQ_ALPHABET[digit];
  } while (rest > 0);
  return encoded;
};

/**
 * Replacements never span lines, so every line maps to itself and only the
 * columns after a replacement shift. Each line gets a segment at its start and
 * around each replacement.
 */
const buildSourceMap = (
  code: string,
  id: string,
  replacements: ReadonlyArray<Replacement>,
): SourceMapV3 => {
  const lineStarts = [0];
  for (let index = code.indexOf("\n"); index !== -1; index = code.indexOf("\n", index + 1)) {
    lineStarts.push(index + 1);
  }
  const byLine = new Map<number, Array<Replacement>>();
  let line = 0;
  for (const replacement of replacements) {
    while (line + 1 < lineStarts.length && lineStarts[line + 1]! <= replacement.start) line += 1;
    byLine.set(line, [...(byLine.get(line) ?? []), replacement]);
  }
  let previousOriginalLine = 0;
  let previousOriginalColumn = 0;
  const encodedLines = lineStarts.map((lineStart, lineIndex) => {
    const segments: Array<readonly [number, number]> = [[0, 0]];
    let shift = 0;
    for (const { start, end, text } of byLine.get(lineIndex) ?? []) {
      segments.push([start - lineStart + shift, start - lineStart]);
      shift += text.length - (end - start);
      segments.push([end - lineStart + shift, end - lineStart]);
    }
    let previousGeneratedColumn = 0;
    return segments
      .map(([generatedColumn, originalColumn]) => {
        const segment =
          encodeVlq(generatedColumn - previousGeneratedColumn) +
          encodeVlq(0) +
          encodeVlq(lineIndex - previousOriginalLine) +
          encodeVlq(originalColumn - previousOriginalColumn);
        previousGeneratedColumn = generatedColumn;
        previousOriginalLine = lineIndex;
        previousOriginalColumn = originalColumn;
        return segment;
      })
      .join(",");
  });
  return {
    version: 3,
    file: NodePath.basename(stripQuery(id)),
    sources: [id],
    sourcesContent: [code],
    names: [],
    mappings: encodedLines.join(";"),
  };
};

/** The text of every literal, quasi and JSX text in a module that holds the token. */
export const brandTextSites = (code: string, id: string): Array<string> => {
  if (!code.includes(FORK_BRAND_TOKEN)) return [];
  const parsed = parseSync(stripQuery(id), code, { lang: languageOf(id), sourceType: "module" });
  return collectTextSites(code, parsed.program)
    .map((site) => code.slice(site.start, site.end))
    .filter((text) => text.includes(FORK_BRAND_TOKEN));
};

export interface RebrandResult {
  readonly code: string;
  readonly map: SourceMapV3 | null;
  readonly replacements: number;
}

const languageOf = (id: string) => {
  const extension = NodePath.extname(stripQuery(id));
  return extension === ".tsx" ? "tsx" : extension === ".ts" ? "ts" : "jsx";
};

/**
 * Rebrands one module. Pure: the result depends only on `code` and `id`. A
 * module without the token, in an excepted file, or that does not parse comes
 * back unchanged with a null map.
 */
export const rebrandSource = (code: string, id: string): RebrandResult => {
  const unchanged = { code, map: null, replacements: 0 };
  if (!code.includes(FORK_BRAND_TOKEN)) return unchanged;
  const relative = repoRelativePath(id);
  const exceptions = FORK_BRAND_EXCEPTIONS.filter(
    (exception) =>
      (exception.kind === "file" || exception.kind === "property") && exception.file === relative,
  );
  if (exceptions.some((exception) => exception.kind === "file")) return unchanged;

  const parsed = parseSync(stripQuery(id), code, {
    lang: languageOf(id),
    sourceType: "module",
  });
  if (parsed.errors.length > 0) return unchanged;

  const keptProperties = exceptions.flatMap((exception) =>
    exception.kind === "property" ? [exception.property] : [],
  );
  const replacements = collectTextSites(code, parsed.program)
    .filter((site) => code.slice(site.start, site.end).includes(FORK_BRAND_TOKEN))
    .filter((site) => !keptProperties.some((property) => endsWithPath(site.keyPath, property)))
    .flatMap((site) => planTextReplacements(code.slice(site.start, site.end), site.start))
    .toSorted((a, b) => a.start - b.start);
  if (replacements.length === 0) return unchanged;
  return {
    code: applyReplacements(code, replacements),
    map: buildSourceMap(code, id, replacements),
    replacements: replacements.length,
  };
};

const BRANDABLE_ID_FILTER = new RegExp(
  `^${POSIX_REPO_ROOT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/(?:apps|packages)/.*\\.(?:ts|tsx|js|mjs)(?:[?#].*)?$`,
  "s",
);

/**
 * The brand layer as a Vite and Rolldown plugin. It runs before other
 * transforms so it sees the original source, and in dev servers and watch
 * builds as well as production builds. Vitest runs skip it: upstream tests
 * assert upstream's strings.
 */
export const forkBrandPlugin = (): Plugin => ({
  name: "fork:brand",
  enforce: "pre",
  apply: () => process.env.VITEST === undefined,
  transform: {
    filter: {
      id: { include: [BRANDABLE_ID_FILTER], exclude: [/[\\/]node_modules[\\/]/] },
      code: { include: FORK_BRAND_TOKEN },
    },
    handler(code, id) {
      if (!isBrandableModule(id)) return null;
      const result = rebrandSource(code, id);
      return result.map === null ? null : { code: result.code, map: result.map };
    },
  },
  transformIndexHtml: {
    order: "pre",
    handler: (html) => rebrandText(html).text,
  },
});

/** Adds the brand layer to every `pack` entry of a Vite+ config. */
export const withForkBrand = (entries: ReadonlyArray<PackUserConfig>): Array<PackUserConfig> =>
  entries.map((entry) => ({ ...entry, plugins: [forkBrandPlugin(), entry.plugins] }));
