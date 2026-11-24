import http from 'node:http';
import { openBookingsDb, resolveDbPath } from './db.js';
import { createBookingHandler } from './app.js';

const port = Number(process.env.PORT ?? 8787);

let db;
try {
  db = openBookingsDb(resolveDbPath(process.env));
} catch {
  console.error('Could not open bookings DB (check BOOKINGS_DB_PATH)');
  process.exit(1);
}

const server = http.createServer(createBookingHandler({ insertBooking: db.insertBooking }));
server.on('clientError', (_err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  else socket.destroy();
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Bookings API on http://127.0.0.1:${port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  server.closeAllConnections?.();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
