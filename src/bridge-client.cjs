// @ts-check
'use strict';
/**
 * Agent-side socket client. Correlates replies by id and ignores a duplicate.
 * A dead socket reconnects on the next call. A call that was already sent is
 * not sent again.
 */

const net = require('node:net');
const crypto = require('node:crypto');
const framing = require('./framing.cjs');

/**
 * @param {string} socketPath
 * @param {{ timeoutMs?: number, attempts?: number, backoffMs?: number }} [options]
 */
function openBridge(socketPath, options) {
  const timeoutMs = options && options.timeoutMs ? options.timeoutMs : 30000;
  const attempts = options && options.attempts ? options.attempts : 4;
  const backoffMs = options && options.backoffMs ? options.backoffMs : 50;
  /** @type {Map<string, { resolve: (value: any) => void, timer: NodeJS.Timeout }>} */
  const pending = new Map();
  let frames = 0;
  /** @type {import('node:net').Socket|null} */
  let socket = null;
  let generation = 0;
  let closed = false;
  /** @type {Promise<void>|null} */
  let connecting = null;

  function unavailable(id) {
    return {
      type: 'response',
      id,
      ok: false,
      error: { code: 'connection_unavailable', message: 'KastorFlow is not connected. Open the browser and try again.' },
    };
  }

  function failPending() {
    for (const [id, waiter] of pending) {
      clearTimeout(waiter.timer);
      waiter.resolve(unavailable(id));
    }
    pending.clear();
  }

  /**
   * @param {import('node:net').Socket} next
   */
  function attach(next) {
    const push = framing.createParser('ipc', {
      onFrame(msg) {
        frames += 1;
        const id = msg && msg.id != null ? String(msg.id) : '';
        const waiter = pending.get(id);
        if (!waiter) return;
        clearTimeout(waiter.timer);
        pending.delete(id);
        waiter.resolve(msg);
      },
      onError() { next.destroy(); },
    });
    next.on('data', push);
    next.on('error', () => { /* close settles anything still pending */ });
    next.on('close', () => {
      if (socket === next) socket = null;
      failPending();
    });
  }

  function connectOnce() {
    return new Promise((resolve, reject) => {
      const next = net.createConnection(socketPath);
      const onError = (/** @type {Error} */ err) => {
        next.removeListener('connect', onConnect);
        reject(err);
      };
      const onConnect = () => {
        next.removeListener('error', onError);
        attach(next);
        socket = next;
        generation += 1;
        resolve(undefined);
      };
      next.once('error', onError);
      next.once('connect', onConnect);
    });
  }

  /** @param {number} ms */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function connect() {
    if (closed) return Promise.reject(Object.assign(new Error('closed'), { code: 'connection_unavailable' }));
    if (socket && !socket.destroyed) return Promise.resolve();
    if (connecting) return connecting;
    connecting = (async () => {
      /** @type {unknown} */
      let last = null;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (closed) break;
        try {
          await connectOnce();
          return;
        } catch (err) {
          last = err;
          if (attempt + 1 < attempts) await sleep(backoffMs * (attempt + 1));
        }
      }
      throw last || Object.assign(new Error('connection_unavailable'), { code: 'connection_unavailable' });
    })().finally(() => { connecting = null; });
    return connecting;
  }

  const ready = connect();

  /**
   * @param {Record<string, unknown>} fields
   * @returns {Promise<any>}
   */
  function request(fields) {
    const id = fields.id != null ? String(fields.id) : crypto.randomBytes(8).toString('hex');
    return connect().then(() => new Promise((resolve) => {
      if (!socket || socket.destroyed) {
        resolve(unavailable(id));
        return;
      }
      const timer = setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        resolve({
          type: 'response',
          id,
          ok: false,
          error: { code: 'connection_unavailable', message: 'The local bridge did not answer in time.' },
        });
      }, timeoutMs);
      pending.set(id, { resolve, timer });
      try {
        socket.write(framing.encodeIpc(Object.assign({}, fields, { id })));
      } catch (_err) {
        clearTimeout(timer);
        pending.delete(id);
        resolve(unavailable(id));
      }
    }), () => unavailable(id));
  }

  return {
    ready,
    request,
    get socket() { return socket; },
    generation() { return generation; },
    frameCount: () => frames,
    close() {
      closed = true;
      failPending();
      if (socket) socket.destroy();
    },
  };
}

module.exports = { openBridge };
