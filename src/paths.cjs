// @ts-check
'use strict';
/**
 * Where the native host listens for one browser profile (its nonce), and where setup installs the host.
 *
 * Windows: a named pipe. POSIX: a socket inside a directory only this user can enter:
 * $XDG_RUNTIME_DIR/kastorflow/, else <tmpdir>/kastorflow-<uid>/. The temp folder itself is never changed.
 */

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

/**
 * @param {string} nonce
 * @returns {string}
 */
function safeNonce(nonce) {
  const safe = String(nonce || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  if (!safe) {
    const err = new Error('profile nonce is missing');
    /** @type {any} */ (err).code = 'profile_mismatch';
    throw err;
  }
  return safe;
}

/**
 * @param {{ platform?: string, env?: NodeJS.ProcessEnv, uid?: number, tmpdir?: string }} [opts]
 * @returns {string} the private directory for POSIX sockets
 */
function socketDir(opts) {
  const src = opts || {};
  const env = src.env || process.env;
  if (env.XDG_RUNTIME_DIR) return path.join(env.XDG_RUNTIME_DIR, 'kastorflow');
  const uid = src.uid != null ? src.uid : (typeof process.getuid === 'function' ? process.getuid() : 0);
  return path.join(src.tmpdir || os.tmpdir(), 'kastorflow-' + uid);
}

/**
 * @param {string} nonce
 * @param {{ platform?: string, env?: NodeJS.ProcessEnv, uid?: number, tmpdir?: string }} [opts]
 * @returns {string}
 */
function socketPathFor(nonce, opts) {
  const src = opts || {};
  const platform = src.platform || process.platform;
  const safe = safeNonce(nonce);
  if (platform === 'win32') return '\\\\.\\pipe\\kastorflow-' + safe;
  return path.join(socketDir(src), safe + '.sock');
}

/**
 * Create (or check) the private socket directory: a real directory, owned by this user, mode 0700.
 * Another user who made the directory first cannot capture the socket.
 * @param {string} dir
 * @returns {void}
 */
function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(dir);
  const uid = typeof process.getuid === 'function' ? process.getuid() : st.uid;
  if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== uid) {
    const err = new Error('socket directory is not private: ' + dir);
    /** @type {any} */ (err).code = 'unsafe_socket_dir';
    throw err;
  }
  if ((st.mode & 0o077) !== 0) fs.chmodSync(dir, 0o700);
}

/**
 * Where `kastorflow-notebooklm-mcp setup` installs the native host (a stable path; npx's cache is not one).
 * @param {{ platform?: string, env?: NodeJS.ProcessEnv, home?: string }} [opts]
 * @returns {string}
 */
function installDir(opts) {
  const src = opts || {};
  const platform = src.platform || process.platform;
  const env = src.env || process.env;
  const home = src.home || os.homedir();
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'KastorFlow', 'mcp-host');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'KastorFlow', 'mcp-host');
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'kastorflow', 'mcp-host');
}

module.exports = { socketPathFor, socketDir, ensurePrivateDir, installDir };
