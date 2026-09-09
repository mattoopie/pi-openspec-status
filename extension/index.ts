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
import {
	checkCliAvailable,
	fetchChangeDetails,
	getChangeListFingerprint,
	listChanges,
} from "./openspec.ts";
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
	};

	// The detailed data corresponds to this last fully successful list snapshot.
	// A null value forces the first refresh of each session to fetch details.
	let lastSuccessfulFingerprint: string | null = null;

	// Cached rendered lines to avoid unnecessary widget updates
	let cachedLines: string[] | null = null;
	let cachedWidth: number = 0;

	// Interval handle for 30s fallback refresh
	let refreshInterval: ReturnType<typeof setInterval> | null = null;

	// ── Stale-ctx guards ──────────────────────────────────────────────
	// sessionGeneration: monotonic counter; bumped on every session_start.
	// Old async work compares its captured `gen` against this to detect
	// session replacement — the counter only goes up, never resets.
	//
	// isShutdown: set true in session_shutdown, cleared in session_start.
	// Handles the cross-instance case when pi re-imports the module:
	// the old instance's session_shutdown flips this, and the old IIFE
	// sees it before the new instance's session_start clears it.
	let sessionGeneration = 0;
	let isShutdown = false;

	/**
	 * Get available terminal width.
	 */
	function getTerminalWidth(): number {
		return process.stdout.columns ?? 80;
	}

	/**
	 * Fetch active changes and update the widget.
	 */
	async function refresh(ctx: import("@earendil-works/pi-coding-agent").ExtensionContext, gen?: number): Promise<void> {
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

		// Fetch the lightweight list first. Detailed status work is only needed
		// when this snapshot differs from the last fully successful refresh.
		const listed = await listChanges(pi);
		// Bail if the session was replaced while awaiting the list.
		// `gen` is passed by callers from session_start's async IIFE /
		// interval. Event handlers (turn_end, etc.) pass no gen since
		// their ctx is always fresh.
		if (gen !== undefined && (isShutdown || sessionGeneration !== gen)) return;

		if (listed.error) {
			// Keep the last known data visible when a lightweight check fails,
			// while retaining the existing error state for the renderer.
			state = {
				...state,
				error: listed.error,
			};
			updateWidget(ctx);
			return;
		}

		const fingerprint = getChangeListFingerprint(listed.changes);
		if (fingerprint === lastSuccessfulFingerprint) {
			// A successful list check can clear a transient previous list error,
			// but it must not replace the cached detailed data.
			if (state.error !== null) {
				state = {
					...state,
					error: null,
				};
			}
			updateWidget(ctx);
			return;
		}

		const { details, taskGroups, error } = await fetchChangeDetails(pi, listed.changes, {
			includeTaskGroups: false,
		});
		// Bail if the session was replaced while awaiting detailed data.
		if (gen !== undefined && (isShutdown || sessionGeneration !== gen)) return;

		state = {
			changes: listed.changes,
			details,
			taskGroups,
			error,
		};

		// Do not cache a snapshot whose detailed fetch failed. Keeping the old
		// fingerprint causes the next refresh to retry the status requests.
		if (error === null) {
			lastSuccessfulFingerprint = fingerprint;
		}

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

		// Reset shutdown flag and bump the generation counter.
		// Old async work that captured a lower gen value will see
		// sessionGeneration !== gen and bail out after each await.
		isShutdown = false;
		const gen = ++sessionGeneration;
		lastSuccessfulFingerprint = null;

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
			// Bail if the session was replaced since this interval started.
			if (isShutdown || sessionGeneration !== gen) return;
			refresh(ctx, gen).catch((err) => {
				console.error("OpenSpec widget interval refresh error:", err);
			});
		}, 30000);

		// Do CLI check and initial data fetch asynchronously so pi can
		// navigate to the session immediately without waiting for results.
		(async () => {
			const cliResult = await checkCliAvailable(pi);
			// Bail if the session was replaced while awaiting the CLI check
			if (isShutdown || sessionGeneration !== gen) return;

			cliAvailable = cliResult.available;
			cliChecked = true;

			if (!cliAvailable) {
				// Show "CLI not found" message
				if (isShutdown || sessionGeneration !== gen) return;
				const th = ctx.ui.theme;
				const w = getTerminalWidth();
				const lines = [th.fg("warning", "OpenSpec CLI not found")];
				ctx.ui.setWidget("openspec", lines);
				cachedLines = lines;
				cachedWidth = w;
				return;
			}

			await refresh(ctx, gen);
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
		// Signal to any in-progress async work that this session is done.
		// For same-closure session replacements (e.g. /reload), the next
		// session_start clears this. For cross-instance replacements, the
		// old IIFE sees this before the new instance clears it.
		isShutdown = true;
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
