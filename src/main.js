/**
 * Saffron & Sage — landing page behaviour.
 *  1. Mobile navigation toggle (aria-expanded / aria-controls).
 *  2. Active nav link for the section in view (aria-current="true", exactly one).
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

  // A click outside the header closes the menu.
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
   An IntersectionObserver watches a band just below the sticky header; the
   last section (in document order) inside that band is the current one.
   A sentinel at the very end of the page marks the footer as current once the
   page cannot scroll any further. When the visitor follows an in-page link we
   honour that target until they scroll by themselves again.
   --------------------------------------------------------------------------- */

const sections = navLinks
  .map((link) => document.getElementById(link.hash.slice(1)))
  .filter(Boolean);
const sectionIds = new Set(sections.map((section) => section.id));

const inBand = new Set();
let atPageEnd = false;
let intendedId = null;

function setActive(id) {
  for (const link of navLinks) {
    if (link.hash === `#${id}`) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  }
}

function updateActive() {
  if (intendedId) return setActive(intendedId);
  if (atPageEnd && sections.length) return setActive(sections[sections.length - 1].id);
  const current = sections.filter((section) => inBand.has(section)).pop();
  if (current) setActive(current.id);
}

function targetIdFromHash(hash) {
  const id = decodeURIComponent(hash.replace(/^#/, ''));
  return sectionIds.has(id) ? id : null;
}

if ('IntersectionObserver' in window && sections.length) {
  const headerHeight = Math.round(header?.getBoundingClientRect().height ?? 0);

  const bandObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) inBand.add(entry.target);
        else inBand.delete(entry.target);
      }
      updateActive();
    },
    { rootMargin: `-${headerHeight}px 0px -60% 0px` },
  );
  sections.forEach((section) => bandObserver.observe(section));

  const pageEnd = document.querySelector('[data-page-end]');
  if (pageEnd) {
    new IntersectionObserver(([entry]) => {
      atPageEnd = entry.isIntersecting;
      updateActive();
    }).observe(pageEnd);
  }
} else {
  // Old browsers: highlight the first link so exactly one is marked.
  if (sections[0]) setActive(sections[0].id);
}

// In-page links (nav, brand, hero CTA): mark the target straight away, close the mobile menu.
document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href^="#"]');
  if (!link) return;
  if (menu?.contains(link)) setMenuOpen(false);
  const id = targetIdFromHash(link.hash);
  if (id) {
    intendedId = id;
    setActive(id);
  } else {
    releaseIntent();
  }
});

// Back/forward through anchors.
window.addEventListener('hashchange', () => {
  const id = targetIdFromHash(window.location.hash);
  if (id) {
    intendedId = id;
    setActive(id);
  }
});

// Deep link on first load (e.g. /#gallery).
const initialId = targetIdFromHash(window.location.hash);
if (initialId) {
  intendedId = initialId;
  setActive(initialId);
}

// Any scrolling the visitor does themselves hands control back to the observer.
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
function releaseIntent() {
  if (!intendedId) return;
  intendedId = null;
  updateActive();
}
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
