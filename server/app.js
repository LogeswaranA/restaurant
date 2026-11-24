import { validateBooking } from '../src/booking-rules.js';

export const MAX_BODY_BYTES = 16 * 1024;

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

function send(res, status, body, extra = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { ...HEADERS, ...extra });
  res.end(JSON.stringify(body));
}

/** Reads the body, rejecting with {tooLarge:true} past MAX_BODY_BYTES. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        done = true;
        reject({ tooLarge: true });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!done) {
        done = true;
        resolve(Buffer.concat(chunks).toString('utf8'));
      }
    });
    req.on('error', (err) => {
      if (!done) {
        done = true;
        reject(err);
      }
    });
  });
}

export function createBookingHandler({ insertBooking, now = () => new Date() }) {
  async function handle(req, res) {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');

    if (pathname === '/api/health') {
      if (req.method === 'GET' || req.method === 'HEAD') return send(res, 200, { status: 'ok' });
      return send(res, 405, { error: 'method_not_allowed' }, { Allow: 'GET, HEAD' });
    }

    if (pathname !== '/api/bookings') return send(res, 404, { error: 'not_found' });
    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });

    const mediaType = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (mediaType !== 'application/json') return send(res, 415, { error: 'unsupported_media_type' });

    const tooLarge = () => {
      send(res, 413, { error: 'payload_too_large' }, { Connection: 'close' });
      req.resume();
    };
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return tooLarge();

    let raw;
    try {
      raw = await readBody(req);
    } catch (err) {
      if (err?.tooLarge) return tooLarge();
      throw err;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return send(res, 400, { error: 'invalid_json', fields: [] });
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return send(res, 400, { error: 'invalid_body', fields: [] });
    }

    const current = now();
    const result = validateBooking(parsed, current);
    if (!result.ok) return send(res, 400, { error: 'invalid_booking', fields: result.fields });

    const saved = insertBooking(result.booking, current.toISOString());
    return send(res, 201, { id: saved.id, created_at: saved.created_at });
  }

  return (req, res) => {
    handle(req, res).catch((err) => {
      // Never log bodies or err.message: they can hold personal data.
      console.error('[bookings] request failed:', err?.code ?? err?.name ?? 'Error');
      send(res, 500, { error: 'internal' });
    });
  };
}
