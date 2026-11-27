/**
 * Key ids for overlay navigation (no pi-tui package import).
 * shortcut: arrow/escape only; Kitty CSI-u arrows may need host pi-tui matchesKey.
 */

export const NavKey = {
	up: "up",
	down: "down",
	escape: "escape",
} as const;

type NavKeyId = (typeof NavKey)[keyof typeof NavKey];

function escapeInput(data: string): boolean {
	return data === "\x1b" || data === "\u001b" || data === "\x1b\x1b" || data === "\x1b[27~" || data === "\x1b\r";
}

function arrowInput(data: string, direction: "A" | "B"): boolean {
	if (data === `\x1b[${direction}` || data === `\x1bO${direction}`) return true;
	if (data.length >= 3 && data.startsWith("\x1b") && data.endsWith(direction)) return true;
	return false;
}

export function matchesKey(data: string, keyId: NavKeyId | string): boolean {
	switch (keyId) {
		case NavKey.escape:
		case "esc":
			return escapeInput(data);
		case NavKey.up:
			return arrowInput(data, "A");
		case NavKey.down:
			return arrowInput(data, "B");
		default:
			return false;
	}
}