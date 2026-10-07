/**
 * Data layer for OpenSpec CLI interaction.
 * Provides CLI execution wrapper, list/status fetching, and error handling.
 */

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ChangeSummary, ChangeDetail, TaskGroup } from "./types.ts";
import { parseTaskGroups } from "./tasks-parser.ts";

/**
 * Result of a CLI availability check.
 */
export interface CliCheckResult {
	available: boolean;
	reason?: string;
}

// ── Directory resolution ──────────────────────────────────────────────

/**
 * Cache project-root lookups by Pi session cwd so one project's root cannot
 * leak into another session hosted by the same process.
 */
const _openSpecDirs = new Map<string, Promise<string | null>>();

async function hasOpenSpecChanges(root: string): Promise<boolean> {
	try {
		return (await stat(join(root, "openspec", "changes"))).isDirectory();
	} catch {
		// Missing or inaccessible directories are not OpenSpec projects.
		return false;
	}
}

/**
 * Resolve the OpenSpec project root directory by checking:
 * 1. Current working directory (fast path)
 * 2. Git repository root (fallback)
 *
 * Returns the absolute path to the project root (containing `openspec/changes/`)
 * or null if neither location has `openspec/changes/`.
 *
 * Error handling:
 * - If `git rev-parse` fails (not installed, not a repo, timeout): returns null
 * - If git succeeds but git root lacks `openspec/changes/`: returns null
 */
export async function resolveOpenSpecDir(pi: ExtensionAPI, cwd: string): Promise<string | null> {
	// Step 1: Check the Pi session working directory, not the server process cwd.
	if (await hasOpenSpecChanges(cwd)) {
		return cwd;
	}

	// Step 2: Git root fallback
	try {
		const gitResult = await pi.exec("git", ["rev-parse", "--show-toplevel"], { timeout: 5000, cwd });
		if (gitResult.code === 0) {
			const gitRoot = gitResult.stdout?.trim();
			if (gitRoot) {
				// Validate that openspec/changes exists at the git root
				if (await hasOpenSpecChanges(gitRoot)) {
					return gitRoot;
				}
			}
		}
	} catch {
		// Git command failed (not installed, not a repo, timeout, etc.)
		// Fall through to return null
	}

	// No valid project root found
	return null;
}

/**
 * Get the cached OpenSpec project root directory.
 * On first call, resolves lazily and caches the result.
 * Subsequent calls return the cached value immediately (sync, no I/O).
 *
 * Returns the absolute path to the project root (containing `openspec/changes/`)
 * or null if no OpenSpec project is found.
 */
export async function getOpenSpecDir(pi: ExtensionAPI, cwd: string): Promise<string | null> {
	let lookup = _openSpecDirs.get(cwd);
	if (!lookup) {
		lookup = resolveOpenSpecDir(pi, cwd);
		_openSpecDirs.set(cwd, lookup);
	}
	return lookup;
}

/**
 * Reset one session cwd's cached directory, or clear all cached directories.
 */
export function resetOpenSpecDir(cwd?: string): void {
	if (cwd === undefined) {
		_openSpecDirs.clear();
	} else {
		_openSpecDirs.delete(cwd);
	}
}

// ── CLI check ─────────────────────────────────────────────────────────

/**
 * Check if the `openspec` CLI is available on PATH.
 */
export async function checkCliAvailable(pi: ExtensionAPI): Promise<CliCheckResult> {
	try {
		const result = await pi.exec("openspec", ["--help"], {
			timeout: 5000,
		});
		if (result.code !== 0) {
			return { available: false, reason: result.stderr?.trim() || "CLI returned non-zero exit code" };
		}
		return { available: true };
	} catch (err) {
		return { available: false, reason: err instanceof Error ? err.message : String(err) };
	}
}

// ── CLI execution ─────────────────────────────────────────────────────

/**
 * Execute an openspec CLI command and return parsed JSON.
 * Returns null on failure.
 *
 * @param cwd - Working directory for the Pi session.
 */
async function execOpenSpecJson<T>(
	pi: ExtensionAPI,
	args: string[],
	errorLabel: string,
	cwd: string,
): Promise<{ data: T | null; error: string | null }> {
	try {
		const result = await pi.exec("openspec", args, {
			timeout: 10000,
			cwd,
		});

		if (result.code !== 0) {
			// Some CLI diagnostics (including OpenSpec project-root errors) are
			// written to stdout rather than stderr. Preserve both for the widget.
			const output = [result.stdout?.trim(), result.stderr?.trim()].filter(Boolean).join("\n");
			const errMsg = output || `exit code ${result.code}`;
			return { data: null, error: `${errorLabel}: ${errMsg}` };
		}

		// stdout may contain ANSI or extra output; try to find JSON payload
		const stdout = result.stdout?.trim() || "";
		// Try parsing entire output as JSON first
		try {
			const parsed = JSON.parse(stdout) as T;
			return { data: parsed, error: null };
		} catch {
			// If not pure JSON, try to extract JSON from the output
			const jsonMatch = stdout.match(/\{[\s\S]*\}/);
			if (jsonMatch) {
				try {
					const parsed = JSON.parse(jsonMatch[0]) as T;
					return { data: parsed, error: null };
				} catch {
					// fall through
				}
			}
			return { data: null, error: `${errorLabel}: could not parse CLI output` };
		}
	} catch (err) {
		return { data: null, error: `${errorLabel}: ${err instanceof Error ? err.message : String(err)}` };
	}
}

/**
 * Fetch all active (non-archived) changes via `openspec list --json`.
 * Uses the resolved OpenSpec project directory (with git root fallback)
 * so this works from any subdirectory of a git repository.
 */
export async function listChanges(
	pi: ExtensionAPI,
	cwd: string,
): Promise<{ changes: ChangeSummary[]; error: string | null }> {
	const dir = await getOpenSpecDir(pi, cwd);
	if (!dir) {
		return { changes: [], error: null };
	}

	const result = await execOpenSpecJson<{ changes: ChangeSummary[] }>(
		pi,
		["list", "--json"],
		"openspec list",
		dir,
	);

	if (result.error) {
		return { changes: [], error: result.error };
	}

	return { changes: result.data?.changes ?? [], error: null };
}

/**
 * Fetch detailed status for a specific change via `openspec status --json`.
 * Uses the resolved OpenSpec project directory (with git root fallback)
 * so this works from any subdirectory of a git repository.
 */
export async function getChangeStatus(
	pi: ExtensionAPI,
	name: string,
	cwd: string,
): Promise<{ detail: ChangeDetail | null; error: string | null }> {
	const dir = await getOpenSpecDir(pi, cwd);
	const result = await execOpenSpecJson<ChangeDetail>(
		pi,
		["status", "--json", "--change", name],
		`openspec status (${name})`,
		dir ?? cwd,
	);

	if (result.error) {
		return { detail: null, error: result.error };
	}

	return { detail: result.data, error: null };
}

/**
 * Fetch task group data from a change's tasks.md file.
 * Reads the file from the change directory, parses it, and returns
 * the extracted task groups. Returns an empty array on any failure
 * (file missing, read error, parse error).
 *
 * @param pi — ExtensionAPI used to resolve the OpenSpec project directory
 * @param changeName — Name of the change (used to locate change dir)
 * @returns Parsed TaskGroup array (empty on any failure)
 */
export async function fetchTaskGroups(
	pi: ExtensionAPI,
	changeName: string,
	cwd: string,
): Promise<TaskGroup[]> {
	try {
		const dir = await getOpenSpecDir(pi, cwd);
		const filePath = join(dir ?? cwd, "openspec", "changes", changeName, "tasks.md");
		const content = await readFile(filePath, "utf8");

		if (!content.trim()) return [];

		return parseTaskGroups(content);
	} catch {
		return [];
	}
}

/**
 * Create a stable fingerprint for the lightweight change-list snapshot.
 *
 * The CLI is free to return changes in a different order on each invocation,
 * so entries are sorted by name before serialization. Summary fields are
 * included in addition to lastModified because they provide useful change
 * detection when a timestamp is not updated as expected.
 */
export function getChangeListFingerprint(changes: ChangeSummary[]): string {
	const entries = changes
		.map((change) => ({
			name: change.name,
			lastModified: change.lastModified,
			completedTasks: change.completedTasks,
			totalTasks: change.totalTasks,
			status: change.status,
		}))
		.sort((a, b) => {
			if (a.name < b.name) return -1;
			if (a.name > b.name) return 1;

			// Names should be unique, but keep duplicate-name ordering stable too.
			const aSerialized = JSON.stringify(a) ?? "";
			const bSerialized = JSON.stringify(b) ?? "";
			if (aSerialized < bSerialized) return -1;
			if (aSerialized > bSerialized) return 1;
			return 0;
		});

	return JSON.stringify(entries) ?? "[]";
}

/**
 * Fetch detailed status and, optionally, task group data for a known list of
 * active changes. The list is passed in so callers can avoid repeating the
 * detailed work when only the lightweight snapshot was checked.
 */
export interface FetchActiveChangesOptions {
	/** Pi session working directory (distinct from process.cwd() in hosted runtimes). */
	cwd: string;
	/** Fetch task groups from each change's tasks.md file. */
	includeTaskGroups?: boolean;
}

export interface FetchChangeDetailsResult {
	details: Map<string, ChangeDetail>;
	taskGroups: Map<string, TaskGroup[]>;
	error: string | null;
}

export async function fetchChangeDetails(
	pi: ExtensionAPI,
	changes: ChangeSummary[],
	options: FetchActiveChangesOptions,
): Promise<FetchChangeDetailsResult> {
	const includeTaskGroups = options.includeTaskGroups === true;

	// Fetch each change independently so status requests can run concurrently.
	// Task-group reads are optional and run alongside the status request when enabled.
	const results = await Promise.all(
		changes.map(async (change) => {
			const [{ detail, error }, groups] = await Promise.all([
				getChangeStatus(pi, change.name, options.cwd),
				includeTaskGroups ? fetchTaskGroups(pi, change.name, options.cwd) : Promise.resolve([] as TaskGroup[]),
			]);

			return { change, detail, error, groups };
		}),
	);

	const details = new Map<string, ChangeDetail>();
	const taskGroups = new Map<string, TaskGroup[]>();
	let fetchError: string | null = null;

	// Promise.all preserves the input order, so selecting the first error here is
	// deterministic even when requests complete in a different order.
	for (const { change, detail, error, groups } of results) {
		if (detail) {
			details.set(change.name, detail);
		} else if (!fetchError && error) {
			fetchError = error;
		}

		// Keep the return shape stable while avoiding task-group entries on the
		// background path, where task groups were not requested.
		if (includeTaskGroups) {
			taskGroups.set(change.name, groups);
		}
	}

	return { details, taskGroups, error: fetchError };
}

/**
 * Fetch all active changes with their detailed status and task group data.
 * This wrapper keeps the existing API used by the interactive overlay.
 */
export async function fetchActiveChanges(
	pi: ExtensionAPI,
	options: FetchActiveChangesOptions,
): Promise<{
	changes: ChangeSummary[];
	details: Map<string, ChangeDetail>;
	taskGroups: Map<string, TaskGroup[]>;
	error: string | null;
}> {
	// First, get the list of changes.
	const { changes, error: listError } = await listChanges(pi, options.cwd);
	if (listError) {
		return { changes: [], details: new Map(), taskGroups: new Map(), error: listError };
	}

	return {
		changes,
		...(await fetchChangeDetails(pi, changes, options)),
	};
}
