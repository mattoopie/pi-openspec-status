## Context

The pi extension system provides `ctx.ui.setWidget()` for rendering persistent content above the editor, lifecycle events for refresh triggers, and `pi.exec()` for running shell commands. The OpenSpec CLI provides `openspec list --json` and `openspec status --json --change <name>` for programmatic status queries.

The widget must work at any terminal width, adapt between single-change and multi-change layouts, and stay fresh without polling too aggressively.

## Goals / Non-Goals

**Goals:**
- Persistent, glanceable view of all active OpenSpec changes above the pi editor
- Adaptive layout: 3-line detailed view for single change, 1-line-per-change condensed view for multiple
- Auto-refresh on session events, turn end, relevant tool results, and periodic fallback
- Dynamic width: full artifact names in wide terminals, initials in narrow
- Graceful error handling (missing CLI, not an OpenSpec project, CLI errors)
- Published as a git pi package with conventional directory structure

**Non-Goals:**
- Interactive navigation (clicking/selecting changes) — this is a read-only status widget
- Editing artifacts from the widget
- Displaying archived changes
- Displaying specs (only active changes)
- Custom TUI components beyond the widget system (no overlays, no custom editor)

## Decisions

### File architecture

```
extension/
├── index.ts          # Entry point, event wiring, state orchestration
├── openspec.ts       # Data layer: CLI calls, JSON parsing, caching
├── widget.ts         # Presentation: rendering functions, formatting
└── types.ts          # Shared TypeScript types
```

**Rationale**: Follows the plan-mode example's pattern of separating pure utilities from extension logic. The `index.ts` wires events and manages state. `openspec.ts` encapsulates all CLI interaction. `widget.ts` contains pure rendering functions that take data + width → string[]. `types.ts` defines the contract between layers.

### Event refresh strategy

```
session_start ──► fetch (immediate)
turn_end ───────► debounce(500ms) → fetch
agent_end ──────► debounce(500ms) → fetch
tool_result ────► if openspec-related → debounce(500ms) → fetch
interval ───────► every 30s → fetch (only if UI is active)
```

**Debounce**: A shared 500ms debounce timer prevents redundant fetches when multiple events fire close together (e.g., `turn_end` followed immediately by `agent_end`).

**Tool result filtering**: Inspect `event.toolName` and `event.input`:
- `write`/`edit`: check if `event.input.path` starts with `openspec/`
- `bash`: check if `event.input.command` contains `openspec`

**30s fallback**: A `setInterval` running every 30s ensures the widget stays current even if files are modified outside pi (e.g., by another terminal or IDE).

### Widget rendering modes

```
┌─ Single change (3 lines) ──────────────────────────────────────┐
│                                                                 │
│  ◷ my-feature (spec-driven)                                    │
│  Artifacts:  proposal●  design●  specs●  tasks○                │
│  Tasks: ████████░░ 3/7 · apply: tasks                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─ Multiple changes (1 line each) ────────────────────────────────┐
│                                                                 │
│  OpenSpec (2 active)                                            │
│  ◷ my-feature       P● D● S● T○  3/7                          │
│  ✗ bugfix           P● D◌ S○ T○  0/0  (blocked: design, specs)│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Width thresholds** (approximate, driven by available space):

| Width | Artifact format | Progress format |
|-------|----------------|-----------------|
| ≥ 100 cols | Full names with icons | Progress bar (single), counter (multi) |
| < 100 cols | Initials only (P D S T) | Counter only |

Actual thresholds are determined dynamically by measuring rendered line width against available terminal width. If a line with full artifact names exceeds width, fall back to initials.

**Status icons**:
- Overall: ✓ complete (success color), ◷ in-progress (accent), ✗ blocked (warning)
- Artifacts: ● done (success), ○ ready (muted), ◌ blocked (warning)

### Data flow

```
                    ┌──────────────┐
                    │  openspec.ts │
                    │              │
                    │ listChanges()│────► pi.exec("openspec list --json")
                    │              │         │
                    │ status(n)   │────► pi.exec("openspec status --json -c n")
                    └──────┬───────┘
                           │ typed data
                    ┌──────▼───────┐
                    │  index.ts    │
                    │              │
                    │ state mgmt   │────► widget.ts
                    │ event wiring │         │
                    └──────────────┘    ┌────▼────┐
                                        │ render  │
                                        │ funcs   │──► string[]
                                        └─────────┘
                                              │
                                    ctx.ui.setWidget("openspec", lines)
```

### State management

A single `WidgetState` object tracked in `index.ts`:

```typescript
interface WidgetState {
  changes: ChangeSummary[];           // from list --json
  details: Map<string, ChangeDetail>; // from status --json, keyed by name
  error: string | null;               // last CLI error, if any
  lastRefresh: number;                 // Date.now() of last successful fetch
}
```

State updates are synchronous (JSON.parse of CLI output). No async state transitions.

### Cache strategy

`openspec.ts` does NOT cache between calls — each `fetchActiveChanges()` call executes a fresh CLI invocation. The 500ms debounce in `index.ts` is the throttling mechanism. This keeps the data layer simple and stateless.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| `openspec` CLI not on PATH | Check availability on `session_start`, display "not found" message, skip all subsequent fetches. |
| CLI calls are slow (network filesystems?) | The 500ms debounce prevents cascading calls. `pi.exec` has built-in timeouts. |
| `bash` "openspec" matching is imprecise | Accept false positives — extra refreshes are cheap. A false negative (not refreshing when OpenSpec files changed) is mitigated by the 30s fallback. |
| Widget flicker on refresh | `ctx.ui.setWidget` is called with the same string array reference; pi's TUI handles diffing. If needed, cache rendered lines and only update on actual content change. |
| Memory from setInterval | Clear interval on `session_shutdown`. Only set when UI is active (`hasUI`). |
