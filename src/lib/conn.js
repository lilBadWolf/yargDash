// Connection to the yargDash server (server/server.mjs), which also serves this page: SSE in, HTTP POST out.
import { reactive } from 'vue';
import { onYargMessage } from './yarg.js';

export const conn = reactive({
  connected: false, // connected to the server?
  lan: [],          // the server computer's LAN addresses (for QR codes)
  code: '',         // the server's code fingerprint
});

let es = null;
export function connect() {
  es?.close();
  es = new EventSource('/events');
  es.onopen = () => { conn.connected = true; };
  es.onerror = () => { conn.connected = false; };
  es.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'snapshot') { conn.lan = msg.lan || []; conn.code = msg.code || ''; }
    onYargMessage(msg);
  };
}

export function post(path, body) {
  // text/plain avoids a CORS preflight; the server parses JSON regardless
  return fetch(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
}
