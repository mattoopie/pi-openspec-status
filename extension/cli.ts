/** OpenSpec launcher selection and dependency-backed Windows fallback. */
import crossSpawn from "cross-spawn";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ExecOptions = NonNullable<Parameters<ExtensionAPI["exec"]>[2]>;
type ExecResult = Awaited<ReturnType<ExtensionAPI["exec"]>>;
type OpenSpecLauncher = "pi-exec" | "cross-spawn";
type OpenSpecExecutor = (args: string[], options?: ExecOptions) => Promise<ExecResult>;

/** Match pi.exec's result shape, preserving cwd, timeout, and cancellation. */
export function crossSpawnExec(
	command: string,
	args: string[],
	options: ExecOptions = {},
): Promise<ExecResult> {
	if (options.signal?.aborted) {
		return Promise.resolve({ stdout: "", stderr: "Command aborted", code: 1, killed: true });
	}

	return new Promise((resolve) => {
		const child = crossSpawn(command, args, {
			cwd: options.cwd,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		let stdout = "";
		let stderr = "";
		let timer: ReturnType<typeof setTimeout> | undefined;
		let settled = false;

		function finish(code: number, killed = false): void {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			options.signal?.removeEventListener("abort", abort);
			resolve({ stdout, stderr, code, killed });
		}

		function terminate(message: string): void {
			if (settled) return;
			stderr = [stderr, message].filter(Boolean).join("\n");
			// On Windows cross-spawn may launch a cmd shim. Kill its children too.
			if (process.platform === "win32" && child.pid) {
				const killer = crossSpawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
					stdio: "ignore",
					windowsHide: true,
				});
				killer.on("error", () => child.kill("SIGKILL"));
				killer.on("exit", (code) => { if (code !== 0) child.kill("SIGKILL"); });
			} else {
				child.kill("SIGKILL");
			}
			finish(1, true);
		}

		function abort(): void { terminate("Command aborted"); }

		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");
		child.stdout?.on("data", (data: string) => { stdout += data; });
		child.stderr?.on("data", (data: string) => { stderr += data; });
		child.on("error", (err) => {
			stderr = [stderr, err.message].filter(Boolean).join("\n");
			finish(1);
		});
		child.on("close", (code) => finish(code ?? 1));
		options.signal?.addEventListener("abort", abort, { once: true });
		if (options.timeout && options.timeout > 0) {
			timer = setTimeout(() => terminate("Command timed out"), options.timeout);
		}
	});
}

/** Cache a successful Windows fallback, but never cache a failed attempt. */
export function createOpenSpecExecutor(
	pi: ExtensionAPI,
	platform: NodeJS.Platform = process.platform,
	fallback = crossSpawnExec,
): OpenSpecExecutor {
	let launcher: OpenSpecLauncher = "pi-exec";

	return async (args, options) => {
		if (launcher === "cross-spawn") return fallback("openspec", args, options);

		try {
			const direct = await pi.exec("openspec", args, options);
			if (direct.code === 0 || direct.killed || options?.signal?.aborted || platform !== "win32") {
				return direct;
			}
		} catch (err) {
			if (platform !== "win32" || options?.signal?.aborted) throw err;
		}

		const result = await fallback("openspec", args, options);
		if (result.code === 0 && !result.killed) launcher = "cross-spawn";
		return result;
	};
}

// Keep independent Pi hosts separate, without retaining disposed API instances.
const executors = new WeakMap<ExtensionAPI, OpenSpecExecutor>();

export function execOpenSpec(pi: ExtensionAPI, args: string[], options?: ExecOptions): Promise<ExecResult> {
	let execute = executors.get(pi);
	if (!execute) {
		execute = createOpenSpecExecutor(pi);
		executors.set(pi, execute);
	}
	return execute(args, options);
}
