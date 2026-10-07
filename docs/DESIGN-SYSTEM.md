# RentCottage design system

This document owns how RentCottage's interface is built: which values are tokens and where they live, the literals
a stylesheet may still write, and the component patterns new work reuses. The Arabic, Sorani and English
presentation rules in the Hard constraints of [AGENTS.md](../AGENTS.md) are contracts, and the rules below are how
the code keeps them.

## Values live in the token block

- The only token block is `:root` in [globals.css](../src/app/globals.css). It holds every interface colour: the
  base palette `--background`, `--card`, `--ink`, `--muted`, `--green`, `--gold` and `--line`, then the groups
  Surfaces, Ink, Lines and accents, Brand tints, Shade over hero imagery, and Status. It also holds the font
  families `--display` and `--body`, the spacing scale `--space-1` to `--space-7`, the text size scale
  `--font-size-1` to `--font-size-6`, the corner radius, state ring and stacking order tokens named under Radius,
  shadow and stacking order, the component tokens named under Spacing and text size, and `color-scheme: light`. There is no Tailwind and no theme object.
- Interface colours, font families, spacing, text sizes, corner radii, state rings and stacking order come from
  these tokens through `var(--…)`. [globals.test.ts](../src/app/globals.test.ts) fails on a colour literal outside
  `:root`, on a custom property a stylesheet uses that `:root` does not declare, on a spacing or text size length
  that is neither a scale step nor listed under Tolerated literals, on a listed length that no stylesheet writes,
  on a `border-radius`, `box-shadow` or `z-index` value that is neither its token nor a tolerated literal, and on a
  width media query outside the list under Breakpoints.
- A colour or font a change needs that the block lacks is added to `:root` in the same change, named for its role
  (what it is for, not what it looks like). Two roles may share a value, each with its own token; one role never
  has two tokens.
- A translucent variant of a colour is its own token written as `rgb(r g b / a%)`. `color-mix()` and relative colour
  syntax are not used: they are newer than the browsers Next.js supports (Chrome, Edge and Firefox 111, Safari
  16.4).
- Styling lives in global classes in `src/app/globals.css`. A few feature components keep a CSS module beside
  them: `support.module.css` for the support page, and `administrator-payment-history`, `administrator-records`,
  `booking-financial-details`, `customer-reviews` and `owner-booking-earnings` in `src/components/`. A change
  styles a component where that component's styles already live.

## Spacing and text size

- Spacing steps `--space-1` to `--space-7` are 4, 8, 12, 16, 24, 32 and 48 pixels. Text size steps `--font-size-1`
  to `--font-size-6` are 13, 15, 17, 20, 26 and 34 pixels. They are written in `rem`, so they follow the reader's
  browser text size and the pixel figures are those at the browser default. `font-size` is never set on `html`,
  which would redefine every step.
- Every length in `margin`, `padding`, `gap` and `inset`, in any longhand or logical form, is a spacing step, and
  every `font-size` is a text size step. A value between two steps takes the nearer one, and the larger one when it
  is exactly halfway.
- Body text is `--font-size-3`, set on `body`.
- A fluid length is `clamp()` between two steps, and only its middle term is a viewport unit. A negative step is
  `calc(-1 * var(--space-N))`. `calc()`, `min()` and `max()` combine steps, percentages and unitless numbers.
- `line-height` is a unitless ratio and `letter-spacing` is written in `em`; neither is on a scale.
- Sizing lengths are literals: `width`, `height`, `inline-size`, `block-size`, their `min-` and `max-` forms,
  `flex-basis` and grid track sizes, including a gutter written inside one such as `calc(100% - 2.25rem)`. They are
  the dimensions of controls, images, columns and reading widths, which a seven-step spacing scale cannot express.
  New work reuses a size already in use.
- A component token holds a length only when several declarations must share it. `--booking-progress-marker` is the
  size of the progress step marker, which the connector line is positioned from. `--booking-progress-inset` and
  `--booking-progress-row-gap` are names for `--space-2` and `--space-4`: the connector is positioned from the
  step's end padding and the gap between rows, so each is declared once. `--hero-headline-gap-rtl` is `0.5em`, so
  the gap under the Arabic-script hero headline follows the fluid headline size, which no step can do. New work
  adds no component token for a spacing or text size value.

## Radius, shadow and stacking order

- Corner radius has two sizes, written in `rem`. `--radius-control` is 8 pixels and rounds what a person
  operates: a button, a link styled as a button, a form field, a stepper and a selectable option.
  `--radius-card` is 10 pixels and rounds every other surface: a card, panel, notice, tile, image frame, menu and
  list row.
- A pill is `999px`, a circle is `50%` and a square corner is `0`. They are shapes, not sizes, so they are
  literals.
- There is no elevation shadow. A surface is set apart by its background and its `1px` `--line` border;
  `text-shadow` and `drop-shadow()` are not used.
- `box-shadow` draws state rings only, each with no offset and no blur: `--shadow-focus` around a focused form
  field, `--shadow-invalid` around an invalid field or option, and `--shadow-pressed` inside a pressed toggle. A
  ring adds to the focus outline described under Accessibility conventions and never replaces it.
- Every `z-index` is one of four layers, lowest first: `--layer-raised` for content above a backdrop in its own
  block, as the hero copy is above its shade; `--layer-overlap` for a block that overlaps the one before it, as
  the search card overlaps the hero; `--layer-header` for the site header; and `--layer-menu` for a menu that
  opens over everything else.
- New work uses these tokens. A third radius, an elevation shadow or a fifth layer is decided in this document
  before a stylesheet writes it.

## Tolerated literals

A stylesheet may write these as literals:

- `0`, `auto`, `none` and `inherit`, hairline `1px` borders, `50%` and `999px` for circles and pills.
- Percentages and `fr` or flex sizing in layout, and the sizing lengths described under Spacing and text size.
- `currentColor` and `transparent`.
- Border and outline widths and offsets, and lengths inside `background`, `transform`, `backdrop-filter` and
  text-decoration properties. New work reuses a value already in use.
- Unitless `line-height` ratios and `letter-spacing` in `em`.
- The two component tokens that hold a length, `--hero-headline-gap-rtl` and `--booking-progress-marker`.
- The home page hero composition, whose three lengths lie beyond the largest step. The search card overlaps the
  photograph, and the copy clears the fixed header above it and the card below:
  - `.retreat-copy { padding-block: 11rem 8.5rem }`
  - `.retreat-copy { padding-block-end: 7.5rem }`
  - `.retreat-search { margin-block-start: -4rem }`
- Six display heading size declarations larger than the largest step, kept until #559 settles the page title style.
  Two of them are written on a rule that two headings share, so each entry names the whole rule:
  - `.retreat-copy h1 { font-size: clamp(2.5rem, 6vw, 4.4rem) }`
  - `.retreat-copy h1 { font-size: clamp(2.25rem, 12vw, 3.3rem) }`
  - `.results-intro h1 { font-size: clamp(2.6rem, 6vw, 4.5rem) }`
  - `.profile-heading h1, .request-layout h1 { font-size: clamp(2.5rem, 6vw, 4rem) }`
  - `.access-required-card h1 { font-size: clamp(2.2rem, 6vw, 3.5rem) }`
  - `.section-heading h2, .trusted-copy h2 { font-size: clamp(2rem, 4vw, 3rem) }`

The last three bullets are the complete list of spacing and text size exceptions.
[globals.test.ts](../src/app/globals.test.ts) reads the backticked rule entries and token names in this section, and
tolerates an entry's declaration only on the rule the entry names, so an entry is removed here when its declaration
leaves that rule. New work uses a step and adds no entry.

Anything else is a token.

## Component patterns

- [interaction-controls.tsx](../src/components/interaction-controls.tsx) holds the shared controls:
  - `ActionButton`: a primary, secondary or toggle button (`.action`, `.action-primary`, `.action-secondary`,
    `.action-toggle`, sized by `.action-compact` or `.action-regular` and `.action-content` or `.action-full`). A pending button sets
    `aria-busy` and is disabled.
  - `ActionLink`: a link styled as a primary, secondary or text action (`.action-link`, `.action-text`).
  - `FormControl`: an input, select or textarea with `.form-control`, which shows `aria-invalid` as an error
    border.
  - `ActionFeedback`: the success or error message after an action (`.action-feedback`).
- `.field-error` in `src/app/globals.css` styles the message beside an invalid field.
- [use-exclusive-action.ts](../src/components/use-exclusive-action.ts) blocks a second submit while one is in
  flight and supplies the `pending` state the buttons show.
- Site chrome is `site-header.tsx`, `site-footer.tsx` and `marketplace-shell.tsx` in `src/components/`; the
  language selector is `locale-links.tsx`.
- Backoffice navigation: `BackofficeNavigation` in
  [backoffice-navigation.tsx](../src/components/backoffice-navigation.tsx) is the one navigation of the Owner
  Backoffice and the Platform Administrator pages, and owns each area's list of destinations. It is a server
  component. A page renders it as the first child of `<main>`, only in a branch that has passed that page's own
  access check, names its destination with `current`, and adds `nested` on a page beneath that destination. It
  renders `nav.backoffice-navigation`, named by its visible area label through `aria-labelledby`, with each
  destination a secondary content-width `ActionLink`, so every link keeps the shared control height and focus
  outline. The current destination carries `aria-current="page"`, or `aria-current="true"` on a nested page, and
  is underlined as well as tinted, so it is never shown by colour alone. The links wrap; the block has no
  breakpoint and no direction selector. A page renders at most one and never adds a brand link, which the site
  header owns; a page with no access check of its own does not render it.
- Read back and confirm: [cottage-location-fields.tsx](../src/components/cottage-location-fields.tsx) is the
  pattern for a value the interface cannot show and a mistake in which is costly. The entry is read back in words
  in a `role="status"` element named by `aria-label`, with its numbers in `<bdi dir="ltr">`; a problem is a
  `.field-error` message there and `aria-invalid` on the fields; a correction is offered as an `ActionButton` and
  never applied unasked; and a native `required` checkbox, shown only for a valid reading and unticked by any
  edit, confirms it before the form submits.
- Optional Booking Period filters sit inside a `Disclosure`. Filter controls keep their existing `ActionButton`
  toggle pattern. Actual profile options use one native
  `fieldset`/`legend` per Service Day with `.booking-period-options` and regular `ActionButton` toggles;
  `aria-pressed` exposes the selection. Disable the fieldset and onward actions during URL navigation.
  Missing choices are corrected only through an explicit `ActionButton`; changed availability uses
  `ActionFeedback`. Results reuse `.result-shifts` inside named `.result-service-day` groups, with individual
  price and availability text. Times use `<bdi dir="ltr">` in every locale.
- Progress steps: `BookingRequestProgress` in
  [booking-request-progress.tsx](../src/components/booking-request-progress.tsx) renders an
  `ol.booking-request-progress` with `role="list"`, named by `aria-label`, with one `li` per step carrying
  `data-state` and `aria-current="step"` on the step in progress or needing action. The marker is decorative and
  `aria-hidden`; the state is always present as text, visually hidden with `.visually-hidden` for completed and
  not-started steps, so no state is conveyed by colour alone. The Customer Booking Request status page shows the
  steps, and a Customer's Confirmed Booking page shows them all completed inside `.booking-request-progress-card`
  above the Confirmed Booking details. States are derived by `customerBookingRequestProgress` and never stored.
- A new button, link-styled action, form field or submit feedback reuses these. A pattern they lack is added
  there, not built inside a feature component.

## Direction and language

- The locales are `ar`, `ckb` and `en`. The `[locale]` layout sets `dir` on `<html>` from `directionFor(locale)` in
  [routing.ts](../src/i18n/routing.ts).
- Layout uses logical properties only: `margin-inline`, `padding-inline`, `inset-inline`, `border-inline-start`,
  `start` and `end`. No physical left or right margin, padding, inset, border or text alignment is used today, and
  new work keeps it that way.
- A property with no logical form is mirrored with a direction selector. The one case today is the
  `background-position` of `.cottage-inventory-state select`, flipped under `[dir="rtl"]`.
- Direction- or language-specific adjustments use `[dir="rtl"]` or `html[lang="…"]` selectors in
  `src/app/globals.css`, as the `html[lang="ckb"]` profile and booking summary headings do.
- Fonts are self-hosted `@font-face` rules in [fonts.css](../src/app/fonts.css), imported by `globals.css`, not
  `next/font`. Changa is the display face; Karla then Almarai is the body stack.
  [fonts.test.ts](../src/app/fonts.test.ts) pins the faces, their files, subsets and weights.

## Accessibility conventions

- Hide text visually but keep it for assistive technology with `.visually-hidden`.
- Focus is a visible gold outline: `2px` with a `2px` offset on `.action`, `.action-link` and `.form-control`, and
  `3px` with a `3px` offset on any focused button, input, select, textarea or link.
- The `prefers-reduced-motion: reduce` rule turns off transitions and smooth scrolling.
- `.action`, `.action-link`, `.action-regular` and `.form-control` are at least `2.75rem` tall; only
  `.action-compact` (`2.25rem`) and the inline `.action-text` link are smaller.
- Status and errors are announced through `ActionFeedback`, which renders `role="status"` for success and
  `role="alert"` for errors.
- No new interaction ships without a visible focus state.

## Breakpoints

- A media query that tests width is `max-width` with one of the four values below. Custom properties cannot be
  used in media queries, so the values are literals, written in `rem` so a layout follows the reader's browser
  text size; the pixel figures are those at the browser default.

| Name | `max-width` | Pixels | At or below it |
|---|---|---|---|
| compact | `24rem` | 384 | a two-up grid of short values becomes one column |
| phone | `40rem` | 640 | the phone layout: fields, rows and headers stack, and buttons fill the width |
| tablet | `47.5rem` | 760 | a main column and its side column stack |
| wide | `53rem` | 848 | a form and its fixed side panel stack |

- New work reaches for `phone` first and adds no value. [globals.test.ts](../src/app/globals.test.ts) reads the
  `rem` values in this section, so a breakpoint is added or removed here in the same change as its media query.
- A query that tests no width, such as `prefers-reduced-motion`, is not a breakpoint, and neither is the `sizes`
  hint on an image, which describes the image's rendered width.

## Existing debt

These are known gaps, not standards to copy.

- #442: several near-identical colours are separate tokens, such as four error reds and several success greens;
  which of them are one role is not yet decided.
