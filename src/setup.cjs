// @ts-check
'use strict';
/**
 * `kastorflow-notebooklm-mcp setup | uninstall | doctor` — register the native host Chrome starts for KastorFlow.
 *
 * Setup copies the three host files (no dependencies) to a stable per-user folder, writes a launcher that
 * runs them with this Node, writes the host manifest (allowed origin: the KastorFlow extension only), and
 * registers it for the current user: HKCU on Windows, the browser's NativeMessagingHosts folder elsewhere.
 * The manifest never holds a pairing token or a profile nonce. Nothing here needs administrator rights.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const paths = require('./paths.cjs');

const HOST_NAME = 'com.kastorflow.mcp';
/** The Chrome Web Store item (docs/08_Launch/store_item.json); unpacked copies carry the same key, so the same ID. */
const STORE_EXTENSION_ID = 'jailahmiboinemgfilghpagodjlahkho';
const HOST_FILES = ['native-host.cjs', 'framing.cjs', 'paths.cjs'];

/** @type {Record<string, { win: string, mac: string, linux: string }>} */
const BROWSERS = {
  chrome: { win: 'Software\\Google\\Chrome\\NativeMessagingHosts', mac: 'Google/Chrome', linux: 'google-chrome' },
  edge: { win: 'Software\\Microsoft\\Edge\\NativeMessagingHosts', mac: 'Microsoft Edge', linux: 'microsoft-edge' },
  brave: { win: 'Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts', mac: 'BraveSoftware/Brave-Browser', linux: 'BraveSoftware/Brave-Browser' },
  chromium: { win: 'Software\\Chromium\\NativeMessagingHosts', mac: 'Chromium', linux: 'chromium' },
};

/**
 * @typedef {{ extensionId: string, browsers: string[], platform: string, home: string, env: NodeJS.ProcessEnv,
 *   nodePath: string, dir: string, run: (file: string, args: string[]) => string }} SetupOptions
 */

/**
 * @param {string[]} argv
 * @param {Partial<SetupOptions>} [over]
 * @returns {SetupOptions}
 */
function options(argv, over) {
  /** @param {string} name @returns {string} */
  const flag = (name) => {
    const at = argv.indexOf('--' + name);
    if (at !== -1 && argv[at + 1]) return argv[at + 1];
    const eq = argv.find((a) => a.startsWith('--' + name + '='));
    return eq ? eq.slice(name.length + 3) : '';
  };
  const extensionId = (flag('extension-id') || STORE_EXTENSION_ID).trim();
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('The extension ID is 32 letters from a to p (chrome://extensions shows it).');
  const browsers = (flag('browser') || 'chrome').split(',').map((b) => b.trim().toLowerCase()).filter(Boolean);
  for (const b of browsers) if (!BROWSERS[b]) throw new Error('Unknown browser "' + b + '". Use chrome, edge, brave or chromium.');
  const platform = (over && over.platform) || process.platform;
  const env = (over && over.env) || process.env;
  const home = (over && over.home) || os.homedir();
  return Object.assign({
    extensionId,
    browsers,
    platform,
    home,
    env,
    nodePath: process.execPath,
    dir: paths.installDir({ platform, env, home }),
    run: (/** @type {string} */ file, /** @type {string[]} */ args) => execFileSync(file, args, { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
  }, over || {});
}

/** @param {SetupOptions} o @returns {string} */
function launcherPath(o) {
  return path.join(o.dir, o.platform === 'win32' ? 'kastorflow-host.cmd' : 'kastorflow-host');
}

/** @param {SetupOptions} o @returns {string} */
function manifestPath(o) {
  return path.join(o.dir, HOST_NAME + '.json');
}

/** @param {SetupOptions} o @param {string} browser @returns {string} where a POSIX browser looks for host manifests */
function posixHostDir(o, browser) {
  const b = BROWSERS[browser];
  if (o.platform === 'darwin') return path.join(o.home, 'Library', 'Application Support', b.mac, 'NativeMessagingHosts');
  return path.join(o.env.XDG_CONFIG_HOME || path.join(o.home, '.config'), b.linux, 'NativeMessagingHosts');
}

/** @param {SetupOptions} o @returns {any} */
function hostManifest(o) {
  return {
    name: HOST_NAME,
    description: 'KastorFlow local bridge for AI agents',
    path: launcherPath(o),
    type: 'stdio',
    allowed_origins: ['chrome-extension://' + o.extensionId + '/'],
  };
}

/**
 * @param {string[]} argv
 * @param {Partial<SetupOptions>} [over]
 * @returns {{ dir: string, manifest: string, registered: string[] }}
 */
function install(argv, over) {
  const o = options(argv, over);
  fs.mkdirSync(o.dir, { recursive: true });
  for (const file of HOST_FILES) fs.copyFileSync(path.join(__dirname, file), path.join(o.dir, file));
  const launcher = launcherPath(o);
  if (o.platform === 'win32') {
    fs.writeFileSync(launcher, '@echo off\r\n"' + o.nodePath + '" "%~dp0native-host.cjs" %*\r\n');
  } else {
    fs.writeFileSync(launcher, '#!/bin/sh\nexec "' + o.nodePath.replace(/"/g, '\\"') + '" "$(dirname "$0")/native-host.cjs" "$@"\n', { mode: 0o755 });
    fs.chmodSync(launcher, 0o755);
  }
  const manifest = manifestPath(o);
  fs.writeFileSync(manifest, JSON.stringify(hostManifest(o), null, 2) + '\n');
  /** @type {string[]} */
  const registered = [];
  for (const browser of o.browsers) {
    if (o.platform === 'win32') {
      const key = 'HKCU\\' + BROWSERS[browser].win + '\\' + HOST_NAME;
      o.run('reg', ['add', key, '/ve', '/t', 'REG_SZ', '/d', manifest, '/f']);
      registered.push(key);
    } else {
      const target = path.join(posixHostDir(o, browser), HOST_NAME + '.json');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(hostManifest(o), null, 2) + '\n');
      registered.push(target);
    }
  }
  return { dir: o.dir, manifest, registered };
}

/**
 * @param {string[]} argv
 * @param {Partial<SetupOptions>} [over]
 * @returns {{ removed: string[] }}
 */
function uninstall(argv, over) {
  const o = options(argv, over);
  /** @type {string[]} */
  const removed = [];
  for (const browser of o.browsers) {
    if (o.platform === 'win32') {
      const key = 'HKCU\\' + BROWSERS[browser].win + '\\' + HOST_NAME;
      try { o.run('reg', ['delete', key, '/f']); removed.push(key); } catch (_e) { /* not registered */ }
    } else {
      const target = path.join(posixHostDir(o, browser), HOST_NAME + '.json');
      if (fs.existsSync(target)) { fs.unlinkSync(target); removed.push(target); }
    }
  }
  if (fs.existsSync(o.dir)) { fs.rmSync(o.dir, { recursive: true, force: true }); removed.push(o.dir); }
  return { removed };
}

/**
 * @param {string[]} argv
 * @param {Partial<SetupOptions>} [over]
 * @returns {{ ok: boolean, lines: string[] }}
 */
function doctor(argv, over) {
  const o = options(argv, over);
  /** @type {string[]} */
  const lines = [];
  let ok = true;
  /** @param {boolean} pass @param {string} line */
  const check = (pass, line) => { lines.push((pass ? 'ok   ' : 'FIX  ') + line); if (!pass) ok = false; };
  const manifest = manifestPath(o);
  check(fs.existsSync(manifest), 'host manifest at ' + manifest + (fs.existsSync(manifest) ? '' : ' — run: npx kastorflow-notebooklm-mcp setup'));
  if (fs.existsSync(manifest)) {
    /** @type {any} */
    let m = null;
    try { m = JSON.parse(fs.readFileSync(manifest, 'utf8')); } catch (_e) { m = null; }
    check(!!m && fs.existsSync(m.path), 'launcher ' + (m ? m.path : '(unreadable manifest)'));
    check(!!m && Array.isArray(m.allowed_origins) && m.allowed_origins[0] === 'chrome-extension://' + o.extensionId + '/', 'allowed extension ' + o.extensionId);
    check(!!m && !JSON.stringify(m).match(/pair_|ses_|token/i), 'no credentials in the host manifest');
  }
  for (const file of HOST_FILES) check(fs.existsSync(path.join(o.dir, file)), 'host file ' + file);
  for (const browser of o.browsers) {
    if (o.platform === 'win32') {
      const key = 'HKCU\\' + BROWSERS[browser].win + '\\' + HOST_NAME;
      let value = '';
      try { value = o.run('reg', ['query', key, '/ve']); } catch (_e) { value = ''; }
      check(value.indexOf(manifest) !== -1, browser + ' registration ' + key);
    } else {
      const target = path.join(posixHostDir(o, browser), HOST_NAME + '.json');
      check(fs.existsSync(target), browser + ' registration ' + target);
    }
  }
  return { ok, lines };
}

module.exports = { install, uninstall, doctor, hostManifest, options, HOST_NAME, STORE_EXTENSION_ID, BROWSERS };
