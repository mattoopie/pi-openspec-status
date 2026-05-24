/**
 * OpenSpec Widget Interaction — Shortcut Registration & Orchestration
 *
 * Registers the ctrl+alt+o shortcut that opens the interactive overlay.
 * Handles the orchestration flow: loading overlay → data fetch →
 * change list overlay → action dispatch back to the editor.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import type { ChangeSummary, ChangeDetail, OverlayAction } from "./types.ts";
import { fetchActiveChanges } from "./openspec.ts";
import { LoadingOverlay, OpenSpecOverlay } from "./overlay.ts";

/**
 * Register the ctrl+alt+o shortcut that opens the interactive overlay.
 */
export function registerInteractionShortcut(pi: ExtensionAPI): void {
	pi.registerShortcut(Key.ctrlAlt("o"), {
		description: "Open OpenSpec change list overlay",
		handler: async (ctx) => {
			// Idle check
			if (!ctx.isIdle()) {
				ctx.ui.notify("OpenSpec overlay unavailable: agent is currently processing", "warning");
				return;
			}

			// Show loading state while fetching changes
			const fetchResult = await ctx.ui.custom<{
				changes: ChangeSummary[];
				details: Map<string, ChangeDetail>;
				taskGroups: Map<string, import("./types.ts").TaskGroup[]>;
				error: string | null;
			} | null>(
				(tui, theme, _kb, done) => {
					const loader = new LoadingOverlay(tui, theme, "Loading OpenSpec changes...");
					loader.onAbort = () => done(null);

					fetchActiveChanges(pi)
						.then((result) => done(result))
						.catch(() => done(null));

					return {
						render: (w) => loader.render(w),
						handleInput: (data) => loader.handleInput(data),
						invalidate: () => loader.invalidate(),
					};
				},
				{ overlay: true },
			);

			if (!fetchResult) return;

			const { changes, details, taskGroups, error } = fetchResult;

			// Open the change list overlay
			const actionResult = await ctx.ui.custom<OverlayAction | null>(
				(_tui, theme, _kb, done) => {
					const overlay = new OpenSpecOverlay(changes, details, taskGroups, theme, (action) => done(action), error);
					return {
						render: (w) => overlay.render(w),
						handleInput: (data) => {
							overlay.handleInput(data);
							_tui.requestRender();
						},
						invalidate: () => overlay.invalidate(),
					};
				},
				{ overlay: true },
			);

			// Handle the action result
			if (!actionResult) return;

			switch (actionResult.type) {
				case "apply":
					ctx.ui.setEditorText(`/opsx-apply ${actionResult.changeName}`);
					break;
				case "explore":
					ctx.ui.setEditorText(`/opsx-explore ${actionResult.changeName}`);
					break;
				case "archive":
					ctx.ui.setEditorText(`/opsx-archive ${actionResult.changeName}`);
					break;
				case "propose":
					ctx.ui.setEditorText("/opsx-propose ");
					break;
				case "cancel":
					// No editor change, just close
					break;
			}
		},
	});
}
