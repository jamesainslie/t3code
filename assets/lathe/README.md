# Lathe icons

The fork's icon sets, in upstream's layout and file names (see `../README.md`).
`FORK_IDENTITY.assetsDir` points every consumer here, so upstream's `assets/`
stays untouched. `vp run icons:export` regenerates everything except the macOS
PNGs from these `app-icon.icon` projects.

## macOS exports

Icon Composer 27 exports the "macOS pre-Tahoe" preset full bleed, not in the
classic safe area that `../README.md` describes. Export each project with
Platform: macOS pre-Tahoe, Appearance: Default, Size: 1024pt, Scale: 1×, then
place the result in the safe area with the shadow upstream's PNGs carry: the
body scaled to 824px at 100,100 and a black drop shadow, offset 8px down,
16px blur, 0.26 opacity. In SVG, rendered with `rsvg-convert -w 1024 -h 1024`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <filter id="s" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="8" stdDeviation="16" flood-color="#000" flood-opacity="0.26"/>
  </filter>
  <image x="100" y="100" width="824" height="824" href="EXPORT.png" filter="url(#s)"/>
</svg>
```

Put through the same step, upstream's own prod project matches its tracked
`black-macos-1024.png` to within 0.6 percent RMSE.
