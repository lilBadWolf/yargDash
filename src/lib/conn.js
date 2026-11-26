// Connection to the yargDash server (server/server.mjs), which also serves this page: SSE in, HTTP POST out.
import { reactive } from 'vue';
import { onYargMessage } from './yarg.js';
import { onLibraryMessage } from './library.js';
import { onEncoreMessage } from './encore.js';

export const conn = reactive({
  connected: false, // connected to the server?
  lan: [],          // the server computer's LAN addresses (for QR codes)
  code: '',         // the server's code fingerprint
  app: false,       // the server runs inside the desktop app
  platform: '',     // the server computer's OS (darwin | win32 | linux)
});

let es = null;
export function connect() {
  es?.close();
  es = new EventSource('/events');
  es.onopen = () => { conn.connected = true; };
  es.onerror = () => { conn.connected = false; };
  es.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'snapshot') { conn.lan = msg.lan || []; conn.code = msg.code || ''; conn.app = !!msg.app; conn.platform = msg.platform || ''; }
    onYargMessage(msg);
    onLibraryMessage(msg);
    onEncoreMessage(msg);
  };
}

export function post(path, body) {
  // text/plain avoids a CORS preflight; the server parses JSON regardless
  return fetch(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
}
