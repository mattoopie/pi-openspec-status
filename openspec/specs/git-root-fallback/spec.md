# git-root-fallback Specification

## Purpose
Enable the OpenSpec status widget to detect the `openspec/changes` directory from Pi's session working directory, even when pi is launched from a subdirectory of a git repository, by first checking the session cwd and then falling back to the git repository root. This must not depend on the extension host process cwd.

## Requirements

### Requirement: OpenSpec directory resolution
The extension SHALL resolve the `openspec/changes` directory by first checking the Pi session working directory, then falling back to the git repository root. Resolution commands and OpenSpec CLI commands SHALL use the session cwd or resolved project root, not the extension host process cwd. Resolved paths SHALL be cached per session cwd and reset when that session starts.

#### Scenario: Session cwd has openspec/changes
- **WHEN** the Pi session cwd contains `openspec/changes/`, even if the extension host process cwd is different
- **THEN** the extension uses the session cwd for all resolution commands, OpenSpec CLI invocations, and file reads
- **AND** no git command is executed

#### Scenario: Current working directory lacks openspec/changes but git root has it
- **WHEN** pi is launched from a subdirectory of a git repository
- **AND** the current working directory does not contain `openspec/changes/`
- **AND** the git root directory contains `openspec/changes/`
- **THEN** the extension resolves to the git root and uses `openspec/changes/` from there

#### Scenario: Neither current directory nor git root has openspec/changes
- **WHEN** pi is launched from a directory that does not contain `openspec/changes/`
- **AND** either there is no git repository OR the git root also lacks `openspec/changes/`
- **THEN** the extension behaves as if no OpenSpec project is present (widget does not render)

#### Scenario: Git is not installed
- **WHEN** pi is launched from a subdirectory that does not contain `openspec/changes/`
- **AND** the `git` command is not available on PATH
- **THEN** the extension treats the project as non-existent (same as current behavior when launched from a non-project directory)

#### Scenario: Path is cached for the session cwd
- **WHEN** the resolved `openspec/changes` directory path is determined on first use
- **THEN** subsequent CLI invocations and file reads for that session cwd reuse the cached path without re-checking or re-invoking git
- **AND** a different session cwd uses its own cached resolution

#### Scenario: Session starts again in the same directory
- **WHEN** a new session starts with a cwd that has a cached OpenSpec root
- **THEN** that cwd's cached resolution is cleared and resolved again

### Requirement: CLI commands target the resolved directory
All `openspec` CLI invocations and file reads SHALL use the resolved `openspec/changes` directory as their working directory or path prefix.

#### Scenario: openspec list uses resolved directory
- **WHEN** the extension calls `openspec list --json`
- **THEN** the command runs with the resolved directory as the working directory (via `cwd` option)

#### Scenario: openspec status uses resolved directory
- **WHEN** the extension calls `openspec status --json --change <name>`
- **THEN** the command runs with the resolved directory as the working directory

#### Scenario: tasks.md read uses resolved directory
- **WHEN** the extension reads a change's `tasks.md` file
- **THEN** the file path is constructed as `<resolvedDir>/<changeName>/tasks.md`

### Requirement: Resolution failure is non-disruptive
When the directory resolution fails (no git, not a repo, no `openspec/changes` anywhere), the extension SHALL fall back gracefully to the existing error handling behavior without crashing, hanging, or disrupting the pi session.

#### Scenario: Git command times out
- **WHEN** the `git rev-parse --show-toplevel` command does not complete within the timeout
- **THEN** the extension proceeds as if git is not available and treats the project as non-existent

#### Scenario: Git command returns unexpected output
- **WHEN** `git rev-parse --show-toplevel` succeeds but returns output that is not a valid directory path
- **THEN** the extension treats it as a resolution failure and falls back to the no-project state
