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
import type { WidgetState } from "./types.ts";
import { fetchActiveChanges, checkCliAvailable } from "./openspec.ts";
import { renderWidget } from "./widget.ts";

/**
 * Create a debounced version of a function.
 * The debounced function is called after `delay` ms of inactivity.
 */
function debounce<T extends (...args: unknown[]) => void>(
	fn: T,
	delay: number,
): { (...args: Parameters<T>): void; cancel(): void; flush(): void } {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let lastArgs: Parameters<T> | null = null;

	const debounced = (...args: Parameters<T>) => {
		lastArgs = args;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			lastArgs = null;
			fn(...args);
		}, delay);
	};

	debounced.cancel = () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
			lastArgs = null;
		}
	};

	debounced.flush = () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
			const args = lastArgs;
			lastArgs = null;
			if (args) fn(...args);
		}
	};

	return debounced;
}

export default function (pi: ExtensionAPI) {
	// ── State ──────────────────────────────────────────────────────────
	let cliAvailable = false;
	let cliChecked = false;
	let state: WidgetState = {
		changes: [],
		details: new Map(),
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

		const { changes, details, error } = await fetchActiveChanges(pi);

		// Update state
		state = {
			changes,
			details,
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

	/**
	 * Check if two string arrays are equal.
	 */
	function arraysEqual(a: string[], b: string[]): boolean {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (a[i] !== b[i]) return false;
		}
		return true;
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

		// Check CLI availability
		const cliResult = await checkCliAvailable(pi);
		cliAvailable = cliResult.available;
		cliChecked = true;

		if (!cliAvailable) {
			// Show "CLI not found" message immediately
			const theme = ctx.ui.theme;
			const width = getTerminalWidth();
			const lines = [theme.fg("warning", "OpenSpec CLI not found")];
			ctx.ui.setWidget("openspec", lines);
			cachedLines = lines;
			cachedWidth = width;
		} else {
			// Initial data fetch
			await refresh(ctx);
		}

		// Start 30s fallback refresh interval
		if (refreshInterval) {
			clearInterval(refreshInterval);
		}
		refreshInterval = setInterval(() => {
			refresh(ctx).catch((err) => {
				console.error("OpenSpec widget interval refresh error:", err);
			});
		}, 30000);
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
}
