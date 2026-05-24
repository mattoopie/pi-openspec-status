/**
 * Task group parser — extracts `##`-headed task groups from tasks.md content.
 *
 * Designed for OpenSpec tasks.md files where each `##`-level heading
 * introduces a group of tasks tracked via `- [x]` (done) / `- [ ]` (pending)
 * checkboxes.
 *
 * Exports a single function `parseTaskGroups` that is fully synchronous,
 * pure (no I/O), and returns an empty array for any edge case.
 */

import type { TaskGroup } from "./types.ts";

/**
 * Parse tasks.md content into an array of TaskGroup objects.
 *
 * Rules:
 * - Groups are delimited by `##`-level headings
 * - Content before the first `##` heading is skipped
 * - Within each group, lines matching `- [x]` are counted as completed,
 *   lines matching `- [ ]` as pending
 * - Other lines (text, code blocks, blank lines) are ignored
 * - Edge cases: empty content, no `##` headings, or parse errors all
 *   return an empty array
 *
 * @param content — the full text of tasks.md
 * @returns parsed TaskGroup array (empty if none found or on error)
 */
export function parseTaskGroups(content: string): TaskGroup[] {
	try {
		// Normalize line endings
		const normalized = content.replace(/\r\n/g, "\n");

		// Edge case: empty content
		if (!normalized.trim()) {
			return [];
		}

		// Split into lines
		const lines = normalized.split("\n");

		// Find `## ` headings — these mark group boundaries.
		// We collect groups as ranges: start line index of heading, end line index (exclusive).
		const headingIndices: number[] = [];
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]!;
			if (/^##\s/.test(line)) {
				headingIndices.push(i);
			}
		}

		// Edge case: no `##` headings at all
		if (headingIndices.length === 0) {
			return [];
		}

		// Build groups from heading ranges
		const groups: TaskGroup[] = [];
		for (let g = 0; g < headingIndices.length; g++) {
			const startLine = headingIndices[g]!;
			const endLine = g + 1 < headingIndices.length ? headingIndices[g + 1]! : lines.length;

			// Extract heading name (strip the `## ` prefix)
			const headingLine = lines[startLine]!;
			const groupName = headingLine.replace(/^##\s+/, "").trim();

			// Count checkboxes in this group's range
			let completed = 0;
			let total = 0;

			for (let i = startLine + 1; i < endLine; i++) {
				const checkLine = lines[i]!;
				if (/^- \[x\]/i.test(checkLine)) {
					completed++;
					total++;
				} else if (/^- \[ \]/.test(checkLine)) {
					total++;
				}
				// Ignore other content
			}

			// Derive status
			let status: TaskGroup["status"];
			if (total === 0) {
				status = "empty";
			} else if (completed === total) {
				status = "complete";
			} else if (completed === 0) {
				status = "none";
			} else {
				status = "partial";
			}

			groups.push({
				name: groupName,
				completed,
				total,
				status,
			});
		}

		return groups;
	} catch {
		// Any parse error returns empty
		return [];
	}
}
