# Fork brand layer

Upstream-owned files keep upstream's "T3 Code" strings. The built product says the fork's name
(`FORK_IDENTITY.productBaseName`) because a bundler plugin rewrites them at build time. Swapping
hundreds of literals by hand would make every upstream sync conflict; the plugin keeps those files
byte-identical to upstream, so they merge cleanly.

## How it works

[`scripts/lib/forkBrand.ts`](../../scripts/lib/forkBrand.ts) holds the substitutions, the
exceptions, and `rebrandSource`. `rebrandSource` parses a module with Rolldown's oxc parser (the
`parseSync` that `vite-plus` exports) and rewrites only string literals, template-literal static
parts, and JSX text. It never touches identifiers, module specifiers, property keys, comments,
regex literals, or types. Replacements never span lines, so line numbers stay exact and the
returned source map corrects the columns.

The plugin is registered in the web, desktop and server bundling configs. It runs in dev servers
and watch builds too, so what developers see is what ships. The server's unbundled dev mode
(`node src/bin.ts`) gets the same rewrite from a Node load hook,
[`forkBrandRegister.ts`](../../scripts/lib/forkBrandRegister.ts), on its `dev` script. Vitest runs
skip the plugin, because upstream tests assert upstream's strings. Only `.ts`, `.tsx`, `.js` and
`.mjs` modules under `apps/` and `packages/` are rewritten.

## Phrases and words

Upstream names the product three ways, and each needs the fork's name: "T3 Code", the short "T3"
("T3 needs your SSH password"), and the CLI `t3` ("Run `t3 connect link`"). `npx t3` becomes
`npx @jamesainslie/lathe`, because the bare command would run upstream's package, on upstream's
port and state directory.

The bare words are only rewritten as prose: between whitespace, quotes, brackets or sentence
punctuation, and only in a literal that has whitespace in it. That is what keeps `T3CODE_HOME`,
`refs/t3/`, `t3-code`, `t3.json`, `"t3#build"`, `"t3."` and minified code embedded in strings
intact. The same rules would corrupt JSON keys and scripts (`"t3": "workspace:*"`,
`--filter t3`), so whole plain-text files such as `index.html` and packaging metadata get the
phrase rules only (`rebrandPlainText`).

At each position the longest matching rule wins. `FORK_FILE_SUBSTITUTIONS` adds rules for one
file. Triage uses it to point at the fork's repository, issue tracker and playbook: a fork build's
commits exist only in the fork, and upstream's playbook tells the agent to follow a newer copy
when it finds one, so the fetched copy is the fork's
[`.github/triage/LATHE-PLAYBOOK.md`](../../.github/triage/LATHE-PLAYBOOK.md). A test fails when it
drifts from upstream's playbook; `node scripts/write-fork-triage-playbook.ts` regenerates it.

A string built from parts, such as `"T3" + " Code"`, is invisible to the layer. The leak check is
what catches it.

## Exceptions

Some strings must keep upstream's name: client identities that OpenAI and other vendors see,
upstream's services (T3 Connect, its relay and their API schema), attribution, and copy that names
an upstream install as the source of synced history. Every exception lives in
`FORK_BRAND_EXCEPTIONS` with a reason. To add one, choose the narrowest kind:

- `property`: the value of one object key path in one file, such as `clientInfo.name`.
- `phrase`: a phrase kept wherever it appears, while the rest of its string is rebranded. A space
  in it matches any whitespace, because JSX text wraps.
- `file`: a whole file left untouched.
- `verbatim`: an identifier no rule should rewrite, such as `refs/t3/` or `t3-code`. The tests fail
  if one would.

The leak check builds its allowlist from the same list, so an exception never needs a second
entry.

## Packaging

Some shipped text never passes through a bundler: the staged `package.json` that electron-builder
turns into `Info.plist` permission prompts, desktop entries and `.deb` metadata, the DMG
background, the AppStream metadata, the GNOME extension, and the npm packages' manifests and
READMEs. [`forkBrandPackaging.ts`](../../scripts/lib/forkBrandPackaging.ts) rebrands those files
after the build scripts stage them, one call per site. The native helpers' few strings are
swapped in their sources, because upstream rarely changes them.

## Leak check

[`scripts/brand-leak-check.ts`](../../scripts/brand-leak-check.ts) scans built output and fails
on any "T3 Code" no exception covers, and on any product word or `npx t3` the layer would still
rewrite in a JavaScript bundle's string literals, naming the file, position and context. It skips
source maps, which carry the original source by design, and binary files. CI runs it after the
desktop pipeline build, and the release workflow runs it before the bundle is uploaded for
packaging.

## Not covered

Markdown under `docs/`, the marketing site and the mobile app (bundled by Metro) keep upstream's
branding. The repository page shows the fork's [`.github/README.md`](../../.github/README.md),
which GitHub prefers to the root README, so the root README stays upstream's.
