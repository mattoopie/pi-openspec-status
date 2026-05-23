/**
 * Data layer for OpenSpec CLI interaction.
 * Provides CLI execution wrapper, list/status fetching, and error handling.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ChangeSummary, ChangeDetail } from "./types.ts";

/**
 * Result of a CLI availability check.
 */
export interface CliCheckResult {
	available: boolean;
	reason?: string;
}

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

/**
 * Execute an openspec CLI command and return parsed JSON.
 * Returns null on failure.
 */
async function execOpenSpecJson<T>(
	pi: ExtensionAPI,
	args: string[],
	errorLabel: string,
): Promise<{ data: T | null; error: string | null }> {
	try {
		const result = await pi.exec("openspec", args, {
			timeout: 10000,
		});

		if (result.code !== 0) {
			const errMsg = result.stderr?.trim() || `exit code ${result.code}`;
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
 */
export async function listChanges(
	pi: ExtensionAPI,
): Promise<{ changes: ChangeSummary[]; error: string | null }> {
	const result = await execOpenSpecJson<{ changes: ChangeSummary[] }>(
		pi,
		["list", "--json"],
		"openspec list",
	);

	if (result.error) {
		// Check if this is a "not an OpenSpec project" error
		if (result.error.includes("not found") || result.error.includes("no such file")) {
			return { changes: [], error: null }; // Not an OpenSpec project - no error
		}
		return { changes: [], error: result.error };
	}

	return { changes: result.data?.changes ?? [], error: null };
}

/**
 * Fetch detailed status for a specific change via `openspec status --json`.
 */
export async function getChangeStatus(
	pi: ExtensionAPI,
	name: string,
): Promise<{ detail: ChangeDetail | null; error: string | null }> {
	const result = await execOpenSpecJson<ChangeDetail>(
		pi,
		["status", "--json", "--change", name],
		`openspec status (${name})`,
	);

	if (result.error) {
		return { detail: null, error: result.error };
	}

	return { detail: result.data, error: null };
}

/**
 * Fetch all active changes with their detailed status.
 */
export async function fetchActiveChanges(
	pi: ExtensionAPI,
): Promise<{ changes: ChangeSummary[]; details: Map<string, ChangeDetail>; error: string | null }> {
	// First, get the list of changes
	const { changes, error: listError } = await listChanges(pi);
	if (listError) {
		return { changes: [], details: new Map(), error: listError };
	}

	// Fetch details for each change
	const details = new Map<string, ChangeDetail>();
	let fetchError: string | null = null;

	for (const change of changes) {
		const { detail, error } = await getChangeStatus(pi, change.name);
		if (detail) {
			details.set(change.name, detail);
		} else if (error) {
			fetchError = error;
		}
	}

	return { changes, details, error: fetchError };
}
