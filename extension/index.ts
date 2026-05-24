/**
 * OpenSpec Status Widget - Pi Coding Agent Extension
 *
 * Displays a persistent TUI widget above the editor showing active OpenSpec changes,
 * artifact completion status, and task progress.
 *
 * Data flow:
 *   openspec CLI -> openspec.ts (data layer) -> index.ts (state + events) -> widget.ts (render)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { WidgetState, TaskGroup } from "./types.ts";
import { fetchActiveChanges, checkCliAvailable } from "./openspec.ts";
import { renderWidget } from "./widget.ts";
import { registerInteractionShortcut } from "./interaction.ts";
import { debounce, arraysEqual } from "./utils.ts";

export default function (pi: ExtensionAPI) {
	// ── State ──────────────────────────────────────────────────────────
	let cliAvailable = false;
	let cliChecked = false;
	let state: WidgetState = {
		changes: [],
		details: new Map(),
		taskGroups: new Map(),
		error: null,
		lastRefresh: 0,
	};

	// Cached rendered lines to avoid unnecessary widget updates
	let cachedLines: string[] | null = null;
	let cachedWidth: number = 0;

	// Interval handle for 30s fallback refresh
	let refreshInterval: ReturnType<typeof setInterval> | null = null;

	/**
	 * Get available terminal width.
	 */
	function getTerminalWidth(): number {
		return process.stdout.columns ?? 80;
	}

	/**
	 * Fetch active changes and update the widget.
	 */
	async function refresh(ctx: import("@earendil-works/pi-coding-agent").ExtensionContext): Promise<void> {
		if (!ctx.hasUI) return;
		if (!cliAvailable) {
			// Show CLI not found message once
			if (cliChecked && cachedLines === null) {
				const theme = ctx.ui.theme;
				const width = getTerminalWidth();
				const lines = [theme.fg("warning", "OpenSpec CLI not found")];
				ctx.ui.setWidget("openspec", lines);
				cachedLines = lines;
				cachedWidth = width;
			}
			return;
		}

		const { changes, details, taskGroups, error } = await fetchActiveChanges(pi);

		// Update state
		state = {
			changes,
			details,
			taskGroups,
			error,
			lastRefresh: Date.now(),
		};

		// Render and update widget
		updateWidget(ctx);
	}

	/**
	 * Render the widget and update the TUI if content changed.
	 */
	function updateWidget(ctx: import("@earendil-works/pi-coding-agent").ExtensionContext): void {
		if (!ctx.hasUI) return;

		const theme = ctx.ui.theme;
		const width = getTerminalWidth();

		const newLines = renderWidget(theme, state.changes, state.details, state.error, width);

		// Cache: only update widget if content actually changed
		if (cachedLines !== null && cachedWidth === width && arraysEqual(cachedLines, newLines)) {
			return;
		}

		cachedLines = newLines;
		cachedWidth = width;
		ctx.ui.setWidget("openspec", newLines);
	}

	// ── Debounced refresh (500ms shared) ──────────────────────────────
	const debouncedRefresh = debounce(
		(ctx: import("@earendil-works/pi-coding-agent").ExtensionContext) => {
			refresh(ctx).catch((err) => {
				console.error("OpenSpec widget refresh error:", err);
			});
		},
		500,
	);

	// ── Tool result handler: check for openspec-related changes ───────
	function isOpenSpecRelated(toolName: string, input: Record<string, unknown>): boolean {
		if (toolName === "write" || toolName === "edit") {
			const path = input.path as string | undefined;
			if (path && (path.startsWith("openspec/") || path.includes("/openspec/"))) {
				return true;
			}
		}
		if (toolName === "bash") {
			const command = input.command as string | undefined;
			if (command && command.includes("openspec")) {
				return true;
			}
		}
		return false;
	}

	// ── Event handlers ────────────────────────────────────────────────

	// session_start: CLI check, initial fetch, render
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		// Show loading state immediately so navigation is not blocked
		const theme = ctx.ui.theme;
		const width = getTerminalWidth();
		const loadingLines = [theme.fg("muted", "OpenSpec: Loading...")];
		ctx.ui.setWidget("openspec", loadingLines);
		cachedLines = loadingLines;
		cachedWidth = width;

		// Start 30s fallback refresh interval immediately
		if (refreshInterval) {
			clearInterval(refreshInterval);
		}
		refreshInterval = setInterval(() => {
			refresh(ctx).catch((err) => {
				console.error("OpenSpec widget interval refresh error:", err);
			});
		}, 30000);

		// Do CLI check and initial data fetch asynchronously so pi can
		// navigate to the session immediately without waiting for results.
		(async () => {
			const cliResult = await checkCliAvailable(pi);
			cliAvailable = cliResult.available;
			cliChecked = true;

			if (!cliAvailable) {
				// Show "CLI not found" message
				const th = ctx.ui.theme;
				const w = getTerminalWidth();
				const lines = [th.fg("warning", "OpenSpec CLI not found")];
				ctx.ui.setWidget("openspec", lines);
				cachedLines = lines;
				cachedWidth = w;
				return;
			}

			await refresh(ctx);
		})().catch((err) => {
			console.error("OpenSpec widget startup error:", err);
		});
	});

	// session_shutdown: clean up
	pi.on("session_shutdown", async (_event, _ctx) => {
		if (refreshInterval) {
			clearInterval(refreshInterval);
			refreshInterval = null;
		}
		debouncedRefresh.cancel();
	});

	// turn_end: debounced refresh
	pi.on("turn_end", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		if (!cliAvailable && cliChecked) return;
		debouncedRefresh(ctx);
	});

	// agent_end: debounced refresh
	pi.on("agent_end", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		if (!cliAvailable && cliChecked) return;
		debouncedRefresh(ctx);
	});

	// tool_result: debounced refresh if openspec-related
	pi.on("tool_result", async (event, ctx) => {
		if (!ctx.hasUI) return;
		if (!cliAvailable && cliChecked) return;
		if (isOpenSpecRelated(event.toolName, event.input as Record<string, unknown>)) {
			debouncedRefresh(ctx);
		}
	});

	// Register interaction shortcut (ctrl+alt+o)
	registerInteractionShortcut(pi);
}
