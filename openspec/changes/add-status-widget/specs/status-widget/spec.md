## ADDED Requirements

### Requirement: Widget visibility
The extension SHALL display a widget above the pi editor in interactive mode. In non-interactive modes (`-p`, `--json`, RPC without UI), the widget SHALL be suppressed.

#### Scenario: Interactive session starts in OpenSpec project
- **WHEN** pi starts an interactive session in a directory containing `openspec/changes/` with active changes
- **THEN** the widget appears above the editor showing active change status

#### Scenario: No active changes
- **WHEN** pi starts in an OpenSpec project with no active (non-archived) changes
- **THEN** the widget displays a single line: "No active OpenSpec changes"

#### Scenario: Non-interactive mode
- **WHEN** pi runs in print mode (`-p` flag) or JSON mode
- **THEN** the widget does not render

### Requirement: Single change display
When exactly one active change exists, the widget SHALL render three lines showing detailed information.

#### Scenario: Single active change with full artifacts
- **WHEN** one active change named "add-auth" has all artifacts done (proposal, design, specs, tasks) and 3 of 7 tasks completed
- **THEN** line 1 shows the change name, schema name, and an overall status icon (✓ for complete, ◷ for in-progress)
- **AND** line 2 shows each artifact name with a status icon (● done, ○ ready, ◌ blocked), separated by at least one space
- **AND** line 3 shows a task progress bar with completed/total count and the `applyRequires` hint

#### Scenario: Single active change with partial artifacts
- **WHEN** one active change has proposal done, design blocked, specs ready, tasks ready
- **THEN** line 2 shows "proposal● design◌ specs○ tasks○" with appropriate status icons and at least one space between each artifact

### Requirement: Multiple change display
When more than one active change exists, the widget SHALL render each change on a single condensed line with a header line showing the count.

#### Scenario: Two active changes
- **WHEN** two active changes exist ("add-auth" complete with 3/7 tasks, "bugfix" in-progress with 0/0 tasks and blocked design)
- **THEN** line 1 shows a header "OpenSpec (2 active)"
- **AND** line 2 shows for "add-auth": status icon, name, "PDS T" artifact initials with fill indicators, and "3/7" task counter
- **AND** line 3 shows for "bugfix": status icon, name, artifact initials, "0/0" task counter, and blocked dependency hint

#### Scenario: More changes than vertical space
- **WHEN** the number of active changes exceeds available vertical space
- **THEN** all changes are still rendered (the widget scrolls naturally with the TUI)

### Requirement: Artifact status display
Each artifact from the OpenSpec schema SHALL be represented by its full name (single-change mode) or initial letter capitalized (multi-change mode: P=proposal, D=design, S=specs, T=tasks) paired with a status icon.

#### Scenario: Artifact done
- **WHEN** an artifact status is "done"
- **THEN** it displays ● (filled circle) in theme success color

#### Scenario: Artifact ready
- **WHEN** an artifact status is "ready"
- **THEN** it displays ○ (open circle) in theme muted color

#### Scenario: Artifact blocked
- **WHEN** an artifact status is "blocked"
- **THEN** it displays ◌ (dotted circle) in theme warning color

### Requirement: Data refresh
The widget SHALL refresh its display when relevant state changes occur.

#### Scenario: Session start
- **WHEN** the `session_start` event fires
- **THEN** the widget fetches active changes from `openspec list --json` and per-change status from `openspec status --json`

#### Scenario: Agent turn ends
- **WHEN** the `turn_end` event fires
- **THEN** the widget refreshes after a 500ms debounce

#### Scenario: Agent processing ends
- **WHEN** the `agent_end` event fires
- **THEN** the widget refreshes after a 500ms debounce

#### Scenario: Tool writes to openspec directory
- **WHEN** a `tool_result` event indicates a `write` or `edit` tool touched a file under `openspec/`
- **THEN** the widget refreshes after a 500ms debounce

#### Scenario: Bash command mentions openspec
- **WHEN** a `tool_result` event for a `bash` tool contains a command string mentioning "openspec"
- **THEN** the widget refreshes after a 500ms debounce

#### Scenario: Periodic fallback refresh
- **WHEN** 30 seconds have elapsed since the last refresh
- **THEN** the widget refreshes regardless of events

### Requirement: Dynamic width adaptation
The widget SHALL adapt its layout to the available terminal width.

#### Scenario: Wide terminal (≥120 cols)
- **WHEN** the terminal width is 120 columns or more
- **THEN** artifact names are displayed in full (not abbreviated to initials) even in multi-change mode
- **AND** a progress bar is shown in single-change mode

#### Scenario: Narrow terminal (<80 cols)
- **WHEN** the terminal width is below 80 columns
- **THEN** artifact names are abbreviated to initials in all modes
- **AND** the progress bar is replaced with a compact "N/M" counter in single-change mode
- **AND** change names are truncated to fit

### Requirement: Error resilience
The widget SHALL handle error states gracefully without crashing or disrupting the pi session.

#### Scenario: OpenSpec CLI not installed
- **WHEN** the `openspec` command is not available on PATH
- **THEN** the widget displays "OpenSpec CLI not found" on a single line

#### Scenario: Not an OpenSpec project
- **WHEN** the `openspec list --json` command fails because no OpenSpec project is initialized
- **THEN** the widget does not render (no-op)

#### Scenario: CLI invocation fails
- **WHEN** an `openspec` CLI call fails with a non-zero exit code
- **THEN** the widget retains its last known state and displays a muted error indicator
