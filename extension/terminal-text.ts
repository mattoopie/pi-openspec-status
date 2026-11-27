/**
 * Text-width helpers for widget rows (no @oh-my-pi/pi-tui import).
 * shortcut: ANSI/OpenSpec names only; wide graphemes may mis-measure — swap to host pi-tui if omp exposes root exports.
 */

const SGR_PATTERN = /\x1b\[[0-9:;?]*[ -/]*[@-~]/g;
const OSC_PATTERN = /\x1b\][^\x07\x1b\\]*(?:\x07|\x1b\\)/g;

function visiblePlain(text: string): string {
	return text.replace(OSC_PATTERN, "").replace(SGR_PATTERN, "");
}

export function visibleWidth(text: string): number {
	return [...visiblePlain(text)].length;
}

export function truncateToWidth(
	text: string,
	maxWidth: number,
	ellipsis = "…",
	pad = false,
): string {
	maxWidth = Math.max(0, maxWidth | 0);
	const width = visibleWidth(text);
	if (width <= maxWidth) {
		if (pad && width < maxWidth) {
			return text + " ".repeat(maxWidth - width);
		}
		return text;
	}
	const ellipsisWidth = visibleWidth(ellipsis);
	const target = Math.max(0, maxWidth - ellipsisWidth);
	const plain = visiblePlain(text);
	let taken = 0;
	let cut = 0;
	for (const ch of plain) {
		if (taken + ch.length > target) break;
		taken += ch.length;
		cut += ch.length;
	}
	// Preserve any leading ANSI from theme.fg() when truncating themed lines.
	const leadingAnsi = text.match(/^(\x1b\[[0-9:;?]*[ -/]*[@-~])+/);
	const plainCut = plain.slice(0, cut);
	const reset = "\x1b[0m";
	const body = leadingAnsi ? `${leadingAnsi[0]}${plainCut}${reset}` : plainCut;
	return body + ellipsis;
}