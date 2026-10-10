# Fork brand layer

Upstream-owned files keep upstream's "T3 Code" strings. The built product says the fork's name
(`FORK_IDENTITY.productBaseName`) because a bundler plugin rewrites them at build time. Swapping
hundreds of literals by hand would make every upstream sync conflict; the plugin keeps those files
byte-identical to upstream, so they merge cleanly.

## How it works

[`scripts/lib/forkBrand.ts`](../../scripts/lib/forkBrand.ts) holds the substitution map, the
exceptions, and `rebrandSource`. `rebrandSource` parses a module with Rolldown's oxc parser (the
`parseSync` that `vite-plus` exports) and rewrites only string literals, template-literal static
parts, and JSX text. It never touches identifiers, module specifiers, property keys, comments,
regex literals, or types. Replacements never span lines, so line numbers stay exact and the
returned source map corrects the columns.

The plugin is registered in the web, desktop and server bundling configs. It runs in dev servers
and watch builds too, so what developers see is what ships. The server's unbundled dev mode
(`node src/bin.ts`) gets the same rewrite from a Node load hook,
[`forkBrandRegister.ts`](../../scripts/lib/forkBrandRegister.ts), on its `dev` script. Vitest runs
skip the plugin, because upstream tests assert upstream's strings. The web app's `index.html`
gets the same substitution as plain text. Only `.ts`, `.tsx`, `.js` and
`.mjs` modules under `apps/` and `packages/` are rewritten, and a module without the substring
"T3 Code" is never parsed.

A string built from parts, such as `"T3" + " Code"`, is invisible to the layer. The leak check is
what catches it.

## Exceptions

Some strings must keep upstream's name: client identities that OpenAI and other vendors see,
the GNOME extension's name, and the triage playbook, which must match upstream exactly. Every
exception lives in `FORK_BRAND_EXCEPTIONS` with a reason. To add one, choose the narrowest kind:

- `property`: the value of one object key path in one file, such as `clientInfo.name`.
- `phrase`: a longer phrase kept wherever it appears, while the rest of its string is rebranded.
- `file`: a whole file left untouched.
- `verbatim`: an identifier with no "T3 Code" in it, such as `refs/t3/` or `t3-code`. Nothing
  rewrites it today. The tests fail if a new substitution key would.

The leak check builds its allowlist from the same list, so an exception never needs a second
entry.

## Leak check

[`scripts/brand-leak-check.ts`](../../scripts/brand-leak-check.ts) scans built output and fails
on any "T3 Code" no exception covers, naming the file, position and context. It skips source maps,
which carry the original source by design, and binary files. CI runs it after the desktop pipeline
build, and the release workflow runs it before the bundle is uploaded for packaging.

## Not covered

Markdown under `docs/`, the marketing site, the mobile app (bundled by Metro), static files such as
`apps/desktop/gnome-extension`, and JSON manifests are outside the layer. Their branding is edited
directly or left as upstream's.
