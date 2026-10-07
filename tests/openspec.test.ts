// Run with Node 24: node --test tests/openspec.test.ts
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getOpenSpecDir, resetOpenSpecDir, resolveOpenSpecDir } from "../extension/openspec.ts";

async function fixture(t: TestContext): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "openspec project "));
	t.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

function gitStub(stdout: string, code = 0) {
	const calls: { command: string; args: string[]; options: unknown }[] = [];
	const pi = {
		exec: async (command: string, args: string[], options: unknown) => {
			assert.equal(command, "git", "Directory checks must not launch external commands");
			calls.push({ command, args, options });
			return { stdout, stderr: "", code, killed: false };
		},
	} as unknown as ExtensionAPI;
	return { pi, calls };
}

test("detects the session cwd without any external command", async (t) => {
	const cwd = await fixture(t);
	await mkdir(join(cwd, "openspec", "changes"), { recursive: true });
	const { pi, calls } = gitStub("");

	assert.equal(await resolveOpenSpecDir(pi, cwd), cwd);
	assert.equal(calls.length, 0);
});

test("validates the Git root using the filesystem and handles CRLF output", async (t) => {
	const root = await fixture(t);
	const cwd = join(root, "nested folder");
	await mkdir(cwd);
	await mkdir(join(root, "openspec", "changes"), { recursive: true });
	const { pi, calls } = gitStub(`${root}\r\n`);

	assert.equal(await resolveOpenSpecDir(pi, cwd), root);
	assert.deepEqual(calls, [{
		command: "git",
		args: ["rev-parse", "--show-toplevel"],
		options: { timeout: 5000, cwd },
	}]);
});

test("a file named changes in the session cwd does not prevent Git fallback", async (t) => {
	const root = await fixture(t);
	const cwd = join(root, "nested");
	await mkdir(join(root, "openspec", "changes"), { recursive: true });
	await mkdir(join(cwd, "openspec"), { recursive: true });
	await writeFile(join(cwd, "openspec", "changes"), "not a directory");
	const { pi } = gitStub(root);

	assert.equal(await resolveOpenSpecDir(pi, cwd), root);
});

test("rejects a Git root whose changes path is a file", async (t) => {
	const root = await fixture(t);
	await mkdir(join(root, "openspec"));
	await writeFile(join(root, "openspec", "changes"), "not a directory");
	const { pi } = gitStub(root);

	assert.equal(await resolveOpenSpecDir(pi, root), null);
});

test("returns null when neither cwd nor Git root has changes", async (t) => {
	const root = await fixture(t);
	const { pi } = gitStub(root);

	assert.equal(await resolveOpenSpecDir(pi, root), null);
});

test("handles failed, empty, and nonexistent Git roots", async (t) => {
	const root = await fixture(t);
	for (const { stdout, code } of [
		{ stdout: root, code: 1 },
		{ stdout: "\r\n", code: 0 },
		{ stdout: join(root, "nonexistent"), code: 0 },
	]) {
		const { pi } = gitStub(stdout, code);
		assert.equal(await resolveOpenSpecDir(pi, root), null);
	}
});

test("handles unavailable or timed-out Git without throwing", async (t) => {
	const root = await fixture(t);
	const pi = {
		exec: async () => { throw new Error("Git unavailable or timed out"); },
	} as unknown as ExtensionAPI;

	assert.equal(await resolveOpenSpecDir(pi, root), null);
});

test("treats filesystem lookup errors as a failed check", async (t) => {
	const root = await fixture(t);
	const { pi } = gitStub("");

	assert.equal(await resolveOpenSpecDir(pi, `${root}\0`), null);
});

test("caches resolutions per session cwd and supports scoped resets", async (t) => {
	const root = await fixture(t);
	const first = join(root, "first");
	const second = join(root, "second");
	await mkdir(first);
	await mkdir(second);
	await mkdir(join(root, "openspec", "changes"), { recursive: true });
	const { pi, calls } = gitStub(root);
	t.after(() => { resetOpenSpecDir(first); resetOpenSpecDir(second); });

	const pending = await Promise.all([getOpenSpecDir(pi, first), getOpenSpecDir(pi, first)]);
	assert.deepEqual(pending, [root, root]);
	assert.equal(calls.length, 1);
	assert.equal(await getOpenSpecDir(pi, second), root);
	assert.equal(calls.length, 2);

	resetOpenSpecDir(first);
	assert.equal(await getOpenSpecDir(pi, first), root);
	assert.equal(calls.length, 3);
	assert.equal(await getOpenSpecDir(pi, second), root);
	assert.equal(calls.length, 3);
});

test("a cached missing directory is detected after a session reset", async (t) => {
	const root = await fixture(t);
	const { pi, calls } = gitStub("", 1);
	t.after(() => { resetOpenSpecDir(root); });

	assert.equal(await getOpenSpecDir(pi, root), null);
	await mkdir(join(root, "openspec", "changes"), { recursive: true });
	assert.equal(await getOpenSpecDir(pi, root), null);
	resetOpenSpecDir(root);
	assert.equal(await getOpenSpecDir(pi, root), root);
	assert.equal(calls.length, 1);
});
