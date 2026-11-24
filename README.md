# Saffron & Sage — restaurant website

A small multi-page restaurant website theme, built with [Vite](https://vite.dev) and plain
HTML, CSS and JavaScript (ES modules). There is no framework, no router and no runtime dependency.
It has two pages that share the same header, navigation and footer:

- `index.html`: the scrolling landing page described below.
- `booking.html`: the booking page with a "Book a table" request form (see [Booking page](#booking-page)).

The landing page has these parts (the navigation bar links to Home, About, Gallery and Contact):

1. **Hero** (`#home`): the restaurant name, a tagline and two buttons: "View Gallery" and "Reserve a Table".
2. **About us** (`#about`): the restaurant's story and what it stands for.
3. **Founders' message** (`#founders`, directly after About): a short text-only note from the founders.
   The copy and names are placeholders in `index.html` (marked with an HTML comment); replace them.
   It has no navigation link.
4. **Gallery** (`#gallery`): a responsive grid of dish photos (1 column on phones, 2 on tablets, 3 on desktops).
5. **Feedback** (`#feedback`): a static Feedback section with three placeholder guest testimonials
   (no form, no navigation link). Replace the quotes in `index.html` with real feedback.
6. **Footer** (`#contact`): address, opening hours, phone, email, social links and copyright.

All names, addresses, phone numbers and emails are **placeholders** (the email uses the reserved
`.example` domain). Replace them before you publish.

The site makes no requests to other sites: fonts come from the system font stack and every image
is served from `public/images/`.

## Booking page

`booking.html` (linked as "Book" in the navigation and from the hero's "Reserve a Table" button)
holds a table-request form: name, phone, optional email, date, time, party size (1–8) and optional
notes. The date can be today up to 60 days ahead, in the visitor's local time zone, and the time
slots follow the opening hours (every 30 minutes, the last one an hour before closing).

Valid requests are saved by a small Node API backed by SQLite:

- the form POSTs JSON to `/api/bookings` with `fetch` (no page navigation). The page shows its
  summary only after the API answers `201`; on a network error or a server error it shows
  "Could not save your booking, please try again" and keeps everything the guest typed;
- the API (`server/`) validates every field again with the same rules as the page
  (`src/booking-rules.js`) and inserts the row with parameterised queries. It exposes only
  `POST /api/bookings` and `GET /api/health`: there is no endpoint to list or read bookings;
- the browser itself stores nothing (no cookies, `localStorage` or `sessionStorage`);
- a saved request is not a reservation: the summary asks the guest to call the restaurant.

### Storage (SQLite)

Bookings go into one table, `bookings`, in a SQLite file using Node's built-in `node:sqlite`
module (no extra dependency; it needs Node 22.13+).

| Variable | Default | Meaning |
| --- | --- | --- |
| `BOOKINGS_DB_PATH` | `data/bookings.db` | Path of the SQLite file. The folder is created if missing. |
| `PORT` | `8787` | Port of the API, which listens on `127.0.0.1` only. |
| `TZ` | system time zone | Set it to the restaurant's time zone: the API applies the date window and the time slots in its own local time. |

- `npm run start:api` starts the API alone. `npm run dev` starts the API and the Vite dev server together.
- `npm run preview` (and `npm test`) proxy `/api` to the API, so the API must be running for bookings
  to be saved from a preview.
- To deploy, serve `dist/` as static files and run the API (`npm run start:api`) behind the same
  host, with your web server forwarding `/api` to it.
- **The database holds personal data** (name, phone, email, notes). `data/` and `*.db` are
  git-ignored: never commit them, back them up and delete them according to your privacy rules.
  The API does not log request bodies.

The validation, date limits and time slots live in `src/booking-rules.js` (shared by the page and
the API). The opening hours there (`OPENING_HOURS`) must match the "Opening hours" list in the
footer of every page.

## Requirements

- Node.js 22.13+ (needed by `node:sqlite`; Vite 8 itself needs 20.19+ or 22.12+)
- npm

## Getting started

```bash
npm install                      # install Vite and Playwright (dev dependencies only)
npx playwright install chromium  # one-off: download the browser the tests use
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the bookings API (port 8787) and the Vite dev server with hot reload at <http://localhost:5173>, which proxies `/api`. |
| `npm run dev:web` | Starts only the Vite dev server (bookings cannot be saved without the API). |
| `npm run start:api` | Starts only the bookings API on `127.0.0.1:8787`, storing to `BOOKINGS_DB_PATH`. |
| `npm run build` | Builds the production site into `dist/`. |
| `npm run preview` | Serves the built `dist/` folder locally to check the production build. |
| `npm test` | Builds the site, starts the API (port 8787, test database a fresh per-run file in the OS temp folder), serves the site with `vite preview` on port 4173 and runs the Playwright tests in Chromium. Both ports must be free. |

To deploy, run `npm run build`, upload `dist/` to a host and run the API behind `/api` (see [Storage (SQLite)](#storage-sqlite)).

## Project structure

```text
.
├── index.html              # landing page: header/nav, hero, about, gallery, footer
├── booking.html            # booking page: same header/footer, client-side booking request form
├── vite.config.js          # lists every HTML page as a build input (add new pages here); proxies /api
├── server/
│   ├── index.js            # bookings API entry point (node:http, 127.0.0.1:8787)
│   ├── app.js              # routes, body limits, validation, safe error responses
│   └── db.js               # SQLite file (node:sqlite), schema and the parameterised insert
├── scripts/dev.js          # `npm run dev`: starts the API and Vite together
├── src/
│   ├── main.js             # mobile menu toggle, active nav link, footer year (all pages)
│   ├── booking.js          # booking form: validation, POST to /api/bookings, summary
│   ├── booking-rules.js    # opening hours, date window, slots and validation shared with the API
│   └── styles.css          # theme variables, layout and components (mobile-first)
├── public/                 # copied as-is into dist/
│   ├── favicon.svg
│   └── images/             # hero and dish photos
│       └── CREDITS.md      # author, source and licence for every image
├── tests/
│   ├── landing.spec.js     # Playwright smoke tests (one or more per acceptance criterion)
│   ├── acceptance.spec.js  # acceptance tests for the landing page
│   ├── booking.spec.js     # acceptance tests for the booking page
│   └── booking-submit.spec.js # booking submit flow: real API + SQLite, errors, double click
├── playwright.config.js    # starts the API and `vite preview` (port 4173) for the tests
└── package.json            # scripts and dev dependencies
```

## Theming

Colours, fonts, spacing and radii are CSS custom properties at the top of `src/styles.css`
(`:root { --color-… ; --font-… }`). Change them there and the whole page follows. The hero overlay
is set by `--hero-overlay-top` and `--hero-overlay-bottom`. Keep it dark enough for the white
heading to stay readable: the tests check a contrast of at least 4.5:1.

## Editing copy

Landing-page text lives in `index.html` and booking-page text in `booking.html`. The header and
footer are repeated in both files, so change them in both:

- **Restaurant name and tagline**: the `<h1>` and `.hero__tagline` in `section#home`. Also update the
  `<title>`, the `<meta name="description">` and the `.brand` link in the header.
- **Buttons**: "View Gallery" links to `#gallery`. "Reserve a Table" links to the booking page,
  `/booking.html`. The phone number for real reservations is the `tel:` link in the footer.
- **About us**: the `<h2>` and paragraphs in `section#about`, plus the three `.highlight` items.
- **Gallery captions**: each dish's `.dish__name` and `.dish__desc` inside its `<figcaption>`.
- **Footer**: the `<address>`, the opening hours (`<dl class="hours">`), the phone and email links and
  the social links. Each social link needs a meaningful `aria-label`, for example
  "Saffron & Sage on Instagram". Replace the `href="#"` with your real profile URLs.
- The copyright year is filled in automatically by `src/main.js`.

If you rename or add a section, also update its link in the header `<nav>` of both pages. The
active-link highlighting in `src/main.js` works from those links. To add another page, create the
HTML file at the project root, copy the header and footer, and add it to `build.rollupOptions.input`
in `vite.config.js`, otherwise `npm run build` leaves it out.

## Swapping images

1. Put the new file in `public/images/`, ideally a JPEG around 960 px wide (hero: about 1600 px)
   and under 300 KB. Reference it with an absolute path such as `/images/my-dish.jpg`.
2. **Gallery**: in `index.html`, change the `<img>` inside the dish's `<figure>`:
   - `src`: the new file path;
   - `alt`: a specific description of what is on the plate, for example "Seared salmon with
     grilled potatoes and dill" (not "photo" or "dish 3"). Every alt text must be unique;
   - `width` / `height`: the image's real pixel size, so the layout does not jump while it loads;
   - keep `loading="lazy"`.
3. **Hero**: change the `url(...)` in the `.hero` background in `src/styles.css`. The hero image is
   loaded straight away (not lazily) because it is visible on first paint.
4. **Update `public/images/CREDITS.md`**: add a row with the file name, author, source URL and
   licence. For a self-made or generated image, write `placeholder` in the Source column. The tests
   fail if an image used on the page is missing from this file.
5. Never hotlink images from another site: copy them into `public/images/`.

## Image credits

The photos come from Wikimedia Commons under CC BY / CC BY-SA licences. Authors, source links
and licences are listed in [`public/images/CREDITS.md`](public/images/CREDITS.md). The built site
also links to them from the footer. Keep that attribution when you publish the site.

## Accessibility

- Semantic landmarks (`header`/`nav`, `main`, `footer`), one `h1`, and headings in order.
- A "Skip to content" link, visible keyboard focus rings and tap targets of at least 44×44 px.
- A mobile menu button with `aria-expanded`/`aria-controls`. It closes with Escape or when you
  choose a link.
- The current section is marked with `aria-current="true"` in the navigation; on the booking page
  the "Book" link carries `aria-current="page"` instead.
- Booking form fields have visible labels; errors are shown as text next to the field, linked with
  `aria-describedby`, and the saved-request summary is announced as a status message.
- Smooth scrolling and hover animations are turned off when the visitor has "reduce motion" set.
