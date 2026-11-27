## Problem

omp (and other `@oh-my-pi` hosts) refuse to load extensions that import `@earendil-works/pi-tui`. The loader error is:

> …imports `@earendil-works/pi-tui`, which omp no longer provides… See docs/extensions.md#migrating-from-pi-tui.

`pi-openspec-status` 0.8.1 / 1.0.0 still import the `@earendil-works/*` packages in `interaction.ts`, `overlay.ts`, and `widget.ts`, so the OpenSpec TUI widget never loads on omp even though `openspec-pi` and the CLI work fine.

## Approach

Mechanical migration only — no behaviour change:

- `extension/*` + unit tests: `@earendil-works/pi-coding-agent` → `@oh-my-pi/pi-coding-agent`, `@earendil-works/pi-tui` → `@oh-my-pi/pi-tui`
- `package.json` `peerDependencies`: point at `@oh-my-pi/pi-coding-agent`
- `mise.toml`: dev tooling uses `@oh-my-pi/pi-coding-agent`
- README: short host compatibility note

Widget still uses the same APIs (`ctx.ui.setWidget` with string rows, `ctx.ui.custom` with `{ render, handleInput }`, `Key`, `matchesKey`, `truncateToWidth`, `visibleWidth`). omp's bundled `@oh-my-pi/pi-tui` root does not export the text-width helpers — import them from `@oh-my-pi/pi-tui/utils` (same as core omp code).

## Risk

- Hosts that only ship `@earendil-works/*` and do not resolve `@oh-my-pi/*` may need to stay on the previous npm release until they align with oh-my-pi. Modern omp and pi-tui document `@oh-my-pi` as the canonical import path.

## Test

- `omp plugin install <path-to-this-repo>` (link) — extension validates and `omp plugin doctor pi-openspec-status` reports OK
- Start omp in a repo with active OpenSpec changes — widget renders above the editor; `Ctrl+Alt+O` opens the overlay

## Reviewer focus

- Import paths only vs any missed `@earendil-works` references under `extension/`
- Whether to bump semver minor (1.1.0) or patch (1.0.1) given peerDependency scope change