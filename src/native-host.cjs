// @ts-check
'use strict';
/**
 * Chrome native messaging host. It speaks Chrome frames on stdin/stdout and IPC frames on the profile socket.
 * It forwards messages and does not decide permission: the extension does. Logs go to stderr only.
 *
 * If Chrome's side of the pipe goes wrong (a frame it cannot read, stdin closed) the host exits, so the
 * extension sees the port close and starts a fresh host instead of talking to one that can no longer answer.
 */

console.log = (/** @type {any[]} */ ...args) => console.error('[kastorflow-host]', ...args);

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const framing = require('./framing.cjs');
const paths = require('./paths.cjs');

/** @type {import('node:net').Server|null} */
let server = null;
/** @type {string|null} */
let socketPath = null;
/** @type {string} */
let boundNonce = '';
let listening = false;
let seq = 0;
let stopped = false;
/** @type {Set<import('node:net').Socket>} */
const clients = new Set();
/**
 * @type {Map<string, { socket: import('node:net').Socket, localId: string }>}
 */
const waiters = new Map();

/** @param {unknown} obj */
function chromeWrite(obj) {
  if (stopped) return;
  process.stdout.write(framing.encodeChrome(obj));
}

/**
 * @param {import('node:net').Socket} socket
 * @param {unknown} obj
 */
function writeIpc(socket, obj) {
  if (socket.destroyed) return;
  /** @type {Buffer} */
  let frame;
  try {
    frame = framing.encodeIpc(obj);
  } catch (err) {
    if (!err || /** @type {any} */ (err).code !== 'frame_too_large') throw err;
    frame = framing.encodeIpc({
      type: 'response',
      id: obj && /** @type {any} */ (obj).id,
      ok: false,
      error: { code: 'limit_reached', message: 'That result is too large. Ask for the next page.' },
    });
  }
  socket.write(frame);
}

/** @param {number} [code] */
function shutdown(code) {
  if (stopped) return;
  stopped = true;
  for (const socket of clients) {
    try { socket.destroy(); } catch (_e) { /* already closed */ }
  }
  if (server) {
    try { server.close(); } catch (_e) { /* not listening */ }
  }
  if (socketPath && process.platform !== 'win32') {
    try { fs.unlinkSync(socketPath); } catch (_e) { /* already gone */ }
  }
  process.exit(code || 0);
}

/**
 * @param {string} code
 * @param {string} message
 */
function bindFailed(code, message) {
  chromeWrite({ type: 'bound', ok: false, error: { code, message } });
}

/**
 * @param {any} msg
 */
function onBind(msg) {
  if (Number(msg.bridge_version) !== 1) {
    bindFailed('version_mismatch', 'This companion does not match KastorFlow. Update it with: npx kastorflow-notebooklm-mcp@latest setup');
    return;
  }
  const nonce = String(msg.profile_nonce || '');
  if (boundNonce && boundNonce !== nonce) {
    bindFailed('profile_mismatch', 'This connection was created in a different browser profile. Connect again from KastorFlow.');
    return;
  }
  if (listening) {
    chromeWrite({ type: 'bound', ok: true, bridge_version: 1 });
    return;
  }
  if (server) return; // a listen is in progress; its callback answers
  let sock = '';
  try {
    sock = paths.socketPathFor(nonce);
    if (process.platform !== 'win32') {
      paths.ensurePrivateDir(path.dirname(sock));
      if (fs.existsSync(sock)) fs.unlinkSync(sock);
    }
  } catch (err) {
    const code = err && /** @type {any} */ (err).code === 'unsafe_socket_dir' ? 'unsafe_socket_dir' : 'profile_mismatch';
    bindFailed(code, code === 'unsafe_socket_dir'
      ? 'The companion’s socket folder belongs to someone else. Remove it, then reload KastorFlow.'
      : 'This connection was created in a different browser profile. Connect again from KastorFlow.');
    return;
  }
  const next = net.createServer(onClient);
  server = next;
  next.on('error', (err) => {
    const code = err && /** @type {any} */ (err).code ? String(/** @type {any} */ (err).code) : 'error';
    console.error('socket', code);
    if (!listening) {
      server = null;
      bindFailed('connection_unavailable', code === 'EADDRINUSE'
        ? 'Another KastorFlow companion is still running for this browser profile. Close it, then reload KastorFlow.'
        : 'The companion could not open its local connection (' + code + ').');
    }
  });
  next.listen(sock, () => {
    if (process.platform !== 'win32') {
      try { fs.chmodSync(sock, 0o600); } catch (_e) { /* the directory is already private */ }
    }
    listening = true;
    socketPath = sock;
    boundNonce = nonce;
    chromeWrite({ type: 'bound', ok: true, bridge_version: 1 });
  });
}

/**
 * @param {import('node:net').Socket} socket
 * @param {any} msg
 */
function forward(socket, msg) {
  if (!msg || (msg.type !== 'hello' && msg.type !== 'request')) {
    writeIpc(socket, {
      type: 'response',
      id: msg && msg.id,
      ok: false,
      error: { code: 'invalid_record', message: 'The bridge only forwards hello and tool requests.' },
    });
    return;
  }
  const localId = msg.id != null ? String(msg.id) : '';
  const pending = /** @type {Set<string>} */ (/** @type {any} */ (socket)._pending);
  if (!localId || pending.has(localId)) {
    writeIpc(socket, {
      type: 'response',
      id: msg.id,
      ok: false,
      error: { code: 'invalid_record', message: 'This request is already waiting for a reply.' },
    });
    return;
  }
  const wireId = String(++seq);
  waiters.set(wireId, { socket, localId });
  pending.add(localId);
  chromeWrite(Object.assign({}, msg, { id: wireId }));
}

/**
 * @param {any} msg
 */
function onResponse(msg) {
  const wireId = msg && msg.id != null ? String(msg.id) : '';
  const waiter = waiters.get(wireId);
  if (!waiter) return; // unknown or already answered: a duplicate reply is dropped
  waiters.delete(wireId);
  const pending = /** @type {Set<string>} */ (/** @type {any} */ (waiter.socket)._pending);
  if (pending) pending.delete(waiter.localId);
  writeIpc(waiter.socket, Object.assign({}, msg, { id: waiter.localId }));
}

/**
 * @param {import('node:net').Socket} socket
 */
function onClient(socket) {
  /** @type {any} */ (socket)._pending = new Set();
  clients.add(socket);
  const push = framing.createParser('ipc', {
    onFrame(msg) { forward(socket, msg); },
    onError() { socket.destroy(); },
  });
  socket.on('data', push);
  socket.on('error', () => { /* destroy follows */ });
  socket.on('close', () => {
    clients.delete(socket);
    for (const [wireId, waiter] of waiters) {
      if (waiter.socket === socket) waiters.delete(wireId);
    }
  });
}

const chromePush = framing.createParser('chrome', {
  onFrame(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'bind') onBind(msg);
    else if (msg.type === 'response') onResponse(msg);
  },
  onError() {
    console.error('rejected a Chrome frame; exiting so KastorFlow can start a fresh host');
    shutdown(1);
  },
});

process.stdin.on('data', chromePush);
process.stdin.on('end', () => shutdown(0));
process.stdin.on('close', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.stdin.resume();
console.log('ready');
