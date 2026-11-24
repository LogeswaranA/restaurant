/**
 * Saffron & Sage — booking rules shared by the browser form (src/booking.js) and the bookings API
 * (server/app.js). Pure and DOM-free: keep it that way, the server imports this file directly.
 */

/**
 * Opening hours by weekday, indexed like Date#getDay() (0 = Sunday … 6 = Saturday), 24h "HH:MM".
 * Keep in sync with the "Opening hours" list in the footer of every page.
 */
export const OPENING_HOURS = [
  ['11:00', '21:00'], // Sunday
  ['12:00', '22:00'], // Monday
  ['12:00', '22:00'], // Tuesday
  ['12:00', '22:00'], // Wednesday
  ['12:00', '22:00'], // Thursday
  ['12:00', '23:00'], // Friday
  ['12:00', '23:00'], // Saturday
];
export const SLOT_INTERVAL_MIN = 30;
export const LAST_SLOT_BEFORE_CLOSE_MIN = 60;
export const MAX_DAYS_AHEAD = 60;
export const PARTY_MIN = 1;
export const PARTY_MAX = 8;
/** Same as the maxlength attributes in booking.html. */
export const FIELD_LIMITS = { name: 80, phone: 30, email: 254, notes: 500 };
/** Same as the pattern attribute of the phone input in booking.html. */
export const PHONE_PATTERN = /^(?:[\s+\-()]*[0-9]){7,}[\s+\-()]*$/;
/** The WHATWG rule for <input type="email">. */
export const EMAIL_PATTERN =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
export const BOOKING_FIELDS = ['name', 'phone', 'email', 'date', 'time', 'party', 'notes'];

/* ---------------------------------------------------------------------------
   Local date and time helpers
   Dates are local calendar days. `new Date('YYYY-MM-DD')` and toISOString() work in UTC and
   would give the wrong day near midnight, so neither is used here.
   --------------------------------------------------------------------------- */

const pad = (n) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" from the local calendar fields of a Date. */
export function toDateValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A local Date for a "YYYY-MM-DD" value, or null if it is not a real calendar day. */
export function parseDateValue(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day);
  return toDateValue(date) === value ? date : null;
}

const toMinutes = (hhmm) => {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return hours * 60 + minutes;
};

const toHHMM = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** The first and last day a request can be made for, as "YYYY-MM-DD". */
export function dateLimits(now) {
  const [year, month, day] = [now.getFullYear(), now.getMonth(), now.getDate()];
  return {
    min: toDateValue(new Date(year, month, day)),
    max: toDateValue(new Date(year, month, day + MAX_DAYS_AHEAD)),
  };
}

/**
 * Start times for a local date: every 30 minutes from opening up to one hour before closing.
 * On today's date, times that have already started are dropped (the current minute is kept).
 */
export function slotsFor(date, now) {
  const [open, close] = OPENING_HOURS[date.getDay()].map(toMinutes);
  const earliest = toDateValue(date) === toDateValue(now) ? now.getHours() * 60 + now.getMinutes() : 0;
  const slots = [];
  for (let start = open; start <= close - LAST_SLOT_BEFORE_CLOSE_MIN; start += SLOT_INTERVAL_MIN) {
    if (start >= earliest) slots.push(toHHMM(start));
  }
  return slots;
}

/* ---------------------------------------------------------------------------
   Validation
   --------------------------------------------------------------------------- */

/**
 * @param input parsed JSON body (any shape)
 * @param now Date, the server-local "today" and current time
 * @returns {{ok: true, booking: object} | {ok: false, fields: string[]}}
 */
export function validateBooking(input, now = new Date()) {
  const bad = new Set();
  const src = input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {};
  if (src !== input) return { ok: false, fields: [...BOOKING_FIELDS] };

  const text = (key, required) => {
    const raw = src[key];
    if (raw === undefined || raw === null) {
      if (required) bad.add(key);
      return null;
    }
    if (typeof raw !== 'string') {
      bad.add(key);
      return null;
    }
    const value = raw.trim();
    if (value.length > FIELD_LIMITS[key]) bad.add(key);
    if (!value) {
      if (required) bad.add(key);
      return null;
    }
    return value;
  };

  const name = text('name', true);
  const phone = text('phone', true);
  if (phone !== null && !PHONE_PATTERN.test(phone)) bad.add('phone');
  const email = text('email', false);
  if (email !== null && !EMAIL_PATTERN.test(email)) bad.add('email');
  const notes = text('notes', false);

  // date and time
  const dateRaw = src.date;
  const timeRaw = src.time;
  const date = typeof dateRaw === 'string' ? parseDateValue(dateRaw) : null;
  const { min, max } = dateLimits(now);
  const dateOk = date !== null && dateRaw >= min && dateRaw <= max;
  if (!dateOk) bad.add('date');
  if (typeof timeRaw !== 'string' || !/^\d{2}:\d{2}$/.test(timeRaw)) bad.add('time');
  else if (dateOk && !slotsFor(date, now).includes(timeRaw)) bad.add('time');

  const party = src.party;
  if (typeof party !== 'number' || !Number.isInteger(party) || party < PARTY_MIN || party > PARTY_MAX) {
    bad.add('party');
  }

  if (bad.size) return { ok: false, fields: BOOKING_FIELDS.filter((f) => bad.has(f)) };
  return { ok: true, booking: { name, phone, email, date: dateRaw, time: timeRaw, party, notes } };
}
