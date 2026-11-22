/**
 * Saffron & Sage — behaviour shared by every page (index.html, booking.html).
 *  1. Mobile navigation toggle (aria-expanded / aria-controls).
 *  2. Active nav link for the section in view (aria-current="true", exactly one). Pages whose
 *     nav marks their own link with aria-current="page" (booking.html) keep that marker instead.
 *  3. Current year in the footer.
 */
const DESKTOP_QUERY = '(min-width: 48em)'; // keep in sync with the nav breakpoint in styles.css

const header = document.querySelector('.site-header');
const toggle = document.querySelector('.nav-toggle');
const menu = toggle && document.getElementById(toggle.getAttribute('aria-controls'));
const navLinks = Array.from(document.querySelectorAll('.site-nav__link'));

/* ---------------------------------------------------------------------------
   1. Mobile navigation
   --------------------------------------------------------------------------- */

function isMenuOpen() {
  return toggle?.getAttribute('aria-expanded') === 'true';
}

function setMenuOpen(open) {
  if (!toggle) return;
  toggle.setAttribute('aria-expanded', String(open));
}

if (toggle && menu) {
  toggle.addEventListener('click', () => setMenuOpen(!isMenuOpen()));

  // Escape closes the menu and returns focus to the toggle.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isMenuOpen()) {
      setMenuOpen(false);
      toggle.focus();
    }
  });

  // A click outside the header closes the menu (links, brand included, close it below).
  document.addEventListener('click', (event) => {
    if (isMenuOpen() && !header.contains(event.target)) setMenuOpen(false);
  });

  // Growing past the breakpoint resets the menu state.
  window.matchMedia(DESKTOP_QUERY).addEventListener('change', (event) => {
    if (event.matches) setMenuOpen(false);
  });
}

/* ---------------------------------------------------------------------------
   2. Active section
   The current section is the last one (in document order) whose top has
   reached a reading line 40% down the viewport; once the page cannot scroll
   any further the last section (the footer) is current. It is recomputed from
   live geometry whenever an IntersectionObserver sees a section cross that
   band and again whenever scrolling ends, so scrollbar drags and scripted
   scrolling cannot leave a stale link behind.
   When the visitor follows an in-page link we honour that target (sections
   near the page end may never reach the reading line) for the scroll that the
   link starts; any later scroll hands control back to the geometry.
   --------------------------------------------------------------------------- */

const READING_LINE = 0.4; // fraction of the viewport height, matches the observer's -60% bottom margin
const INTENT_WINDOW_MS = 2000; // how long a link's own scroll may take to finish

// A page that marks its own nav link with aria-current="page" (e.g. booking.html) is not one of
// the sections the nav points at, even though "#contact" finds its footer. Scroll-spy stays off
// there, so it can never move or remove that marker.
const marksOwnPage = navLinks.some((link) => link.getAttribute('aria-current') === 'page');

const sections = marksOwnPage
  ? []
  : navLinks.map((link) => link.hash && document.getElementById(link.hash.slice(1))).filter(Boolean);
const sectionIds = new Set(sections.map((section) => section.id));

let intendedId = null;
let intentStartedAt = 0;
let intentScrollPending = false;

function setActive(id) {
  if (!id) return;
  for (const link of navLinks) {
    if (link.hash === `#${id}`) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  }
}

function currentSectionId() {
  if (!sections.length) return null;
  const root = document.documentElement;
  const atPageEnd = window.scrollY + window.innerHeight >= root.scrollHeight - 2;
  if (atPageEnd && window.scrollY > 0) return sections[sections.length - 1].id;
  const line = window.innerHeight * READING_LINE;
  let current = sections[0];
  for (const section of sections) {
    if (section.getBoundingClientRect().top <= line) current = section;
  }
  return current.id;
}

function updateActive() {
  setActive(intendedId ?? currentSectionId());
}

function targetIdFromHash(hash) {
  const id = decodeURIComponent(hash.replace(/^#/, ''));
  return sectionIds.has(id) ? id : null;
}

function startIntent(id) {
  intendedId = id;
  intentStartedAt = performance.now();
  intentScrollPending = true;
  setActive(id);
}

function releaseIntent() {
  if (!intendedId) return;
  intendedId = null;
  intentScrollPending = false;
  updateActive();
}

// Called once scrolling has settled (scrollend, or a short pause in scroll events).
function onScrollEnd() {
  const isLinkScroll =
    intendedId && intentScrollPending && performance.now() - intentStartedAt < INTENT_WINDOW_MS;
  if (isLinkScroll) {
    intentScrollPending = false; // the link's own scroll has landed; keep its target
  } else {
    intendedId = null; // scrollbar drag, scripted scroll, or anything else: trust the geometry
    intentScrollPending = false;
  }
  updateActive();
}

if ('onscrollend' in window) {
  window.addEventListener('scrollend', onScrollEnd);
} else {
  let scrollTimer;
  window.addEventListener(
    'scroll',
    () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(onScrollEnd, 150);
    },
    { passive: true },
  );
}

if ('IntersectionObserver' in window && sections.length) {
  const headerHeight = Math.round(header?.getBoundingClientRect().height ?? 0);
  const bandObserver = new IntersectionObserver(updateActive, {
    rootMargin: `-${headerHeight}px 0px -${100 - READING_LINE * 100}% 0px`,
  });
  sections.forEach((section) => bandObserver.observe(section));

  const pageEnd = document.querySelector('[data-page-end]');
  if (pageEnd) new IntersectionObserver(updateActive).observe(pageEnd);
}

// Any link closes the mobile menu (so it is not still open when the visitor comes back to this
// page). In-page links (nav, brand, hero CTA) also mark their target straight away.
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href]');
  if (!link) return;
  if (isMenuOpen()) setMenuOpen(false);
  if (!link.getAttribute('href').startsWith('#')) return;
  const id = targetIdFromHash(link.hash);
  if (id) startIntent(id);
  else releaseIntent();
});

// Back/forward through anchors, or a script setting location.hash.
window.addEventListener('hashchange', () => {
  const id = targetIdFromHash(window.location.hash);
  if (id) startIntent(id);
  else releaseIntent();
});

// Deep link on first load (e.g. /#gallery); otherwise start from the geometry.
const initialId = targetIdFromHash(window.location.hash);
if (initialId) startIntent(initialId);
else updateActive();

// Any scrolling the visitor does themselves hands control back to the geometry.
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
window.addEventListener('wheel', releaseIntent, { passive: true });
window.addEventListener('touchmove', releaseIntent, { passive: true });
window.addEventListener('keydown', (event) => {
  if (SCROLL_KEYS.has(event.key) && !event.target.closest?.('input, textarea, select, button')) {
    releaseIntent();
  }
});

/* ---------------------------------------------------------------------------
   3. Footer year
   --------------------------------------------------------------------------- */

for (const el of document.querySelectorAll('[data-year]')) {
  el.textContent = String(new Date().getFullYear());
}
