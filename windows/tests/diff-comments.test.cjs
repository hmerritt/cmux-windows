const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("diff comments survive reload and a pending batch can only be claimed once", async t => {
  const { DiffComments } = require("../src/diff-comments.cjs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmux-diff-comments-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "comments.json");
  const store = new DiffComments(file);
  const scope = { root: dir, workspaceId: "workspace" };
  store.add(scope, { path: "file.txt", source: "unstaged", side: "old", line: 2, context: "-old", text: "Review this" });
  assert.equal(new DiffComments(file).list(scope).length, 1);
  assert.equal(store.list({ ...scope, workspaceId: "other" }).length, 0);
  const first = store.claim(scope);
  assert.match(first.prompt, /file\.txt.*old.*2/);
  assert.equal(store.claim(scope), null);
  assert.equal(new DiffComments(file).list(scope)[0].delivery, "uncertain");
  store.finish(first, "pending");
  const retry = store.claim(scope);
  assert.ok(retry);
  store.finish(retry, "sent");
  assert.equal(new DiffComments(file).list(scope)[0].delivery, "sent");
});
