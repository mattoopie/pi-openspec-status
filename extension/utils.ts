/**
 * General-purpose utility functions for the OpenSpec Status Widget extension.
 */

/**
 * Recognize tools that may have changed OpenSpec state.
 * Normalize separators explicitly so Windows paths also work on Unix hosts.
 */
export function isOpenSpecRelated(toolName: string, input: Record<string, unknown>): boolean {
	if (toolName === "write" || toolName === "edit") {
		if (typeof input.path === "string") {
			const path = input.path.replace(/\\/g, "/");
			return path.startsWith("openspec/") || path.includes("/openspec/");
		}
	}
	if (toolName === "bash" || toolName === "powershell") {
		return typeof input.command === "string" && input.command.includes("openspec");
	}
	return false;
}

/**
 * Create a debounced version of a function.
 * The debounced function is called after `delay` ms of inactivity.
 */
export function debounce<T extends (...args: unknown[]) => void>(
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

/**
 * Check if two string arrays have identical content.
 */
export function arraysEqual(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}
