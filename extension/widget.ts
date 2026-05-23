/**
 * Widget rendering functions for the OpenSpec Status Widget.
 * All rendering is theme-aware and width-adaptive.
 */

import type { ChangeSummary, ChangeDetail } from "./types.ts";
import type { Theme } from "@earendil-works/pi-coding-agent";

/** Max progress bar width in characters */
const MAX_PROGRESS_BAR_WIDTH = 20;

/**
 * Get the display width of a string (accounting for ANSI escape codes).
 */
function visibleWidth(str: string): number {
	return str.replace(/\x1b\[[0-9;]*m/g, "").length;
}

/**
 * Truncate a string to fit within maxWidth, adding "…" if truncated.
 */
function truncate(text: string, maxWidth: number): string {
	const width = visibleWidth(text);
	if (width <= maxWidth) return text;
	let result = "";
	for (const char of text) {
		const candidate = result + char;
		if (visibleWidth(candidate) > maxWidth - 1) break;
		result = candidate;
	}
	return result + "…";
}

/**
 * Render a colored artifact icon for the given status.
 */
function artifactIcon(theme: Theme, status: "done" | "ready" | "blocked"): string {
	switch (status) {
		case "done":
			return theme.fg("success", "●");
		case "ready":
			return theme.fg("muted", "○");
		case "blocked":
			return theme.fg("warning", "◌");
	}
}

/**
 * Get overall change status icon.
 */
function changeStatusIcon(theme: Theme, change: ChangeSummary, detail?: ChangeDetail): string {
	if (detail?.isComplete) {
		return theme.fg("success", "✓");
	}
	if (change.status === "blocked" || change.status === "error") {
		return theme.fg("warning", "✗");
	}
	return theme.fg("accent", "◷");
}

/**
 * Build a progress bar string with a max width for the bar portion.
 */
function progressBar(theme: Theme, completed: number, total: number): string {
	if (total === 0) return theme.fg("muted", "—");

	const barWidth = Math.min(MAX_PROGRESS_BAR_WIDTH, Math.max(4, total));
	const fillCount = total > 0 ? Math.round((completed / total) * barWidth) : 0;
	const emptyCount = barWidth - fillCount;

	const fill = theme.fg("accent", "█".repeat(fillCount));
	const empty = theme.fg("muted", "░".repeat(emptyCount));
	const counter = theme.fg("text", ` ${completed}/${total}`);

	return fill + empty + counter;
}

/**
 * Render artifact portion for multi-change mode.
 * When useFullNames is true, shows full artifact names; otherwise uses initials.
 */
function renderArtifactPart(theme: Theme, detail: ChangeDetail, useFullNames: boolean): string {
	return detail.artifacts
		.map((a) => {
			const label = useFullNames ? a.id : a.id.charAt(0).toUpperCase();
			const icon = artifactIcon(theme, a.status as "done" | "ready" | "blocked");
			return `${label} ${icon}`;
		})
		.join(" ");
}

/**
 * Determine whether full artifact names can fit in the available width.
 * Try rendering the line with full names, and if it exceeds width, use initials.
 */
function shouldUseFullNames(
	theme: Theme,
	change: ChangeSummary,
	detail: ChangeDetail,
	availableWidth: number,
	isSingleChange: boolean,
): boolean {
	if (isSingleChange) {
		// For single change, try rendering the artifact line with full names
		const artifactStr = renderArtifactPart(theme, detail, true);
		const line = `Artifacts: ${artifactStr}`;
		return visibleWidth(line) <= availableWidth;
	} else {
		// For multi-change, test a representative line
		const statusIcon = changeStatusIcon(theme, change, detail);
		const name = change.name;
		const artifactStr = renderArtifactPart(theme, detail, true);
		const taskCounter = `${change.completedTasks}/${change.totalTasks}`;
		const line = `${statusIcon} ${name}  ${artifactStr}  ${taskCounter}`;
		return visibleWidth(line) <= availableWidth;
	}
}

/**
 * Render widget for a single active change (3-line detailed layout).
 */
export function renderSingleChange(
	theme: Theme,
	change: ChangeSummary,
	detail: ChangeDetail,
	availableWidth: number,
): string[] {
	const lines: string[] = [];
	const useFullNames = shouldUseFullNames(theme, change, detail, availableWidth, true);

	// Line 1: Status icon + change name + schema
	const statusIcon = changeStatusIcon(theme, change, detail);
	const nameLine = `${statusIcon} ${theme.fg("text", change.name)} ${theme.fg("muted", `(${detail.schemaName})`)}`;
	lines.push(truncate(nameLine, availableWidth));

	// Line 2: Artifact statuses (full names or initials + colored icon)
	const artifactStr = renderArtifactPart(theme, detail, useFullNames);
	lines.push(truncate(theme.fg("muted", "Artifacts: ") + artifactStr, availableWidth));

	// Line 3: Task progress bar + apply hint
	const taskBar = progressBar(theme, change.completedTasks, change.totalTasks);
	const applyHint = detail.applyRequires.length > 0
		? ` · ${theme.fg("muted", `apply: ${detail.applyRequires.join(", ")}`)}`
		: "";
	lines.push(truncate(`${theme.fg("muted", "Tasks: ")}${taskBar}${applyHint}`, availableWidth));

	return lines;
}

/**
 * Render widget for multiple active changes (1 line per change + header).
 */
export function renderMultiChange(
	theme: Theme,
	changes: ChangeSummary[],
	details: Map<string, ChangeDetail>,
	availableWidth: number,
): string[] {
	const lines: string[] = [];

	// Header line
	lines.push(theme.fg("accent", `OpenSpec (${changes.length} active)`));

	for (const change of changes) {
		const detail = details.get(change.name);
		const statusIcon = changeStatusIcon(theme, change, detail);

		// Determine width for change name
		const nameWidth = Math.floor(availableWidth * 0.2);
		const truncatedName = truncate(change.name, nameWidth);

		// Artifact portion: use full names if width permits, initials otherwise
		let artifactPart = "";
		if (detail) {
			const useFullNames = shouldUseFullNames(theme, change, detail, availableWidth, false);
			artifactPart = renderArtifactPart(theme, detail, useFullNames);
		}

		// Task counter
		const taskCounter = theme.fg("text", `${change.completedTasks}/${change.totalTasks}`);

		// Blocked dependency hint
		let blockedHint = "";
		if (detail && !detail.isComplete) {
			const blockedArtifacts = detail.artifacts.filter((a) => a.status === "blocked");
			if (blockedArtifacts.length > 0) {
				blockedHint = ` ${theme.fg("warning", `(blocked: ${blockedArtifacts.map((a) => a.id).join(", ")})`)}`;
			}
		}

		const changeLine = `${statusIcon} ${truncatedName}  ${artifactPart}  ${taskCounter}${blockedHint}`;
		lines.push(truncate(changeLine, availableWidth));
	}

	return lines;
}

/**
 * Render the "no changes" message.
 */
export function renderNoChanges(theme: Theme): string[] {
	return [theme.fg("muted", "No active OpenSpec changes")];
}

/**
 * Render an error state.
 */
export function renderError(theme: Theme, message: string, availableWidth: number): string[] {
	const line = theme.fg("warning", `⚠ ${message}`);
	return [truncate(line, availableWidth)];
}

/**
 * Main render function - selects the appropriate layout based on number of changes.
 */
export function renderWidget(
	theme: Theme,
	changes: ChangeSummary[],
	details: Map<string, ChangeDetail>,
	error: string | null,
	availableWidth: number,
): string[] {
	if (error && changes.length === 0) {
		// Only show error if we have no data to display
		return renderError(theme, error, availableWidth);
	}

	if (changes.length === 0) {
		return renderNoChanges(theme);
	}

	if (changes.length === 1) {
		const detail = details.get(changes[0].name);
		if (detail) {
			return renderSingleChange(theme, changes[0], detail, availableWidth);
		}
		// Fall back to multi-change style for single change without detail
		return renderMultiChange(theme, changes, details, availableWidth);
	}

	return renderMultiChange(theme, changes, details, availableWidth);
}
