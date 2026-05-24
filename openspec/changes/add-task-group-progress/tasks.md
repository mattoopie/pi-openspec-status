## 1. Types and data model

- [x] 1.1 Add `TaskGroup` interface to `extension/types.ts` with fields: `name: string`, `completed: number`, `total: number`, `status: 'complete' | 'partial' | 'none' | 'empty'`
- [x] 1.2 Add `taskGroups` field to `WidgetState` interface in `extension/types.ts`: `taskGroups: Map<string, TaskGroup[]>`

## 2. Task group parser

- [x] 2.1 Create `extension/tasks-parser.ts` with `parseTaskGroups(content: string): TaskGroup[]` function
- [x] 2.2 Implement `##` heading detection to identify group boundaries
- [x] 2.3 Implement per-group checkbox counting (`- [x]` vs `- [ ]`) within each heading section
- [x] 2.4 Derive per-group `status` from completed/total counts (`complete`, `partial`, `none`, `empty`)
- [x] 2.5 Handle edge cases: pre-heading content (skip), empty file (return `[]`), no `##` headings at all (return `[]`), parse errors (catch + return `[]`)

## 3. Data fetching integration

- [x] 3.1 Add `fetchTaskGroups(changeDir: string): TaskGroup[]` to `extension/openspec.ts` that reads `tasks.md` from the change directory and calls the parser
- [x] 3.2 Wrap the call in try/catch; return empty array on any failure (file missing, read error, parse error)
- [x] 3.3 Integrate into `fetchActiveChanges()` — populate `taskGroups` alongside `details` in the returned map
- [x] 3.4 Store result in `WidgetState.taskGroups` during the `refresh()` function in `index.ts`

## 4. Widget: remove apply suffix

- [x] 4.1 In `extension/widget.ts` `renderSingleChange()`, remove the `applyHint` variable and its interpolation on line 3
- [x] 4.2 Line 3 should render as `Tasks: <progressBar>` with no suffix

## 5. Overlay: task group rendering

- [x] 5.1 In `extension/overlay.ts` `renderPreviewPane()`, remove the `applyHint` construction
- [x] 5.2 Create a new helper `renderTaskGroups(th: Theme, groups: TaskGroup[], innerW: number): string[]` that renders each group on a line: `  icon groupName: completed/total` (or `icon groupName: — no tasks` for empty groups)
- [x] 5.3 In `renderPreviewPane()`, check for task group data: if groups present and non-empty, call `renderTaskGroups`; otherwise render the flat fallback line `Tasks: <progressBar>` (no apply suffix)
- [x] 5.4 Update `OpenSpecOverlay` constructor to accept task group data alongside existing `details` parameter
- [x] 5.5 Pass `taskGroups` from `interaction.ts` through to the `OpenSpecOverlay` constructor

## 6. Verify and polish

- [x] 6.1 Manually test with an active change that has tasks.md with multiple `##` groups — verify group breakdown appears in overlay preview
- [x] 6.2 Test with an active change that has tasks.md but no `##` headings — verify flat fallback renders
- [x] 6.3 Test with no active changes — verify empty state still works
- [x] 6.4 Test widget in narrow terminals (<80 cols) — verify no regressions from removing apply suffix
- [x] 6.5 Verify overlay scrolled view works with additional group lines
