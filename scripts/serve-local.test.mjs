import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const reservePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close((error) => error ? reject(error) : resolve(port));
  });
});

const waitForReady = (child) => new Promise((resolve, reject) => {
  let stderr = "";
  const timer = setTimeout(() => reject(new Error(`server startup timed out: ${stderr}`)), 5_000);
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.once("exit", (code) => {
    clearTimeout(timer);
    reject(new Error(`server exited before startup with code ${code}: ${stderr}`));
  });
  child.stdout.on("data", (chunk) => {
    if (!chunk.toString().includes("Serving ")) return;
    clearTimeout(timer);
    resolve();
  });
});

const rawRequest = (port, request) => new Promise((resolve, reject) => {
  const socket = net.createConnection({ host: "127.0.0.1", port });
  let response = "";
  socket.setEncoding("utf8");
  socket.setTimeout(5_000, () => socket.destroy(new Error("raw request timed out")));
  socket.once("error", reject);
  socket.on("data", (chunk) => { response += chunk; });
  socket.once("end", () => resolve(response));
  socket.once("connect", () => socket.end(request));
});

const get = (port, pathname) => new Promise((resolve, reject) => {
  const request = http.get({ host: "127.0.0.1", port, path: pathname }, (response) => {
    let body = "";
    response.setEncoding("utf8");
    response.on("data", (chunk) => { body += chunk; });
    response.once("end", () => resolve({ statusCode: response.statusCode, body }));
  });
  request.setTimeout(5_000, () => request.destroy(new Error("HTTP request timed out")));
  request.once("error", reject);
});

const port = await reservePort();
const child = spawn(process.execPath, [path.join(root, "scripts", "serve-local.mjs"), String(port)], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"]
});

try {
  await waitForReady(child);
  const malformed = await rawRequest(
    port,
    `GET /%E0%A4%A HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`
  );
  assert.match(malformed, /^HTTP\/1\.1 400 /u);

  const healthy = await get(port, "/");
  assert.equal(healthy.statusCode, 200);
  assert.match(healthy.body, /<title>[^<]+<\/title>/u);
  assert.equal(child.exitCode, null, "server must remain alive after a malformed request");

  console.log(JSON.stringify({ status: "passed", malformedRequest: 400, healthyRequest: 200 }, null, 2));
} finally {
  child.kill();
}
