const http = require("node:http");
const { Duplex } = require("node:stream");
const { randomBytes, timingSafeEqual } = require("node:crypto");

function proxyTarget(address, connect) {
  const target = new URL(connect ? `http://${address}` : address);
  if (!["http:", "ws:"].includes(target.protocol) || target.username || target.password ||
      (connect && (target.pathname !== "/" || target.search || target.hash))) throw new Error("Invalid proxy target");
  return target;
}

async function openStream(bridge, url) {
  const { stream_id } = await bridge.call("proxy.open", {
    host: url.hostname.replace(/^\[|\]$/g, ""), port: Number(url.port || 80)
  });
  const params = { stream_id };
  const write = async data => {
    for (let index = 0; index < data.length; index += 32768) {
      await bridge.call("proxy.write", { ...params, data_base64: data.subarray(index, index + 32768).toString("base64") });
    }
  };
  const stream = new Duplex({
    read() {},
    write(data, _encoding, callback) {
      write(data).then(() => callback(), callback);
    },
    destroy(error, callback) {
      bridge.off("closed", closed);
      bridge.off("event", event);
      void bridge.call("proxy.close", params).catch(() => {});
      callback(error);
    }
  });
  stream.on("error", () => {});
  const closed = () => stream.destroy(new Error("SSH tunnel is down"));
  const event = message => {
    if (message.stream_id !== stream_id) return;
    if (message.event === "proxy.stream.data") {
      if (stream.readableLength > 1024 * 1024) return stream.destroy(new Error("SSH proxy buffer limit exceeded"));
      stream.push(Buffer.from(message.data_base64, "base64"));
    }
    if (message.event === "proxy.stream.eof") stream.push(null);
    if (message.event === "proxy.stream.error") stream.destroy(new Error("SSH proxy stream failed"));
  };
  bridge.once("closed", closed);
  bridge.on("event", event);
  try {
    await bridge.call("proxy.stream.subscribe", params);
    return stream;
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

async function createSshProxy(workspace) {
  const username = "cmux";
  const password = randomBytes(32).toString("hex");
  const realm = `cmux-${randomBytes(12).toString("hex")}`;
  const auth = Buffer.from(`Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`);
  const authenticated = request => {
    const received = Buffer.from(request.headers["proxy-authorization"] || "");
    return received.length === auth.length && timingSafeEqual(received, auth);
  };
  const challenge = `Basic realm="${realm}"`;
  const sockets = new Set();
  const getStream = url => {
    if (workspace.state !== "connected" || !workspace.bridge) throw new Error("SSH tunnel is down");
    return openStream(workspace.bridge, url);
  };
  const server = http.createServer(async (request, response) => {
    if (!authenticated(request)) {
      response.writeHead(407, { "Proxy-Authenticate": challenge, Connection: "close" }).end();
      return;
    }
    let upstream;
    try {
      const target = proxyTarget(request.url, false);
      upstream = await getStream(target);
      if (response.destroyed) return upstream.destroy();
      const headers = { ...request.headers, host: target.host, connection: "close" };
      delete headers["proxy-authorization"];
      delete headers["proxy-connection"];
      const outgoing = http.request({
        method: request.method, path: target.pathname + target.search, headers,
        createConnection: () => upstream
      }, incoming => {
        response.writeHead(incoming.statusCode, incoming.headers);
        incoming.on("error", () => response.destroy());
        incoming.pipe(response);
      });
      outgoing.on("error", () => {
        if (response.headersSent) response.destroy();
        else response.writeHead(502).end("SSH proxy unavailable");
      });
      response.on("close", () => outgoing.destroy());
      request.pipe(outgoing);
    } catch {
      upstream?.destroy();
      response.writeHead(502).end("SSH proxy unavailable");
    }
  });
  const tunnel = async (request, socket, head, connect) => {
    if (!authenticated(request)) {
      socket.end(`HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: ${challenge}\r\nConnection: close\r\n\r\n`);
      return;
    }
    try {
      const target = proxyTarget(request.url, connect);
      const upstream = await getStream(target);
      if (socket.destroyed) return upstream.destroy();
      socket.on("close", () => upstream.destroy());
      upstream.on("error", () => socket.destroy());
      if (connect) {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      } else {
        const headers = { ...request.headers, host: target.host };
        delete headers["proxy-authorization"];
        delete headers["proxy-connection"];
        const lines = Object.entries(headers).map(([key, value]) => `${key}: ${value}`);
        upstream.write(`${request.method} ${target.pathname}${target.search} HTTP/1.1\r\n${lines.join("\r\n")}\r\n\r\n`);
      }
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    } catch {
      socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
    }
  };
  server.on("connect", (...args) => void tunnel(...args, true));
  server.on("upgrade", (...args) => void tunnel(...args, false));
  server.on("connection", socket => {
    if (sockets.size >= 64) return socket.destroy();
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
  });
  const dropConnections = () => {
    if (workspace.state !== "connected") for (const socket of sockets) socket.destroy();
  };
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  workspace.on("status", dropConnections);
  return {
    port: server.address().port, username, password, realm,
    close() {
      workspace.off("status", dropConnections);
      for (const socket of sockets) socket.destroy();
      server.close();
    }
  };
}

module.exports = { createSshProxy };
