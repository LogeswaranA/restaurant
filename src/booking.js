/**
 * Saffron & Sage — booking request form (booking.html only).
 *
 * This is a front-end demo with no backend: submitting never sends, stores or navigates. A valid
 * request is echoed back in an inline panel that asks the guest to phone the restaurant.
 *  1. Date limits: today up to today + 60 days, in the visitor's local time zone.
 *  2. Time slots built from OPENING_HOURS for the chosen date.
 *  3. Validation with the constraint validation API: inline text messages, aria-invalid and
 *     focus on the first problem.
 *  4. The demo summary panel and "Make another request".
 */

/**
 * Opening hours by weekday, indexed like Date#getDay() (0 = Sunday … 6 = Saturday), 24h "HH:MM".
 * Keep in sync with the "Opening hours" list in the footer of every page.
 */
const OPENING_HOURS = [
  ['11:00', '21:00'], // Sunday
  ['12:00', '22:00'], // Monday
  ['12:00', '22:00'], // Tuesday
  ['12:00', '22:00'], // Wednesday
  ['12:00', '22:00'], // Thursday
  ['12:00', '23:00'], // Friday
  ['12:00', '23:00'], // Saturday
];
const SLOT_INTERVAL_MIN = 30;
const LAST_SLOT_BEFORE_CLOSE_MIN = 60;
const MAX_DAYS_AHEAD = 60;

const TIME_PLACEHOLDER = {
  noDate: 'Choose a date first',
  slots: 'Choose a time',
  noTimesToday: 'No times left today – choose another date',
};

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/* ---------------------------------------------------------------------------
   Local date and time helpers
   Dates are local calendar days. `new Date('YYYY-MM-DD')` and toISOString() work in UTC and
   would give the wrong day near midnight, so neither is used here.
   --------------------------------------------------------------------------- */

const pad = (n) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" from the local calendar fields of a Date. */
function toDateValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** A local Date for a "YYYY-MM-DD" value, or null if it is not a real calendar day. */
function parseDateValue(value) {
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
function dateLimits(now) {
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
function slotsFor(date, now) {
  const [open, close] = OPENING_HOURS[date.getDay()].map(toMinutes);
  const earliest = toDateValue(date) === toDateValue(now) ? now.getHours() * 60 + now.getMinutes() : 0;
  const slots = [];
  for (let start = open; start <= close - LAST_SLOT_BEFORE_CLOSE_MIN; start += SLOT_INTERVAL_MIN) {
    if (start >= earliest) slots.push(toHHMM(start));
  }
  return slots;
}

/* ---------------------------------------------------------------------------
   Form
   --------------------------------------------------------------------------- */

const form = document.getElementById('booking-form');
const result = document.getElementById('booking-result');

if (form && result) initBookingForm(form, result);

function initBookingForm(form, result) {
  const fields = Array.from(form.querySelectorAll('input, select, textarea'));
  const field = (name) => form.elements.namedItem(name);
  const nameInput = field('name');
  const dateInput = field('date');
  const timeSelect = field('time');
  const partySelect = field('party');
  let timeState = 'noDate'; // which TIME_PLACEHOLDER the time select currently shows

  function applyDateLimits(now) {
    const { min, max } = dateLimits(now);
    dateInput.min = min;
    dateInput.max = max;
  }

  /** Rebuilds the time options for the chosen date, keeping the chosen time if it is still offered. */
  function renderTimeOptions(now) {
    const previous = timeSelect.value;
    const value = dateInput.value;
    const date = parseDateValue(value);
    const inRange = date && value >= dateInput.min && value <= dateInput.max;
    const slots = inRange ? slotsFor(date, now) : [];

    if (!inRange) timeState = 'noDate';
    else timeState = slots.length ? 'slots' : 'noTimesToday';

    timeSelect.replaceChildren(
      new Option(TIME_PLACEHOLDER[timeState], ''),
      ...slots.map((slot) => new Option(slot, slot)),
    );
    timeSelect.value = slots.includes(previous) ? previous : '';
  }

  function refresh() {
    const now = new Date();
    applyDateLimits(now); // the page may have stayed open past midnight
    renderTimeOptions(now); // drops times that have started since the list was built
  }

  function messageFor(input) {
    const { validity } = input;
    if (validity.valid) return '';
    switch (input.name) {
      case 'name':
        return 'Please enter your name.';
      case 'phone':
        return validity.valueMissing
          ? 'Please enter a phone number so we can reach you.'
          : 'Please enter a phone number with at least 7 digits, using only digits, spaces and + ( ) -.';
      case 'email':
        return 'Please enter an email address like name@example.com, or leave this field empty.';
      case 'date':
        if (validity.rangeUnderflow) return 'Please choose today or a later date.';
        if (validity.rangeOverflow) {
          return `We take requests up to ${MAX_DAYS_AHEAD} days ahead. Please choose an earlier date, or call us.`;
        }
        if (validity.badInput) return 'Please enter a complete date.';
        return 'Please choose a date.';
      case 'time':
        if (timeState === 'noTimesToday') return 'There are no times left today. Please choose another date.';
        if (timeState === 'noDate') return 'Please choose a date first, then a time.';
        return 'Please choose a time.';
      case 'party':
        return 'Please choose how many guests are coming.';
      case 'notes':
        return `Please keep your notes to ${input.maxLength} characters or fewer.`;
      default:
        return input.validationMessage;
    }
  }

  /** Shows or clears the inline message of one field. Returns true when the field is valid. */
  function validateField(input) {
    const message = messageFor(input);
    const error = document.getElementById(`${input.id}-error`);
    const describedBy = new Set((input.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean));

    if (message) {
      error.textContent = message;
      error.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      describedBy.add(error.id);
    } else {
      error.textContent = '';
      error.hidden = true;
      input.removeAttribute('aria-invalid');
      describedBy.delete(error.id);
    }

    if (describedBy.size) input.setAttribute('aria-describedby', [...describedBy].join(' '));
    else input.removeAttribute('aria-describedby');
    return !message;
  }

  function showResult() {
    const party = Number(partySelect.value);
    const echo = {
      name: nameInput.value.trim(),
      party: `${party} ${party === 1 ? 'guest' : 'guests'}`,
      date: DATE_FORMAT.format(parseDateValue(dateInput.value)),
      time: timeSelect.value,
    };
    // textContent only: the guest's own input is never parsed as HTML.
    for (const [key, text] of Object.entries(echo)) {
      result.querySelector(`[data-result="${key}"]`).textContent = text;
    }
    form.hidden = true;
    result.hidden = false;
    result.focus();
  }

  // Choosing a date rebuilds the time list.
  for (const type of ['input', 'change']) {
    dateInput.addEventListener(type, () => renderTimeOptions(new Date()));
  }

  // Once a field shows a message, it is re-checked as the guest corrects it.
  for (const type of ['input', 'change']) {
    form.addEventListener(type, (event) => {
      const input = event.target;
      if (input.getAttribute('aria-invalid') === 'true') validateField(input);
      if (input === dateInput && timeSelect.getAttribute('aria-invalid') === 'true') {
        validateField(timeSelect);
      }
    });
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault(); // nothing is ever sent: there is no backend
    refresh();
    const invalid = fields.filter((input) => !validateField(input));
    if (invalid.length) {
      invalid[0].focus();
      return;
    }
    showResult();
  });

  result.querySelector('[data-booking-again]').addEventListener('click', () => {
    result.hidden = true;
    form.hidden = false;
    refresh();
    nameInput.focus();
  });

  refresh();
}
