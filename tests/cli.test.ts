// Run with Node 24: node --test tests/*.test.ts
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createOpenSpecExecutor, crossSpawnExec, execOpenSpec } from "../extension/cli.ts";
import { checkCliAvailable, getChangeStatus, listChanges, resetOpenSpecDir } from "../extension/openspec.ts";

type Exec = typeof crossSpawnExec;
const success = { stdout: "1.14.0", stderr: "", code: 0, killed: false };
const failure = { stdout: "", stderr: "launcher unavailable", code: 1, killed: false };
function api(exec: Exec): ExtensionAPI { return { exec } as unknown as ExtensionAPI; }

for (const platform of ["win32", "darwin", "linux"] as const) {
	test(`${platform}: successful direct execution never uses the fallback`, async () => {
		let calls = 0;
		const execute = createOpenSpecExecutor(api(async () => { calls++; return success; }), platform,
			async () => { throw new Error("Unexpected fallback"); });
		assert.equal(await execute(["--version"]), success);
		assert.equal(await execute(["list", "--json"]), success);
		assert.equal(calls, 2);
	});
}

for (const platform of ["darwin", "linux"] as const) {
	test(`${platform}: failed direct execution never uses the fallback`, async () => {
		const fallback: Exec = async () => { throw new Error("Unexpected fallback"); };
		const execute = createOpenSpecExecutor(api(async () => failure), platform, fallback);
		assert.equal(await execute(["--version"]), failure);
		const error = new Error("spawn ENOENT");
		const throws = createOpenSpecExecutor(api(async () => { throw error; }), platform, fallback);
		await assert.rejects(throws(["--version"]), (err) => err === error);
	});
}

for (const throws of [false, true]) {
	test(`Windows falls back after ${throws ? "a thrown error" : "a nonzero exit"} and caches success`, async () => {
		let directCalls = 0;
		const calls: Parameters<Exec>[] = [];
		const execute = createOpenSpecExecutor(api(async () => {
			directCalls++;
			if (throws) throw new Error("spawn ENOENT");
			return failure;
		}), "win32", async (...args) => { calls.push(args); return success; });
		const options = { timeout: 5000, cwd: String.raw`C:\Project With Spaces` };
		assert.equal(await execute(["--version"], options), success);
		assert.equal(await execute(["list", "--json"], options), success);
		assert.equal(await execute(["status", "--json", "--change", "demo & %PATH%!"], options), success);
		assert.equal(directCalls, 1);
		assert.deepEqual(calls, [
			["openspec", ["--version"], options],
			["openspec", ["list", "--json"], options],
			["openspec", ["status", "--json", "--change", "demo & %PATH%!"], options],
		]);
	});
}

test("failed fallback attempts are not cached", async () => {
	let directCalls = 0;
	let fallbackCalls = 0;
	const execute = createOpenSpecExecutor(api(async () => { directCalls++; return failure; }), "win32",
		async () => { fallbackCalls++; return fallbackCalls === 1 ? failure : success; });
	assert.equal(await execute(["--version"]), failure);
	assert.equal(await execute(["--version"]), success);
	assert.equal(await execute(["list", "--json"]), success);
	assert.equal(directCalls, 2);
	assert.equal(fallbackCalls, 3);
});

test("a throwing fallback is not cached", async () => {
	let directCalls = 0;
	let fallbackCalls = 0;
	const execute = createOpenSpecExecutor(api(async () => { directCalls++; return failure; }), "win32",
		async () => { if (++fallbackCalls === 1) throw new Error("spawn failed"); return success; });
	await assert.rejects(execute(["--version"]), /spawn failed/);
	assert.equal(await execute(["--version"]), success);
	assert.equal(directCalls, 2);
});

test("cached fallback returns CLI errors without relaunching through Pi", async () => {
	let directCalls = 0;
	let fallbackCalls = 0;
	const execute = createOpenSpecExecutor(api(async () => { directCalls++; return failure; }), "win32",
		async () => ++fallbackCalls === 1 ? success : failure);
	await execute(["--version"]);
	assert.equal(await execute(["list", "--json"]), failure);
	assert.equal(directCalls, 1);
});

test("timeout and cancellation do not trigger a second launch", async () => {
	const killed = { ...failure, killed: true };
	const fallback: Exec = async () => { throw new Error("Unexpected fallback"); };
	const execute = createOpenSpecExecutor(api(async () => killed), "win32", fallback);
	assert.equal(await execute(["--version"]), killed);
	const controller = new AbortController();
	controller.abort();
	const aborted = createOpenSpecExecutor(api(async () => failure), "win32", fallback);
	assert.equal(await aborted(["--version"], { signal: controller.signal }), failure);
});

test("launcher caches are independent for separate Pi APIs", async () => {
	const first = createOpenSpecExecutor(api(async () => failure), "win32", async () => success);
	await first(["--version"]);
	let calls = 0;
	const second = createOpenSpecExecutor(api(async () => { calls++; return success; }), "win32",
		async () => { throw new Error("Unexpected fallback"); });
	await second(["--version"]);
	assert.equal(calls, 1);
});

test("cross-spawn preserves cwd, argument boundaries, Unicode, stdout, stderr, and exit code", async (t) => {
	const cwd = await mkdtemp(join(tmpdir(), "openspec launch "));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	const args = ["name with spaces", "雪", "a&b", "%PATH%!", 'a"b', "trailing\\"];
	const script = "console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(1)}));console.error('diagnostic');process.exitCode=7";
	const result = await crossSpawnExec(process.execPath, ["-e", script, ...args], { cwd, timeout: 5000 });
	const output = JSON.parse(result.stdout);
	// Temporary paths may be canonicalized (e.g. /var -> /private/var on macOS).
	assert.equal(output.cwd.endsWith(cwd.split(/[\\/]/).at(-1)), true);
	assert.deepEqual(output.args, args);
	assert.equal(result.stderr.trim(), "diagnostic");
	assert.equal(result.code, 7);
	assert.equal(result.killed, false);
});

test("cross-spawn reports a missing executable", async () => {
	const result = await crossSpawnExec("pi-openspec-status-nonexistent-command", [], { timeout: 5000 });
	assert.notEqual(result.code, 0);
	assert.match(result.stderr, /ENOENT|not recognized|not found/i);
});

test("cross-spawn enforces timeouts", async () => {
	const result = await crossSpawnExec(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeout: 100 });
	assert.equal(result.killed, true);
	assert.notEqual(result.code, 0);
	assert.match(result.stderr, /timed out/);
});

test("cross-spawn supports cancellation before and during execution", async () => {
	const preAborted = new AbortController();
	preAborted.abort();
	const before = await crossSpawnExec("must-not-launch", [], { signal: preAborted.signal });
	assert.equal(before.killed, true);
	const controller = new AbortController();
	const pending = crossSpawnExec(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
		signal: controller.signal, timeout: 5000,
	});
	controller.abort();
	const during = await pending;
	assert.equal(during.killed, true);
	assert.match(during.stderr, /aborted/);
});

test("availability, list, and status use the shared executor with their working directory", async (t) => {
	const cwd = await mkdtemp(join(tmpdir(), "openspec integration "));
	await mkdir(join(cwd, "openspec", "changes"), { recursive: true });
	t.after(async () => { resetOpenSpecDir(cwd); await rm(cwd, { recursive: true, force: true }); });
	const calls: Parameters<Exec>[] = [];
	const pi = api(async (...args) => {
		calls.push(args);
		return { ...success, stdout: args[1][0] === "list" ? '{"changes":[]}' : '{}' };
	});
	assert.deepEqual(await checkCliAvailable(pi, cwd), { available: true });
	assert.deepEqual(await listChanges(pi, cwd), { changes: [], error: null });
	assert.deepEqual(await getChangeStatus(pi, "demo", cwd), { detail: {}, error: null });
	assert.deepEqual(calls, [
		["openspec", ["--version"], { timeout: 5000, cwd }],
		["openspec", ["list", "--json"], { timeout: 10000, cwd }],
		["openspec", ["status", "--json", "--change", "demo"], { timeout: 10000, cwd }],
	]);
});

test("native Windows npm-style launcher works and is cached across data-layer calls", {
	skip: process.platform !== "win32",
}, async (t) => {
	const cwd = await mkdtemp(join(tmpdir(), "openspec shim "));
	await mkdir(join(cwd, "openspec", "changes"), { recursive: true });
	await writeFile(join(cwd, "openspec.cmd"), '@echo off\r\necho {"changes":[]}\r\n');
	t.after(async () => { resetOpenSpecDir(cwd); await rm(cwd, { recursive: true, force: true }); });
	let directCalls = 0;
	const pi = api(async () => { directCalls++; return failure; });
	assert.deepEqual(await checkCliAvailable(pi, cwd), { available: true });
	assert.deepEqual(await listChanges(pi, cwd), { changes: [], error: null });
	assert.equal((await getChangeStatus(pi, "demo", cwd)).error, null);
	assert.equal((await execOpenSpec(pi, ["--version"], { cwd, timeout: 5000 })).code, 0);
	assert.equal(directCalls, 1);
});
