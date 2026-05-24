/**
 * Shared type definitions for the OpenSpec Status Widget extension.
 */

/** Represents a task group parsed from tasks.md */
export interface TaskGroup {
	name: string;
	completed: number;
	total: number;
	status: "complete" | "partial" | "none" | "empty";
}

/** Represents an artifact in an OpenSpec change */
export interface ArtifactStatus {
	id: string;
	status: "done" | "ready" | "blocked";
}

/** Summary of a change from `openspec list --json` */
export interface ChangeSummary {
	name: string;
	completedTasks: number;
	totalTasks: number;
	lastModified: string;
	status: string;
}

/** Detailed change info from `openspec status --json --change <name>` */
export interface ChangeDetail {
	changeName: string;
	schemaName: string;
	isComplete: boolean;
	applyRequires: string[];
	artifacts: ArtifactStatus[];
}

/** The overall widget state managed by the extension */
export interface WidgetState {
	changes: ChangeSummary[];
	details: Map<string, ChangeDetail>;
	taskGroups: Map<string, TaskGroup[]>;
	error: string | null;
	lastRefresh: number;
}

/** Action dispatched from the interactive overlay to the shortcut handler */
export type OverlayAction =
	| { type: "apply"; changeName: string }
	| { type: "explore"; changeName: string }
	| { type: "archive"; changeName: string }
	| { type: "propose" }
	| { type: "cancel" };
