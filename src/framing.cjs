// @ts-check
'use strict';
/**
 * Two framings that must not be mixed.
 * IPC (agent socket): magic KF, version 1, reserved 0, uint32 big-endian length, UTF-8 JSON.
 * Chrome native messaging: uint32 little-endian length, UTF-8 JSON.
 * Maximum payload 1_048_576 bytes, the same cap as the extension contract.
 */

const MAX_FRAME_BYTES = 1048576;

/**
 * @param {unknown} value
 * @returns {Buffer}
 */
function encodeIpc(value) {
  return encode(value, 'ipc');
}

/**
 * @param {unknown} value
 * @returns {Buffer}
 */
function encodeChrome(value) {
  return encode(value, 'chrome');
}

/**
 * @param {unknown} value
 * @param {'ipc'|'chrome'} kind
 * @returns {Buffer}
 */
function encode(value, kind) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (body.length > MAX_FRAME_BYTES) {
    const err = new Error('frame_too_large');
    /** @type {any} */ (err).code = 'frame_too_large';
    throw err;
  }
  if (kind === 'ipc') {
    const header = Buffer.alloc(8);
    header.write('KF', 0, 'ascii');
    header.writeUInt8(1, 2);
    header.writeUInt8(0, 3);
    header.writeUInt32BE(body.length, 4);
    return Buffer.concat([header, body]);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

/**
 * @param {'ipc'|'chrome'} kind
 * @param {{ onFrame: (msg: any) => void, onError: (err: Error) => void }} handlers
 * @returns {(chunk: Buffer) => void}
 */
function createParser(kind, handlers) {
  let buf = Buffer.alloc(0);
  let dead = false;
  return function push(chunk) {
    if (dead) return;
    buf = Buffer.concat([buf, chunk]);
    while (!dead) {
      if (kind === 'ipc') {
        if (buf.length < 8) return;
        const magic = buf.slice(0, 2).toString('ascii');
        const version = buf[2];
        const reserved = buf[3];
        const len = buf.readUInt32BE(4);
        if (magic !== 'KF' || version !== 1 || reserved !== 0 || len > MAX_FRAME_BYTES) {
          dead = true;
          buf = Buffer.alloc(0);
          handlers.onError(Object.assign(new Error('bad_frame'), { code: 'bad_frame' }));
          return;
        }
        if (buf.length < 8 + len) return;
        const body = buf.slice(8, 8 + len).toString('utf8');
        buf = buf.slice(8 + len);
        emit(body);
      } else {
        if (buf.length < 4) return;
        const len = buf.readUInt32LE(0);
        if (len > MAX_FRAME_BYTES) {
          dead = true;
          buf = Buffer.alloc(0);
          handlers.onError(Object.assign(new Error('bad_frame'), { code: 'bad_frame' }));
          return;
        }
        if (buf.length < 4 + len) return;
        const body = buf.slice(4, 4 + len).toString('utf8');
        buf = buf.slice(4 + len);
        emit(body);
      }
    }
  };

  /** @param {string} body */
  function emit(body) {
    try {
      handlers.onFrame(JSON.parse(body));
    } catch (err) {
      dead = true;
      buf = Buffer.alloc(0);
      handlers.onError(err instanceof Error ? err : new Error('bad_frame'));
    }
  }
}

module.exports = {
  MAX_FRAME_BYTES,
  encodeIpc,
  encodeChrome,
  createParser,
};
