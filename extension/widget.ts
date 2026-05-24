/**
 * Widget rendering functions for the OpenSpec Status Widget.
 *
 * Composes shared rendering primitives from render-utils.ts into the inline
 * widget layout shown above the editor. All rendering is theme-aware and
 * width-adaptive.
 */

import type { ChangeSummary, ChangeDetail } from "./types.ts";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
	changeStatusIcon,
	renderArtifactPart,
	progressBar,
} from "./render-utils.ts";

/**
 * Determine whether full artifact names can fit in the available width.
 * Try rendering mock lines with full names; if they exceed width, use initials.
 */
function shouldUseFullNames(
	theme: Theme,
	change: ChangeSummary,
	detail: ChangeDetail,
	availableWidth: number,
	isSingleChange: boolean,
): boolean {
	if (isSingleChange) {
		const artifactStr = renderArtifactPart(theme, detail, true);
		const line = `Artifacts: ${artifactStr}`;
		return visibleWidth(line) <= availableWidth;
	} else {
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
	lines.push(truncateToWidth(nameLine, availableWidth, "…"));

	// Line 2: Artifact statuses (full names or initials + colored icon)
	const artifactStr = renderArtifactPart(theme, detail, useFullNames);
	lines.push(truncateToWidth(theme.fg("muted", "Artifacts: ") + artifactStr, availableWidth, "…"));

	// Line 3: Task progress bar (no apply suffix)
	const taskBar = progressBar(theme, change.completedTasks, change.totalTasks);
	lines.push(truncateToWidth(`${theme.fg("muted", "Tasks: ")}${taskBar}`, availableWidth, "…"));

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
		const truncatedName = truncateToWidth(change.name, nameWidth, "…");

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
		lines.push(truncateToWidth(changeLine, availableWidth, "…"));
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
	return [truncateToWidth(line, availableWidth, "…")];
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
		return renderError(theme, error, availableWidth);
	}

	if (changes.length === 0) {
		return renderNoChanges(theme);
	}

	if (changes.length === 1) {
		const detail = details.get(changes[0]!.name);
		if (detail) {
			return renderSingleChange(theme, changes[0]!, detail, availableWidth);
		}
		// Fall back to multi-change style for single change without detail
		return renderMultiChange(theme, changes, details, availableWidth);
	}

	return renderMultiChange(theme, changes, details, availableWidth);
}
