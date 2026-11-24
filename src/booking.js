/**
 * Saffron & Sage — booking request form (booking.html only).
 *
 * A valid request is POSTed as JSON to /api/bookings (the bookings API in server/, which stores it
 * in SQLite). The page never navigates. Only after a 201 is the request echoed back in an inline
 * panel that asks the guest to phone the restaurant; failures show an inline error instead.
 *  1. Date limits: today up to today + 60 days, in the visitor's local time zone.
 *  2. Time slots built from OPENING_HOURS for the chosen date.
 *  3. Validation with the constraint validation API: inline text messages, aria-invalid and
 *     focus on the first problem.
 *  4. The confirmation panel and "Make another request".
 *
 * The opening hours, date window and slot rules live in ./booking-rules.js, shared with the server.
 */

import { MAX_DAYS_AHEAD, dateLimits, parseDateValue, slotsFor } from './booking-rules.js';

const SAVE_FAILED = 'Could not save your booking, please try again';

const FIELD_LABELS = {
  name: 'Name',
  phone: 'Phone',
  email: 'Email',
  date: 'Date',
  time: 'Time',
  party: 'Party size',
  notes: 'Notes',
};

/** Message for a 400 from the API, built from the names of the fields it rejected. */
function messageFor400(fields) {
  const labels = (Array.isArray(fields) ? fields : []).map((name) => FIELD_LABELS[name]).filter(Boolean);
  if (!labels.length) return SAVE_FAILED;
  return `We could not accept some details (${labels.join(', ')}). Please check them and try again.`;
}

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
  const submitButton = form.querySelector('button[type="submit"]');
  const submitError = document.getElementById('booking-submit-error');
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

  function payload() {
    return {
      name: nameInput.value.trim(),
      phone: field('phone').value.trim(),
      email: field('email').value.trim(),
      date: dateInput.value,
      time: timeSelect.value,
      party: Number(partySelect.value),
      notes: field('notes').value.trim(),
    };
  }

  function showSubmitError(text) {
    submitError.textContent = text;
    submitError.hidden = false;
  }

  function hideSubmitError() {
    submitError.textContent = '';
    submitError.hidden = true;
  }

  let submitting = false;

  form.addEventListener('submit', async (event) => {
    event.preventDefault(); // the request is sent with fetch below, never by a page navigation
    if (submitting) return; // double click or Enter while in flight: one POST only
    hideSubmitError();
    refresh();
    const invalid = fields.filter((input) => !validateField(input));
    if (invalid.length) {
      invalid[0].focus();
      return;
    }
    submitting = true;
    submitButton.disabled = true;
    try {
      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload()),
      });
      if (response.status === 201) {
        showResult();
        return;
      }
      const body = response.status === 400 ? await response.json().catch(() => null) : null;
      showSubmitError(response.status === 400 ? messageFor400(body?.fields) : SAVE_FAILED);
    } catch {
      showSubmitError(SAVE_FAILED);
    } finally {
      submitting = false;
      submitButton.disabled = false;
    }
  });

  result.querySelector('[data-booking-again]').addEventListener('click', () => {
    hideSubmitError();
    result.hidden = true;
    form.hidden = false;
    refresh();
    nameInput.focus();
  });

  refresh();
}
