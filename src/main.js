import './styles.css';

const DESKTOP_QUERY = '(min-width: 48em)';
const ACTIVE_LINE = 0.4; // fraction of the viewport height where a section becomes "current"
const INTENT_WINDOW_MS = 2000; // how long a clicked link wins over scroll position
const SCROLL_DEBOUNCE_MS = 150; // fallback for browsers without `scrollend`

const header = document.querySelector('.site-header');
const toggle = document.querySelector('.nav-toggle');
const menu = toggle && document.getElementById(toggle.getAttribute('aria-controls'));
const allNavLinks = Array.from(document.querySelectorAll('.site-nav__link'));
// A link marked aria-current="page" means this page is not the one-page scroller: no scroll-spy.
const isSpyPage = !allNavLinks.some((link) => link.getAttribute('aria-current') === 'page');

// Section a nav link stands for on this page, or null. `data-section` names a section whose
// link points at another page (the home "About" link); otherwise only pure hash links count.
function linkTargetId(link) {
  if (link.dataset.section) return link.dataset.section;
  const pureHash = link.getAttribute('href').startsWith('#');
  return pureHash && link.hash ? link.hash.slice(1) : null;
}

const navLinks = isSpyPage
  ? allNavLinks.filter((link) => document.getElementById(linkTargetId(link) ?? ''))
  : [];

/* ---------- Mobile menu ---------- */

function isMenuOpen() {
  return toggle?.getAttribute('aria-expanded') === 'true';
}

function setMenuOpen(open) {
  if (toggle) toggle.setAttribute('aria-expanded', String(open));
}

if (toggle && menu) {
  toggle.addEventListener('click', () => setMenuOpen(!isMenuOpen()));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isMenuOpen()) {
      setMenuOpen(false);
      toggle.focus();
    }
  });

  // Click outside the header closes the menu.
  document.addEventListener('click', (event) => {
    if (isMenuOpen() && !header.contains(event.target)) setMenuOpen(false);
  });

  // Reaching desktop width closes the menu.
  window.matchMedia(DESKTOP_QUERY).addEventListener('change', (event) => {
    if (event.matches) setMenuOpen(false);
  });
}

/* ---------- Scroll-spy ---------- */

const sections = navLinks
  .map((link) => document.getElementById(linkTargetId(link)))
  .filter(Boolean);
const sectionIds = new Set(sections.map((section) => section.id));

let intentId = null; // section the user just asked for by clicking a link
let intentTime = 0;
let intentPending = false; // true until the first scroll settles after the click

function markCurrent(id) {
  if (!id) return;
  for (const link of navLinks) {
    if (linkTargetId(link) === id) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  }
}

function sectionFromScroll() {
  if (!sections.length) return null;
  const root = document.documentElement;
  const atPageBottom =
    window.scrollY + window.innerHeight >= root.scrollHeight - 2 && window.scrollY > 0;
  if (atPageBottom) return sections[sections.length - 1].id;

  const line = window.innerHeight * ACTIVE_LINE;
  let current = sections[0];
  for (const section of sections) {
    if (section.getBoundingClientRect().top <= line) current = section;
  }
  return current.id;
}

function update() {
  markCurrent(intentId ?? sectionFromScroll());
}

function sectionIdFromHash(hash) {
  const id = decodeURIComponent(hash.replace(/^#/, ''));
  return sectionIds.has(id) ? id : null;
}

function setIntent(id) {
  intentId = id;
  intentTime = performance.now();
  intentPending = true;
  markCurrent(id);
}

function clearIntent() {
  if (!intentId) return;
  intentId = null;
  intentPending = false;
  update();
}

function onScrollSettled() {
  const intentActive = intentId && intentPending && performance.now() - intentTime < INTENT_WINDOW_MS;
  if (!intentActive) intentId = null;
  intentPending = false;
  update();
}

if ('onscrollend' in window) {
  window.addEventListener('scrollend', onScrollSettled);
} else {
  let timer;
  window.addEventListener(
    'scroll',
    () => {
      clearTimeout(timer);
      timer = setTimeout(onScrollSettled, SCROLL_DEBOUNCE_MS);
    },
    { passive: true },
  );
}

if ('IntersectionObserver' in window && sections.length) {
  const headerHeight = Math.round(header?.getBoundingClientRect().height ?? 0);
  const sectionObserver = new IntersectionObserver(update, {
    rootMargin: `-${headerHeight}px 0px -${100 - ACTIVE_LINE * 100}% 0px`,
  });
  sections.forEach((section) => sectionObserver.observe(section));

  const pageEnd = document.querySelector('[data-page-end]');
  if (pageEnd) new IntersectionObserver(update).observe(pageEnd);
}

// Any link click inside the header (menu links, brand, other pages) closes the menu.
header?.addEventListener('click', (event) => {
  if (event.target.closest('a') && isMenuOpen()) setMenuOpen(false);
});

// In-page anchor clicks (menu links, brand, buttons) set the scroll-spy intent.
document.addEventListener('click', (event) => {
  const anchor = event.target.closest('a[href^="#"]');
  if (!anchor) return;
  const id = sectionIdFromHash(anchor.hash);
  if (id) setIntent(id);
  else clearIntent();
});

window.addEventListener('hashchange', () => {
  const id = sectionIdFromHash(window.location.hash);
  if (id) setIntent(id);
  else clearIntent();
});

const initialId = sectionIdFromHash(window.location.hash);
if (initialId) setIntent(initialId);
else update();

// Manual scrolling cancels the click intent.
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

window.addEventListener('wheel', clearIntent, { passive: true });
window.addEventListener('touchmove', clearIntent, { passive: true });
window.addEventListener('keydown', (event) => {
  if (SCROLL_KEYS.has(event.key) && !event.target.closest?.('input, textarea, select, button')) {
    clearIntent();
  }
});

/* ---------- Footer year ---------- */

for (const el of document.querySelectorAll('[data-year]')) {
  el.textContent = String(new Date().getFullYear());
}
