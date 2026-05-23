## 1. Data layer

- [x] 1.1 Create `extension/types.ts` with shared type definitions (`ChangeSummary`, `ChangeDetail`, `ArtifactStatus`, `WidgetState`)
- [x] 1.2 Create `extension/openspec.ts` with `execOpenSpec()` wrapper using `pi.exec`
- [x] 1.3 Implement `listChanges()` calling `openspec list --json` and parsing the response
- [x] 1.4 Implement `getChangeStatus(name)` calling `openspec status --json --change <name>` and parsing the response
- [x] 1.5 Add CLI availability check (graceful "CLI not found" handling)

## 2. Widget rendering

- [x] 2.1 Create `extension/widget.ts` with theme-aware rendering functions
- [x] 2.2 Implement `renderSingleChange()` for 3-line detailed single-change layout with artifact names, status icons, progress bar
- [x] 2.3 Implement `renderMultiChange()` for 1-line-per-change condensed layout with artifact initials, counters
- [x] 2.4 Implement `renderNoChanges()` for the "No active OpenSpec changes" message
- [x] 2.5 Implement `renderError()` for error states (CLI not found, fetch failure)
- [x] 2.6 Implement dynamic width adaptation: full artifact names above threshold, initials below
- [x] 2.7 Ensure at least one space between each artifact and its icon in all layouts

## 3. Extension entry point and event wiring

- [x] 3.1 Create `extension/index.ts` with default export factory function
- [x] 3.2 Implement `session_start` handler: check CLI availability, initial data fetch, render widget
- [x] 3.3 Implement `turn_end` handler: debounced (500ms) refresh
- [x] 3.4 Implement `agent_end` handler: debounced (500ms) refresh
- [x] 3.5 Implement `tool_result` handler: refresh when write/edit touches `openspec/` path or bash command contains "openspec"
- [x] 3.6 Implement 30s fallback refresh interval (start on session_start, clear on session_shutdown)
- [x] 3.7 Implement 500ms shared debounce across all event-driven refresh triggers
- [x] 3.8 Suppress widget in non-interactive mode (`!ctx.hasUI`)
- [x] 3.9 Implement `session_shutdown` handler: clear interval, clean up

## 4. Polish and robustness

- [x] 4.1 Handle non-OpenSpec project gracefully (no widget, no error)
- [x] 4.2 Handle CLI execution failures (retain last known state, show muted error indicator)
- [x] 4.3 Cache rendered lines and only update widget when content actually changes (avoid unnecessary TUI re-renders)
- [ ] 4.4 Test with various OpenSpec change states (no tasks, complete, partial artifacts, multiple schemas)
- [x] 4.5 Verify package.json `pi.extensions` field points to `./extension/index.ts`
