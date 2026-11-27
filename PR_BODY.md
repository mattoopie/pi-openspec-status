## Problem

omp (and other `@oh-my-pi` hosts) refuse to load extensions that import `@earendil-works/pi-tui`. npm `1.0.0` still uses `@earendil-works/*` in `interaction.ts`, `overlay.ts`, and `widget.ts`, so the OpenSpec TUI widget never loads on omp.

Follow-on omp issues when switching imports only to `@oh-my-pi/pi-tui`:

- bundled package root does not export `truncateToWidth` / `visibleWidth`
- subpath imports (`@oh-my-pi/pi-tui/utils`, …) fail with “Cannot find package” for linked extensions

## Approach

- `@earendil-works/pi-coding-agent` → `@oh-my-pi/pi-coding-agent` (extension + tests + `peerDependencies` / `mise.toml`)
- **No** `@oh-my-pi/pi-tui` import: vend small `terminal-text.ts` (width/truncate) and `tui-keys.ts` (overlay up/down/esc) so extension loads under omp’s resolver
- Shortcut registration uses literal `"ctrl+alt+o"` (`KeyId`)
- README: omp link + `npm install` for `cross-spawn`

Behavior unchanged on hosts that already worked: string-row widget, `ctx.ui.custom` overlays, same openspec CLI integration.

## Risk

- Local key helper may be less complete than full `pi-tui` `matchesKey` on exotic terminal modes; overlay navigation is the only surface affected
- Hosts on legacy `@earendil-works/*` only may need a release line before this merge

## Test

- `npm install` in package root (linked install)
- `omp plugin install <path>` → no load warning; widget above editor; `Ctrl+Alt+O` overlay in an OpenSpec project

## Reviewer focus

- Whether to ship as **1.0.1** or **1.1.0** (peerDependency + import surface)
- Prefer vendored helpers vs future omp export of width utils on bundled `pi-tui` root