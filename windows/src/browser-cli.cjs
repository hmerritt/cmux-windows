const browserCommands = new Set([
  "identify", "open", "open-split", "navigate", "back", "forward", "reload",
  "url", "wait", "snapshot", "click", "fill", "type", "press", "screenshot", "eval"
]);

function parseBrowserArgs(args) {
  const values = [];
  const params = {};
  const options = new Map([
    ["--surface", "surface"], ["--url", "url"], ["--selector", "selector"],
    ["--text", "text"], ["--script", "script"], ["--load-state", "loadState"],
    ["--url-contains", "urlContains"], ["--timeout-ms", "timeout"], ["--out", "output"],
    ["--function", "condition"], ["--max-depth", "maxDepth"]
  ]);
  let json = false;
  let output;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const option = options.get(arg);
    if (option) {
      if (index + 1 >= args.length) throw new Error(arg + " requires a value");
      if (option === "output") output = args[++index];
      else params[option] = args[++index];
    } else if (arg === "--json") json = true;
    else if (arg === "--snapshot-after") params.snapshotAfter = true;
    else if (arg === "--interactive") params.interactive = true;
    else if (arg === "--compact") params.compact = true;
    else if (arg.startsWith("--")) throw new Error("Unknown browser option " + arg);
    else values.push(arg);
  }
  if (!browserCommands.has(values[0]) && browserCommands.has(values[1])) params.surface ||= values.shift();
  params.command = values.shift();
  if (!browserCommands.has(params.command)) throw new Error("Expected a supported browser command");
  if (["open", "open-split", "navigate"].includes(params.command)) params.url ||= values.shift();
  if (["click", "fill", "type"].includes(params.command)) params.selector ||= values.shift();
  if (["fill", "type"].includes(params.command)) params.text ??= values.shift();
  if (params.command === "press") params.key = values.shift();
  if (params.command === "eval") params.script ??= values.shift();
  if (values.length) throw new Error("Unexpected browser argument " + values[0]);
  return { params, output, json };
}

module.exports = { browserCommands, parseBrowserArgs };
