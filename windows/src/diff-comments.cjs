const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { atomicJson } = require("./session-restore.cjs");

const sources = ["staged", "unstaged", "branch"];
const clean = text => text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");

function reviewAnchor(patch, { source, side, line }) {
  if (!sources.includes(source) || !["old", "new"].includes(side) || !Number.isSafeInteger(line) || line < 1) return null;
  const { parseDiffLines } = require("../renderer/diff-lines.mjs");
  for (const block of parseDiffLines(patch[source] || "")) {
    if (block.type !== "hunk") continue;
    const row = block.rows.find(row => row.kind === (side === "old" ? "removed" : "added") && row[side + "Line"] === line);
    if (row) return { path: patch.path, source, side, line, context: row.text };
  }
  return null;
}

class DiffComments {
  constructor(file) {
    this.file = file;
    try {
      this.items = JSON.parse(fs.readFileSync(file, "utf8")).items.map(item => ({
        ...item, delivery: item.delivery === "sending" ? "uncertain" : item.delivery
      }));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      this.items = [];
    }
  }

  save(items) {
    atomicJson(this.file, { version: 1, items });
    this.items = items;
  }

  list({ root, workspaceId }) {
    return this.items.filter(item => item.workspaceId === workspaceId && (!root || item.root === root));
  }

  text(value) {
    if (typeof value !== "string" || !value.trim() || value.length > 4000 || clean(value) !== value) {
      throw new Error("Enter a comment of up to 4,000 characters");
    }
    return value.trim();
  }

  add(scope, anchor) {
    const { path: file, source, side, line, context, text } = anchor;
    if (typeof file !== "string" || !file || path.isAbsolute(file) || file.split(/[\\/]/).includes("..") ||
        !sources.includes(source) || !["old", "new"].includes(side) || !Number.isSafeInteger(line) ||
        line < 1 || typeof context !== "string" || context.length > 16000 || !scope.root) throw new Error("Invalid diff anchor");
    if (this.list(scope).length >= 250) throw new Error("Diff comment limit reached");
    const comment = { ...scope, id: randomUUID(), path: file, source, side, line, context, text: this.text(text), delivery: "pending" };
    this.save([...this.items, comment]);
    return comment;
  }

  edit(scope, id, text) {
    const existing = this.list(scope).find(item => item.id === id);
    if (!existing || existing.delivery === "sending") throw new Error("Comment is unavailable");
    const comment = { ...existing, text: this.text(text), delivery: "pending", claim: undefined };
    this.save(this.items.map(item => item === existing ? comment : item));
    return comment;
  }

  remove(scope, id) {
    const existing = this.list(scope).find(item => item.id === id);
    if (!existing || existing.delivery === "sending") throw new Error("Comment is unavailable");
    this.save(this.items.filter(item => item !== existing));
  }

  claim(scope, { retryUncertain = false, ids } = {}) {
    const comments = this.list(scope);
    if (comments.some(item => item.delivery === "sending")) return null;
    const eligible = comments.filter(item => item.delivery === "pending" || (retryUncertain && item.delivery === "uncertain"));
    const selected = Array.isArray(ids) ? eligible.filter(item => ids.includes(item.id)) : eligible;
    if (!selected.length || (Array.isArray(ids) && selected.length !== ids.length)) return null;
    const prompt = "Please address these diff review comments.\n\n" + selected.map(comment =>
      `${clean(comment.root)} / ${clean(comment.path)} (${comment.side} line ${comment.line}, ${comment.source})\n` +
      `${clean(comment.context)}\n${comment.text}`
    ).join("\n\n");
    if (Buffer.byteLength(prompt) > 64000) throw new Error("Select fewer comments to send at once");
    const claim = randomUUID();
    const included = new Set(selected);
    this.save(this.items.map(item => included.has(item) ? { ...item, delivery: "sending", claim, previousDelivery: item.delivery } : item));
    return { claim, prompt };
  }

  finish({ claim }, delivery) {
    this.save(this.items.map(item => item.claim === claim && item.delivery === "sending" ? {
      ...item, delivery: delivery === "pending" ? item.previousDelivery : delivery, claim: undefined, previousDelivery: undefined
    } : item));
  }
}

module.exports = { DiffComments, reviewAnchor };
