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
	resetOpenSpecDir,
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

	// ── Fallback refresh ──────────────────────────────────────────────
	// Uses recursive setTimeout for adaptive backoff instead of setInterval.
	const FALLBACK_BASE_DELAY = 30_000;   // 30 s initial
	const FALLBACK_BACKOFF_STEP = 30_000; // +30 s per consecutive unchanged check
	const FALLBACK_MAX_DELAY = 120_000;   // 120 s ceiling
	let fallbackTimeout: ReturnType<typeof setTimeout> | null = null;
	let currentFallbackDelay = FALLBACK_BASE_DELAY;

	type RefreshSource = "initial" | "event" | "fallback";
	interface RefreshRequest {
		ctx: import("@earendil-works/pi-coding-agent").ExtensionContext;
		gen: number;
		source: RefreshSource;
		resetBackoff: boolean;
	}
	interface RefreshOutcome {
		changed: boolean;
		successful: boolean;
	}
	interface RefreshCycleResult {
		eventReset: boolean;
	}

	// All refresh sources share one promise. Events arriving during a fetch are
	// coalesced into one follow-up request instead of starting overlapping work.
	let refreshInFlight: Promise<RefreshCycleResult> | null = null;
	let pendingRefresh: RefreshRequest | null = null;

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
	 * Get the width used to render the widget. RPC/web hosts generally pipe
	 * stdout, so they can provide a target width with PI_OPENSPEC_STATUS_WIDTH.
	 */
	function getTerminalWidth(): number {
		const terminalWidth = process.stdout.columns;
		if (typeof terminalWidth === "number" && Number.isSafeInteger(terminalWidth) && terminalWidth > 0) {
			return terminalWidth;
		}

		const configuredWidth = process.env.PI_OPENSPEC_STATUS_WIDTH?.trim();
		if (configuredWidth && /^\d+$/.test(configuredWidth)) {
			const parsedWidth = Number(configuredWidth);
			if (Number.isSafeInteger(parsedWidth) && parsedWidth > 0) {
				return parsedWidth;
			}
		}

		return 120;
	}

	function isCurrentGeneration(gen: number): boolean {
		return !isShutdown && sessionGeneration === gen;
	}

	/**
	 * Fetch active changes and update the widget. This is the uncoordinated
	 * operation; all callers must use requestRefresh() below.
	 */
	async function refresh(
		ctx: import("@earendil-works/pi-coding-agent").ExtensionContext,
		gen: number,
	): Promise<RefreshOutcome> {
		if (!isCurrentGeneration(gen) || !ctx.hasUI) {
			return { changed: false, successful: false };
		}
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
			return { changed: false, successful: false };
		}

		// Fetch the lightweight list first. Detailed status work is only needed
		// when this snapshot differs from the last fully successful refresh.
		const listed = await listChanges(pi, ctx.cwd);
		if (!isCurrentGeneration(gen)) {
			return { changed: false, successful: false };
		}

		if (listed.error) {
			// Keep the last known data visible while exposing the error through the
			// renderer's stale-data indicator.
			state = {
				...state,
				error: listed.error,
			};
			updateWidget(ctx);
			return { changed: false, successful: false };
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
			return { changed: false, successful: true };
		}

		const { details, taskGroups, error } = await fetchChangeDetails(pi, listed.changes, {
			cwd: ctx.cwd,
			includeTaskGroups: false,
		});
		if (!isCurrentGeneration(gen)) {
			return { changed: false, successful: false };
		}

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

		updateWidget(ctx);
		return { changed: true, successful: error === null };
	}

	function queueRefresh(request: RefreshRequest): void {
		if (pendingRefresh === null) {
			pendingRefresh = request;
			return;
		}

		// Keep the newest context/request, but do not lose a relevant OpenSpec
		// event's request to reset fallback backoff.
		pendingRefresh = {
			...request,
			resetBackoff: pendingRefresh.resetBackoff || request.resetBackoff,
		};
	}

	/** Process one refresh and any requests coalesced while it was running. */
	async function processRefreshQueue(first: RefreshRequest): Promise<RefreshCycleResult> {
		let request: RefreshRequest | null = first;
		let eventReset = false;

		while (request !== null) {
			if (!isCurrentGeneration(request.gen)) break;

			let outcome: RefreshOutcome;
			try {
				outcome = await refresh(request.ctx, request.gen);
			} catch (err) {
				console.error("OpenSpec widget refresh error:", err);
				outcome = { changed: false, successful: false };
			}

			if (!isCurrentGeneration(request.gen)) break;

			if (request.source === "fallback" && outcome.successful) {
				if (outcome.changed) {
					currentFallbackDelay = FALLBACK_BASE_DELAY;
				} else {
					currentFallbackDelay = Math.min(
						currentFallbackDelay + FALLBACK_BACKOFF_STEP,
						FALLBACK_MAX_DELAY,
					);
				}
			}

			if (request.source === "event" && request.resetBackoff && outcome.successful) {
				currentFallbackDelay = FALLBACK_BASE_DELAY;
				eventReset = true;
			}

			request = pendingRefresh;
			pendingRefresh = null;
		}

		return { eventReset };
	}

	/**
	 * Start a refresh cycle, or coalesce the request behind the active cycle.
	 */
	function requestRefresh(request: RefreshRequest): Promise<RefreshCycleResult> {
		if (!isCurrentGeneration(request.gen)) {
			return Promise.resolve({ eventReset: false });
		}
		if (refreshInFlight) {
			queueRefresh(request);
			return refreshInFlight;
		}

		const cycle = processRefreshQueue(request);
		refreshInFlight = cycle;
		void cycle.then(() => {
			if (refreshInFlight === cycle) refreshInFlight = null;
		});
		return cycle;
	}

	/**
	 * Schedule the next fallback refresh using the current backoff delay.
	 * Respects session generation, shutdown state, idle state, and the shared
	 * refresh coordinator.
	 */
	function scheduleFallback(
		ctx: import("@earendil-works/pi-coding-agent").ExtensionContext,
		gen: number,
	): void {
		if (fallbackTimeout) clearTimeout(fallbackTimeout);
		fallbackTimeout = setTimeout(() => {
			fallbackTimeout = null;
			if (!isCurrentGeneration(gen)) return;
			if (refreshInFlight) {
				// An event-driven refresh is active; try again after the current
				// cadence rather than queueing a redundant fallback request.
				scheduleFallback(ctx, gen);
				return;
			}
			if (!ctx.isIdle()) {
				// Agent is actively processing — schedule another check without
				// changing the delay.
				scheduleFallback(ctx, gen);
				return;
			}

			const cycle = requestRefresh({
				ctx,
				gen,
				source: "fallback",
				resetBackoff: false,
			});
			void cycle.then(() => {
				if (isCurrentGeneration(gen)) scheduleFallback(ctx, gen);
			});
		}, currentFallbackDelay);
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
	// Keep the reset bit separate from debounce arguments so a relevant
	// tool_result is not accidentally overwritten by a later turn_end event.
	let pendingEventBackoffReset = false;
	const debouncedRefresh = debounce(
		(ctx: import("@earendil-works/pi-coding-agent").ExtensionContext) => {
			const resetBackoff = pendingEventBackoffReset;
			pendingEventBackoffReset = false;
			const gen = sessionGeneration;
			const cycle = requestRefresh({
				ctx,
				gen,
				source: "event",
				resetBackoff,
			});
			void cycle.then((result) => {
				if (result.eventReset && isCurrentGeneration(gen)) {
					scheduleFallback(ctx, gen);
				}
			});
		},
		500,
	);

	function queueDebouncedRefresh(
		ctx: import("@earendil-works/pi-coding-agent").ExtensionContext,
		resetBackoff = false,
	): void {
		pendingEventBackoffReset ||= resetBackoff;
		debouncedRefresh(ctx);
	}

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
		resetOpenSpecDir(ctx.cwd);
		if (!ctx.hasUI) return;

		// Reset shutdown flag and bump the generation counter.
		// Old async work that captured a lower gen value will see
		// sessionGeneration !== gen and bail out after each await.
		isShutdown = false;
		const gen = ++sessionGeneration;
		// Detach any cycle from the previous generation. Its promise may still
		// settle later, but generation checks prevent it from touching this one.
		refreshInFlight = null;
		pendingRefresh = null;
		pendingEventBackoffReset = false;
		cliAvailable = false;
		cliChecked = false;
		state = {
			changes: [],
			details: new Map(),
			taskGroups: new Map(),
			error: null,
		};
		lastSuccessfulFingerprint = null;
		currentFallbackDelay = FALLBACK_BASE_DELAY;

		// Show loading state immediately so navigation is not blocked
		const theme = ctx.ui.theme;
		const width = getTerminalWidth();
		const loadingLines = [theme.fg("muted", "OpenSpec: Loading...")];
		ctx.ui.setWidget("openspec", loadingLines);
		cachedLines = loadingLines;
		cachedWidth = width;

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

			const cycle = requestRefresh({
				ctx,
				gen,
				source: "initial",
				resetBackoff: false,
			});
			await cycle;
			// Start the recursive fallback cycle after the initial refresh cycle,
			// including any event refresh that was coalesced behind it.
			if (isCurrentGeneration(gen)) {
				scheduleFallback(ctx, gen);
			}
		})().catch((err) => {
			console.error("OpenSpec widget startup error:", err);
		});
	});

	// session_shutdown: clean up
	pi.on("session_shutdown", async (_event, _ctx) => {
		if (fallbackTimeout) {
			clearTimeout(fallbackTimeout);
			fallbackTimeout = null;
		}
		debouncedRefresh.cancel();
		pendingEventBackoffReset = false;
		pendingRefresh = null;
		// Detach the active promise from the session. The old operation is not
		// forcibly cancelled, but its generation checks prevent stale updates.
		refreshInFlight = null;
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
		queueDebouncedRefresh(ctx);
	});

	// agent_end: debounced refresh
	pi.on("agent_end", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		if (!cliAvailable && cliChecked) return;
		queueDebouncedRefresh(ctx);
	});

	// tool_result: debounced refresh if openspec-related
	pi.on("tool_result", async (event, ctx) => {
		if (!ctx.hasUI) return;
		if (!cliAvailable && cliChecked) return;
		if (isOpenSpecRelated(event.toolName, event.input as Record<string, unknown>)) {
			queueDebouncedRefresh(ctx, true);
		}
	});

	// Register interaction shortcut (ctrl+alt+o)
	registerInteractionShortcut(pi);
}
