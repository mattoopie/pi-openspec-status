/**
 * Shared rendering primitives for the OpenSpec Status Widget.
 *
 * Used by both the inline widget (widget.ts) and the interactive overlay (overlay.ts).
 * All functions take a Theme as their first parameter for consistency.
 */

import type { Theme } from "@oh-my-pi/pi-coding-agent";
import type { ChangeSummary, ChangeDetail } from "./types.ts";

/** Max progress bar width in characters */
export const MAX_PROGRESS_BAR_WIDTH = 20;

/**
 * Render a colored artifact icon for the given status.
 */
export function artifactIcon(theme: Theme, status: "done" | "ready" | "blocked"): string {
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
export function changeStatusIcon(theme: Theme, change: ChangeSummary, detail?: ChangeDetail): string {
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
export function progressBar(theme: Theme, completed: number, total: number): string {
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
 * Render artifact portion for multi-change mode or preview.
 * When useFullNames is true, shows full artifact names; otherwise uses initials.
 */
export function renderArtifactPart(theme: Theme, detail: ChangeDetail, useFullNames: boolean): string {
	return detail.artifacts
		.map((a) => {
			const label = useFullNames ? a.id : a.id.charAt(0).toUpperCase();
			const icon = artifactIcon(theme, a.status as "done" | "ready" | "blocked");
			return `${label} ${icon}`;
		})
		.join("   ");
}
