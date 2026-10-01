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
 * Determine whether full artifact names fit on the single-change artifact line.
 */
function shouldUseFullNames(theme: Theme, detail: ChangeDetail, availableWidth: number): boolean {
	const artifactStr = renderArtifactPart(theme, detail, true);
	return visibleWidth(`Artifacts: ${artifactStr}`) <= availableWidth;
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
	const useFullNames = shouldUseFullNames(theme, detail, availableWidth);

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
	lines.push(truncateToWidth(theme.fg("accent", `OpenSpec (${changes.length} active)`), availableWidth, "…"));

	// Align artifact columns, but size the name cell to the longest displayed
	// name rather than reserving the full maximum width for every change.
	const maxNameWidth = Math.max(1, Math.floor(availableWidth * 0.35));
	const displayedNames = changes.map((change) => truncateToWidth(change.name, maxNameWidth, "…"));
	const nameWidth = Math.max(1, ...displayedNames.map(visibleWidth));
	const rows = changes.map((change, index) => {
		const detail = details.get(change.name);
		const statusIcon = changeStatusIcon(theme, change, detail);
		const truncatedName = displayedNames[index]!;
		const paddedName = truncatedName + " ".repeat(Math.max(0, nameWidth - visibleWidth(truncatedName)));
		const taskCounter = theme.fg("text", `${change.completedTasks}/${change.totalTasks}`);

		let blockedHint = "";
		if (detail && !detail.isComplete) {
			const blockedArtifacts = detail.artifacts.filter((a) => a.status === "blocked");
			if (blockedArtifacts.length > 0) {
				blockedHint = ` ${theme.fg("warning", `(blocked: ${blockedArtifacts.map((a) => a.id).join(", ")})`)}`;
			}
		}

		return {
			detail,
			rowPrefix: `${statusIcon} ${paddedName}  `,
			taskCounter,
			blockedHint,
		};
	});

	// Decide once for the whole list, using the actual truncated/padded name
	// cells and every row's counter and blocked hint. This prevents mixed labels.
	const fullNamesFit = rows.every(({ detail, rowPrefix, taskCounter, blockedHint }) => {
		const artifactPart = detail ? renderArtifactPart(theme, detail, true) : "";
		return visibleWidth(`${rowPrefix}${artifactPart}  ${taskCounter}${blockedHint}`) <= availableWidth;
	});

	for (const { detail, rowPrefix, taskCounter, blockedHint } of rows) {
		const artifactPart = detail ? renderArtifactPart(theme, detail, fullNamesFit) : "";
		const changeLine = `${rowPrefix}${artifactPart}  ${taskCounter}${blockedHint}`;
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
 * Prefix retained data with a visible warning when a refresh failed. Keeping
 * the indicator on the first existing line preserves the widget's height.
 */
function addStaleIndicator(
	theme: Theme,
	lines: string[],
	message: string,
	availableWidth: number,
): string[] {
	if (lines.length === 0) return renderError(theme, message, availableWidth);
	const indicator = theme.fg("warning", `⚠ ${message}`);
	return [truncateToWidth(`${indicator} ${lines[0]}`, availableWidth, "…"), ...lines.slice(1)];
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

	let lines: string[];
	if (changes.length === 1) {
		const detail = details.get(changes[0]!.name);
		if (detail) {
			lines = renderSingleChange(theme, changes[0]!, detail, availableWidth);
		} else {
			// Fall back to multi-change style for single change without detail
			lines = renderMultiChange(theme, changes, details, availableWidth);
		}
	} else {
		lines = renderMultiChange(theme, changes, details, availableWidth);
	}

	return error ? addStaleIndicator(theme, lines, error, availableWidth) : lines;
}
