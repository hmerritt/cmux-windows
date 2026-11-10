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
  const comment = store.add(scope, { path: "file.txt", source: "unstaged", side: "old", line: 2, context: "-old", text: "Review this" });
  assert.equal(new DiffComments(file).list(scope).length, 1);
  assert.equal(store.list({ ...scope, workspaceId: "other" }).length, 0);
  store.edit(scope, comment.id, "Review the updated version");
  assert.equal(store.claim(scope, { expected: new Map([[comment.id, comment.id]]) }), null);
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

test("review anchors use the changed line on each side and reject context lines", () => {
  const { reviewAnchor } = require("../src/diff-comments.cjs");
  const patch = { path: "a.txt", unstaged: "@@ -1,2 +1,2 @@\n unchanged\n-old\n+new\n" };
  assert.equal(reviewAnchor(patch, { source: "unstaged", side: "old", line: 2 }).context, "-old");
  assert.equal(reviewAnchor(patch, { source: "unstaged", side: "new", line: 2 }).context, "+new");
  assert.equal(reviewAnchor(patch, { source: "unstaged", side: "new", line: 1 }), null);
});
