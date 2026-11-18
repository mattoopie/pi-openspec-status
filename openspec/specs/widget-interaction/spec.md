# widget-interaction Specification

## Purpose
Allowing the user to interact with openspec through the pi UI instead of having to type commands.
## Requirements
### Requirement: Shortcut opens interactive overlay
The extension SHALL register a keyboard shortcut that, when pressed while the agent is idle, opens an interactive overlay listing active OpenSpec changes.

#### Scenario: Shortcut pressed while agent is idle
- **WHEN** the user presses `ctrl+alt+o` and no agent turn is in progress
- **THEN** an overlay appears showing the list of active changes with one change selected

#### Scenario: Shortcut pressed while agent is processing
- **WHEN** the user presses `ctrl+alt+o` and an agent turn is in progress
- **THEN** the overlay does NOT open and a notification informs the user the action is unavailable

### Requirement: Overlay displays change list
The overlay SHALL display all active (non-archived) changes. Each change SHALL show its status icon, name, artifact initials with completion indicators, and task counter.

#### Scenario: Multiple active changes
- **WHEN** two active changes exist ("add-auth" and "fix-login")
- **THEN** the overlay lists both changes, each on its own line, with the first change pre-selected

#### Scenario: Single active change
- **WHEN** exactly one active change exists
- **THEN** the overlay lists the change as the sole entry, pre-selected, with arrow keys being no-ops

#### Scenario: No active changes (empty state)
- **WHEN** no active changes exist
- **THEN** the overlay displays "No active OpenSpec changes"
- **AND** only the `p` (propose) action is available
- **AND** all other action keys are shown in muted style

### Requirement: Arrow key navigation
The user SHALL navigate the change list using the up and down arrow keys. The selected change SHALL be visually highlighted.

#### Scenario: Arrow down moves selection
- **WHEN** the overlay is open with multiple changes and the first change is selected
- **THEN** pressing down arrow moves the selection highlight to the second change

#### Scenario: Arrow up moves selection
- **WHEN** the overlay is open and the second change is selected
- **THEN** pressing up arrow moves the selection highlight to the first change

#### Scenario: Arrow up at top does not wrap
- **WHEN** the first change is selected
- **THEN** pressing up arrow keeps the selection on the first change (no wrap)

#### Scenario: Arrow down at bottom does not wrap
- **WHEN** the last change is selected
- **THEN** pressing down arrow keeps the selection on the last change (no wrap)

### Requirement: Preview pane for selected change
The overlay SHALL display a preview pane showing detailed information about the currently selected change, including schema name, artifact statuses with full names, and task progress bar.

#### Scenario: Preview pane shows selected change details
- **WHEN** a change is selected in the overlay
- **THEN** the preview pane shows the change name, schema name, artifact statuses with full names and colored icons
- **AND** the preview pane shows task group progress when task group data is available, with each group on its own line showing the group name, completion count, and a status icon (● complete, ◷ partial, ○ not started)
- **AND** the preview pane falls back to a flat task progress bar with completed/total count when task group data is unavailable

#### Scenario: Preview pane updates on selection change
- **WHEN** the user navigates from one change to another
- **THEN** the preview pane updates to show details for the newly selected change

### Requirement: Letter key actions on selected change
The user SHALL invoke OpenSpec skills by pressing a single letter key while the overlay is open. The verify action key SHALL only be active when the `skill:openspec-verify-change` skill command is registered in the current pi session (detected via `pi.getCommands()`).

#### Scenario: Apply action on selected change
- **WHEN** the user presses `a` while a change is selected
- **THEN** the overlay closes and the editor is pre-filled with `/skill:openspec-apply-change <change-name>`

#### Scenario: Verify action on selected change when available
- **WHEN** the user presses `v` while a change is selected AND `skill:openspec-verify-change` is registered via `pi.getCommands()`
- **THEN** the overlay closes and the editor is pre-filled with `/skill:openspec-verify-change <change-name>`

#### Scenario: Verify key ignored when not available
- **WHEN** the user presses `v` while a change is selected AND `skill:openspec-verify-change` is NOT registered
- **THEN** the keypress is ignored (no action taken, overlay remains open)

#### Scenario: Explore action on selected change
- **WHEN** the user presses `e` while a change is selected
- **THEN** the overlay closes and the editor is pre-filled with `/skill:openspec-explore <change-name>`

#### Scenario: Archive action on selected change
- **WHEN** the user presses `c` while a change is selected
- **THEN** the overlay closes and the editor is pre-filled with `/skill:openspec-archive-change <change-name>`

### Requirement: Propose action always available
The propose action SHALL be available regardless of whether a change is selected or whether any changes exist.

#### Scenario: Propose with no active changes
- **WHEN** the user presses `p` while the overlay shows the empty state
- **THEN** the overlay closes and the editor is pre-filled with `/skill:openspec-propose ` (blank change name, cursor positioned for the user to type)

#### Scenario: Propose with active changes
- **WHEN** the user presses `p` while a change is selected
- **THEN** the overlay closes and the editor is pre-filled with `/skill:openspec-propose ` (blank, ignoring the current selection)

### Requirement: Escape cancels overlay
The user SHALL dismiss the overlay without taking any action by pressing `escape`.

#### Scenario: Escape closes overlay
- **WHEN** the overlay is open
- **THEN** pressing `escape` closes the overlay
- **AND** the editor content is unchanged

### Requirement: Overlay closes after action
After triggering an action, the overlay SHALL close and keyboard focus SHALL return to the editor.

#### Scenario: Action closes overlay and returns focus
- **WHEN** the user presses any action key (`a`, `e`, `c`, or `p`)
- **THEN** the overlay closes immediately
- **AND** the editor receives keyboard focus
- **AND** the editor contains the pre-filled prompt template text

### Requirement: Action hints displayed
The overlay SHALL display a hint bar showing available action keys and their functions. The verify hint SHALL only appear when the `skill:openspec-verify-change` skill command is registered (detected via `pi.getCommands()`).

#### Scenario: Full hint bar with changes (verify available)
- **WHEN** the overlay is open, active changes exist, AND `skill:openspec-verify-change` is registered
- **THEN** the hint bar shows "a apply · v verify · e explore · c archive · p propose new · esc cancel"

#### Scenario: Full hint bar with changes (verify unavailable)
- **WHEN** the overlay is open, active changes exist, AND `skill:openspec-verify-change` is NOT registered
- **THEN** the hint bar shows "a apply · e explore · c archive · p propose new · esc cancel"

#### Scenario: Empty state hint bar
- **WHEN** the overlay is open and no active changes exist
- **THEN** the hint bar shows "p propose new · esc cancel" with other action labels shown in muted/dim style

### Requirement: Data is fetched on overlay open
The overlay SHALL fetch fresh change data when it opens, using the same data layer and resolved directory path as the status widget.

#### Scenario: Fresh data on open
- **WHEN** the overlay opens
- **THEN** it calls `fetchActiveChanges()` to get the current state of all changes, using the resolved `openspec/changes` directory (current working directory or git root fallback)
- **AND** displays the result (or an error indicator if the CLI fails)

