// Run with Node 24: node --test tests/*.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { isOpenSpecRelated } from "../extension/utils.ts";

for (const tool of ["write", "edit"]) {
	for (const path of [
		"openspec/changes/demo/tasks.md",
		"./openspec/changes/demo/tasks.md",
		"/projects/demo/openspec/changes/demo/tasks.md",
		String.raw`openspec\changes\demo\tasks.md`,
		String.raw`.\openspec\changes\demo\tasks.md`,
		String.raw`C:\Projects\demo\openspec\changes\demo\tasks.md`,
		String.raw`C:\Projects/demo\openspec/changes\demo/tasks.md`,
		String.raw`\\server\share\openspec\changes\demo\tasks.md`,
	]) {
		test(`${tool} recognizes ${path}`, () => {
			assert.equal(isOpenSpecRelated(tool, { path }), true);
		});
	}

	for (const path of [
		"src/index.ts",
		"not-openspec/changes/demo/tasks.md",
		"/projects/openspec-status/tasks.md",
		String.raw`C:\Projects\not-openspec\changes\demo\tasks.md`,
		String.raw`C:\Projects\openspec-status\tasks.md`,
		"",
		undefined,
		null,
		42,
	]) {
		test(`${tool} ignores unrelated or invalid path ${JSON.stringify(path)}`, () => {
			assert.equal(isOpenSpecRelated(tool, { path }), false);
		});
	}
}

for (const tool of ["bash", "powershell"]) {
	for (const command of [
		"openspec list --json",
		"openspec status --json --change demo",
		String.raw`& "C:\Program Files\OpenSpec\openspec.cmd" list --json`,
		String.raw`Set-Content openspec\changes\demo\tasks.md "- [x] done"`,
	]) {
		test(`${tool} recognizes OpenSpec command ${command}`, () => {
			assert.equal(isOpenSpecRelated(tool, { command }), true);
		});
	}

	for (const command of ["git status", "", undefined, null, 42]) {
		test(`${tool} ignores unrelated or invalid command ${JSON.stringify(command)}`, () => {
			assert.equal(isOpenSpecRelated(tool, { command }), false);
		});
	}
}

test("other tools do not trigger an OpenSpec refresh", () => {
	for (const tool of ["read", "grep", "custom", ""]) {
		assert.equal(isOpenSpecRelated(tool, {
			path: String.raw`openspec\changes\demo\tasks.md`,
			command: "openspec list --json",
		}), false);
	}
});

test("file and shell tools only inspect their respective input fields", () => {
	assert.equal(isOpenSpecRelated("write", { command: "openspec list" }), false);
	assert.equal(isOpenSpecRelated("edit", {}), false);
	assert.equal(isOpenSpecRelated("bash", { path: "openspec/tasks.md" }), false);
	assert.equal(isOpenSpecRelated("powershell", {}), false);
});
