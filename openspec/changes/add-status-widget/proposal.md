## Why

When working with OpenSpec changes, users must leave the pi TUI or run slash commands to check change status. There's no persistent, glanceable view of what changes are active, what artifacts are complete, and how tasks are progressing. This creates friction — users either context-switch to the terminal or ask the agent to run `openspec list` / `openspec status`.

A persistent widget above the editor solves this. It gives the user continuous awareness of their OpenSpec state without any interaction.

## What Changes

Add a pi extension that displays a TUI widget above the editor showing all active (non-archived) OpenSpec changes. The widget auto-refreshes on relevant events and adapts its display based on the number of active changes.

- **Single active change**: Three-line display with change name, schema, artifact status, and task progress bar.
- **Multiple active changes**: One line per change with condensed information (artifact initials, task counter).
- **No active changes**: Single line indicating no changes are active.
- **Auto-refresh**: Refreshes on session start, turn end, agent end, relevant tool results, and a 30s fallback interval.
- **Dynamic width**: Uses available terminal width, truncating and adjusting layout accordingly.

## Capabilities

### New Capabilities
- `status-widget`: Display active OpenSpec changes as a persistent TUI widget above the pi editor, with adaptive layout for single vs. multiple changes and auto-refresh on relevant events.

## Impact

- New files in `extension/`: `index.ts`, `openspec.ts`, `widget.ts`, `types.ts`
- Uses `openspec list --json` and `openspec status --json --change <name>` CLI commands
- Depends on pi extension APIs: `ctx.ui.setWidget`, `pi.exec`, lifecycle event subscriptions
- No new npm dependencies beyond pi peer dependencies
