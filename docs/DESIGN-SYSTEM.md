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
  shadow and stacking order, the component tokens named under Spacing and text size, the page width tokens named
  under Page template, and `color-scheme: light`. There is no Tailwind and no theme object.
- Interface colours, font families, spacing, text sizes, corner radii, state rings and stacking order come from
  these tokens through `var(--…)`. [globals.test.ts](../src/app/globals.test.ts) fails on a colour literal outside
  `:root`, on a custom property a stylesheet uses that `:root` does not declare, on a spacing or text size length
  that is neither a scale step nor listed under Tolerated literals, on a listed length that no stylesheet writes,
  on a `border-radius`, `box-shadow` or `z-index` value that is neither its token nor a tolerated literal, on text
  in `--muted`, `--ink-accent` or `--ink-on-dark-accent` below 4.5:1 on a listed surface, on `--gold` as a text
  colour, and on a width media query outside the list under Breakpoints.
- A colour or font a change needs that the block lacks is added to `:root` in the same change, named for its role
  (what it is for, not what it looks like). Two roles may share a value, each with its own token; one role never
  has two tokens.
- Colours that look alike are one token when they do one job and separate tokens when the jobs differ:
  - `--error` is the one error red: the border of an invalid field, mark or option, the bar beside a list of
    missing items, and the text of an error message. `--error-ring` is its translucent ring.
  - A status label takes a background and text pair chosen together. `--status-approved-bg` and
    `--status-approved-text` are the pair for a good outcome: an approved application and paid or eligible
    earnings. `--status-neutral-bg` is the background of a label that is neither good nor bad, and of the status
    badge and the status banner, which state a status in words and take no colour from it.
  - `--status-rejected-text` stays separate from `--error`, and `--success-text` from `--status-approved-text`: a
    label's text is chosen with its tint, and a message's text sits on whatever surface its form is on.
  - `--surface-policy` and `--surface-message-customer` stay separate: the policy box is chosen with
    `--accent-policy` and the Customer's message with `--surface-message-owner`, and neither is a status tint.
  - `--muted` is supporting text on a light surface: small print, labels and hints. `--ink-accent` is gold-coloured
    text on a light surface, the gold wash included, and `--ink-on-dark-accent` is the same text on the dark green
    surface. `--gold` is the brand gold for borders, focus outlines and decoration and is never a text colour.
    Normal-size text in these three text tokens reaches 4.5:1 on every surface it sits on, which
    [globals.test.ts](../src/app/globals.test.ts) checks against a list of surfaces, so new work that puts such
    text on another surface adds that surface to the test.
  - `--ink-on-dark` is the text colour on a dark surface, the green panels and buttons and the shaded hero
    photograph alike; the one exception is `--ink-on-green-bright`, the white label of the solid green buttons and
    links that the administrator review list, the publication review and the cottage profile editor style for
    themselves. `--ink-on-dark-soft` is the supporting paragraph there and `--ink-on-dark-muted` the small
    label.
  - `--line-panel` is the outline of a panel and of a message.
  - `--gold-tint` is the one gold wash, behind a label or a page corner; a notice sits on `--surface-notice`.
    `--green-tint` is the green wash behind content; `--action-pressed` stays separate because it is a state, the
    fill of a pressed toggle and of the current backoffice destination.
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
  New work reuses a size already in use. The one exception is a page's content width, which is a token named
  under Page template.
- A component token holds a length only when several declarations must share it. `--booking-progress-marker` is the
  size of the progress step marker, which the connector line is positioned from. `--booking-progress-inset` and
  `--booking-progress-row-gap` are names for `--space-2` and `--space-4`: the connector is positioned from the
  step's end padding and the gap between rows, so each is declared once. `--hero-headline-gap-rtl` is `0.5em`, so
  the gap under the Arabic-script hero headline follows the fluid headline size, which no step can do. New work
  adds no component token for a spacing or text size value.

## Radius, shadow and stacking order

- Corner radius has three sizes, written in `rem`. `--radius-control` is 8 pixels and rounds what a person
  operates: a button, a link styled as a button, a form field, a stepper, a disclosure toggle and a selectable
  option. `--radius-mark` is 4 pixels and rounds the checkbox mark, which is too small to carry 8 pixels without
  reading as a radio button. `--radius-card` is 10 pixels and rounds every other surface: a card, panel, notice,
  tile, image frame, menu and list row.
- A selectable option in a group, whether a toggle button (`.action-toggle`) or a bordered option label
  (`.amenity-options label`), is a control and takes `--radius-control`. The pill is the shape of a status label
  and of a site header item, never of a selectable option.
- A pill is `999px`, a circle is `50%` and a square corner is `0`. They are shapes, not sizes, so they are
  literals. The radio button mark is a circle.
- There is no elevation shadow. A surface is set apart by its background and its `1px` `--line` border;
  `text-shadow` and `drop-shadow()` are not used.
- `box-shadow` draws state rings only, each with no offset and no blur: `--shadow-focus` around a focused form
  field, checkbox or radio button mark, or disclosure toggle, `--shadow-invalid` around an invalid field, mark or
  option, and `--shadow-pressed` inside a pressed toggle. A ring adds to the focus outline described under
  Accessibility conventions and never replaces it.
- Every `z-index` is one of four layers, lowest first: `--layer-raised` for content above a backdrop in its own
  block, as the hero copy is above its shade; `--layer-overlap` for a block that overlaps the one before it, as
  the search card overlaps the hero; `--layer-header` for the site header; and `--layer-menu` for a menu that
  opens over everything else.
- New work uses these tokens. A fourth radius, an elevation shadow or a fifth layer is decided in this document
  before a stylesheet writes it.

## Tolerated literals

A stylesheet may write these as literals:

- `0`, `auto`, `none` and `inherit`, hairline `1px` borders, `50%` and `999px` for circles and pills.
- Percentages and `fr` or flex sizing in layout, and the sizing lengths described under Spacing and text size.
- `currentColor` and `transparent`.
- Border and outline widths and offsets, and lengths inside `background`, `transform`, `backdrop-filter` and
  text-decoration properties. New work reuses a value already in use.
- Unitless `line-height` ratios and `letter-spacing` in `em`.
- The two page width tokens, `--page-width` and `--page-width-record`, which hold the sizing lengths named under
  Page template.
- The two component tokens that hold a length, `--hero-headline-gap-rtl` and `--booking-progress-marker`.
- The home page hero composition, whose three lengths lie beyond the largest step. The search card overlaps the
  photograph, and the copy clears the fixed header above it and the card below:
  - `.retreat-copy { padding-block: 11rem 8.5rem }`
  - `.retreat-copy { padding-block-end: 7.5rem }`
  - `.retreat-search { margin-block-start: -4rem }`
- Six display heading size declarations larger than the largest step. Each stays until its screen is moved onto the
  page template, when a page title takes the style under Page template and its entry is removed here; a heading
  that is not a page title, as the home page hero headline and section headings are, keeps its entry until a rule
  in this document replaces it:
  - `.retreat-copy h1 { font-size: clamp(2.5rem, 6vw, 4.4rem) }`
  - `.retreat-copy h1 { font-size: clamp(2.25rem, 12vw, 3.3rem) }`
  - `.results-intro h1 { font-size: clamp(2.6rem, 6vw, 4.5rem) }`
  - `.profile-heading h1 { font-size: clamp(2.5rem, 6vw, 4rem) }`
  - `.access-required-card h1 { font-size: clamp(2.2rem, 6vw, 3.5rem) }`
  - `.trusted-copy h2 { font-size: clamp(2rem, 4vw, 3rem) }`

The last three bullets are the complete list of spacing and text size exceptions.
[globals.test.ts](../src/app/globals.test.ts) reads the backticked rule entries and token names in this section, and
tolerates an entry's declaration only on the rule the entry names, so an entry is removed here when its declaration
leaves that rule. New work uses a step and adds no entry.

Anything else is a token.

## Page template

- A page on the template puts `page` on its `<main>`, beside the class that gives the page its background and
  height (`results-page` on every page moved so far). The column is centred, leaves a `2.25rem` gutter (18 pixels on
  each side, the site header's) and starts `--space-6` (32 pixels) below the site header. It is the same at every
  width and in both directions, with no breakpoint and no direction selector.
- A page has one of two content widths. `--page-width` is 1120 pixels and is the default. `--page-width-record`
  is 760 pixels, chosen by adding `page-record`, for a record page: one that shows a single record, such as a
  Booking Request status or a receipt, or a single-column list of a person's own records, such as My bookings or
  the Messages inbox. A third width is decided in this document before a stylesheet writes it.
- A block directly inside the column fills it: inside the column no block adds a gutter or a narrower width of
  its own.
- The page title is the page's `h1` with `page-title`: `--display` at weight 700 in `--green`, at `--font-size-6`
  (34 pixels) and at `--font-size-5` (26 pixels) at the `phone` breakpoint. Its line height is `1.2`, and `1.4` in
  Sorani, whose letters carry marks above and below the line. It has no margin of its own; the block it sits in
  sets the space around it. It starts at the same inline edge as the content it titles, and a long title wraps
  onto further lines and is never clipped or shortened.
- A page may put one small label above its title. It is the results page's label (`.results-intro p`):
  `--font-size-1`, bold, in `--ink-accent`, with the title `--space-1` below it. No page on the template has one yet;
  the first that does moves that rule's declarations to a shared `page-label` class, so there is one label style.
- A page that is not on the template keeps its own width and heading rules until its screen is moved onto it.

## Component patterns

- [interaction-controls.tsx](../src/components/interaction-controls.tsx) holds the shared controls:
  - `ActionButton`: a primary, secondary or toggle button (`.action`, `.action-primary`, `.action-secondary`,
    `.action-toggle`, sized by `.action-compact` or `.action-regular` and `.action-content` or `.action-full`). A pending button sets
    `aria-busy` and is disabled. A toggle at rest looks like a secondary button, a pressed one carries the
    `--shadow-pressed` ring, and a disabled one has a dashed border.
  - `ActionLink`: a link styled as a primary, secondary or text action (`.action-link`, `.action-text`).
  - `FormControl`: an input, select or textarea with `.form-control`, which shows `aria-invalid` as an error
    border.
  - `FormControl` with `type="date"` is the date field. It keeps the platform's date picker; the date text and the
    calendar glyph the browser draws inside the field are not restyled.
  - `ChoiceControl`: a native checkbox or radio button inside its label (`.choice-control`). The label is the
    touch target. The mark has the form field's fill and focus treatment and a full-strength `--green` border,
    because the field's `--line` hairline is too faint to show a mark this small. No state is shown by colour
    alone: a checked checkbox is filled and carries a drawn tick, a checked radio button carries a drawn dot, a
    disabled mark has a dashed border, and `aria-invalid` thickens the border as well as colouring it, beside a
    `.field-error` message.
  - `OptionGroup`: a native `fieldset` and `legend` around a set of choices (`.option-group`), one per line
    (`.option-group-stack`) or wrapping along a row (`.option-group-wrap`). An option is a row of mark and text.
  - `Disclosure`: native `details` and `summary` (`.disclosure`). The summary is a bordered control with the form
    field's border, corner, fill and focus treatment, and a drawn chevron that points down when closed and up when
    open.
  - `ActionFeedback`: the success or error message after an action (`.action-feedback`).
- `.field-error` in `src/app/globals.css` styles the message beside an invalid field.
- [use-exclusive-action.ts](../src/components/use-exclusive-action.ts) blocks a second submit while one is in
  flight and supplies the `pending` state the buttons show.
- Site chrome is `site-header.tsx`, `site-footer.tsx` and `marketplace-shell.tsx` in `src/components/`; the
  language selector is `locale-links.tsx`.
- Site header: `header.site-header` holds the brand link, the language selector and the account navigation
  (`nav.account-navigation`). Its items are the header's own pattern, pills that do not use `ActionButton`,
  `ActionLink` or `Disclosure`. Above the `phone` breakpoint the language selector and the account links sit in
  the row, and a signed-in person's own links open from the Account button (`.account-menu-toggle`) as a menu
  (`.account-menu-panel`) under that button, aligned to its end edge. At the `phone` breakpoint the row holds
  only the brand and two icon buttons (`.site-header-toggle`), each a pill `2.75rem` wide and tall: the globe
  opens the language selector and the three bars open the account navigation. An open panel
  (`.site-header-panel`) spans the screen directly under the header on `--surface-raised` at `--layer-menu`, one
  destination per row, each row at least `2.75rem` tall; it lies over the page and moves nothing. Each of these
  buttons, the Account button included, reports `aria-expanded` and names its panel with `aria-controls`; an icon
  button is named by `aria-label` and the Account button by its visible text; at the `phone` breakpoint the
  stylesheet shows and hides a panel from its button's `aria-expanded`, so the two cannot disagree, and above it
  the Account menu carries the `hidden` attribute, set from the same state as its button's `aria-expanded`. One
  panel is open at a time.
  It closes when a destination or Sign out is chosen, on Escape, which returns focus to the button that opened
  it, on a press outside the header and when focus leaves the header. It is a disclosure, not a dialog: focus is
  not trapped and no `menu` role is used.
- Icons: an icon is an inline `svg` in the component that uses it, with `aria-hidden="true"`, a 24-unit
  `viewBox`, no fill and a 2-unit `currentColor` stroke with round ends, so it takes its control's text colour.
  The control's rule sets its size and the control's `aria-label` names the control; an icon never carries the
  name. The site header's globe and three bars are the only two. There is no icon library and no icon font.
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
- A new button, link-styled action, form field, checkbox, radio button, option group, disclosure or submit
  feedback reuses these. A pattern they lack is added there, not built inside a feature component.

## Content patterns

Six global classes in `src/app/globals.css` present facts, lists of records, statuses, section titles and empty
lists. Each sits on a semantic element and uses tokens only. Apart from the section heading none has a margin of
its own; the block it sits in sets the space around it.

- Fact list: `dl.fact-list`, with one `div` per fact holding a `dt` and its `dd`, shows the labelled details of one
  record. The label is in `--muted` and sits in a column beside its value, with `--space-3` between them and
  `--space-4` between facts; at the `phone` breakpoint the label stacks above its value. A value with several
  lines puts each in a `span`. A fact list never carries the record's status.
- List row: `ul.list-rows` shows a list of a person's records, one `li` per record. Each is a bordered row, with a
  `1px` `--line` border, `--radius-card` corners and `--space-3` between rows. A row has exactly one link,
  `a.list-row-title`, which holds only the record's name in bold, spans the row's width and is at least `2.75rem`
  tall. Everything else is plain supporting text outside the link: `p.list-row-meta`, in `--muted` at
  `--font-size-2`, holds plain text, a reference in `bdi`, a status badge and a date in `time`, and wraps. Further blocks of the
  same record follow inside the `li`.
- Status badge: `span.status-badge` is the compact status of one item in a list row or card. Its text is the
  translated status label, so the status never depends on colour. It is a pill on `--status-neutral-bg` with bold
  `--ink` text at `--font-size-1`. It is never the page-level status.
- Status banner: `p.status-banner` is the page-level status of a record page. It sits directly under the page
  title, at most one per page, and keeps `role="status"` and `aria-live="polite"`. It is a block on
  `--status-neutral-bg` with `--radius-card` corners, holding the status label in bold `--green`, followed by one
  plain-language sentence in `--ink`, in a `span`, where the status has one.
- Section heading: `h2.section-title` titles a section below the page title; the `h1` takes `page-title`. It is
  `--display` in `--green` at `--font-size-4` with line height `1.25`, and has `--space-4` below it.
- Empty state: `div.empty-state` fills a list or record area that has nothing to show. It is a `--card` block with
  a `1px` `--line` border, `--radius-card` corners and `--space-5` padding, holding one `p` with a single sentence
  saying what is absent and, `--space-3` below it, one next action as a secondary content-width `ActionLink`. It
  is not an error; a failure uses `role="alert"`.
- New work that shows facts, a list of records, a status, a section title or an empty list reuses these. A screen
  with its own rules for one of them keeps those rules until it is moved onto the pattern.

## Direction and language

- The locales are `ar`, `ckb` and `en`. The `[locale]` layout sets `dir` on `<html>` from `directionFor(locale)` in
  [routing.ts](../src/i18n/routing.ts).
- Layout uses logical properties only: `margin-inline`, `padding-inline`, `inset-inline`, `border-inline-start`,
  `start` and `end`. No physical left or right margin, padding, inset, border or text alignment is used for layout,
  and new work keeps it that way. The two drawn glyphs are the one exception: the tick on a checked checkbox and
  the chevron on a disclosure are each two physical borders of a rotated box, so they are drawn the same way in
  every direction.
- A property with no logical form is mirrored with a direction selector. The one case today is the
  `background-position` of `.cottage-inventory-state select`, flipped under `[dir="rtl"]`.
- Direction- or language-specific adjustments use `[dir="rtl"]` or `html[lang="…"]` selectors in
  `src/app/globals.css`, as the `html[lang="ckb"]` profile and booking summary headings do.
- Fonts are self-hosted `@font-face` rules in [fonts.css](../src/app/fonts.css), imported by `globals.css`, not
  `next/font`. Changa is the display face; Karla then Almarai is the body stack.
  [fonts.test.ts](../src/app/fonts.test.ts) pins the faces, their files, subsets and weights.

## Accessibility conventions

- Hide text visually but keep it for assistive technology with `.visually-hidden`.
- Focus is a visible gold outline: `2px` with a `2px` offset on `.action`, `.action-link`, `.form-control`, the
  `.choice-control` mark and the `.disclosure` summary, and `3px` with a `3px` offset on any other focused button,
  input, select, textarea or link.
- The `prefers-reduced-motion: reduce` rule turns off transitions and smooth scrolling.
- `.action`, `.action-link`, `.action-regular`, `.form-control`, `.choice-control` and the `.disclosure` summary
  are at least `2.75rem` tall; of the shared controls only `.action-compact` (`2.25rem`) and the inline
  `.action-text` link are smaller. Outside those classes, the site header's account and support pills, its language
  links and the choose-file button inside a file field are at least `2.75rem` tall as well. The search form's
  Booking Period filters are `.action-compact` toggles, which `.booking-period-filter .action-toggle` raises to
  `2.75rem`.
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
| phone | `40rem` | 640 | the phone layout: fields, rows and headers stack, and a form may set its buttons to fill the width; the site header keeps one row and opens its links as panels |
| tablet | `47.5rem` | 760 | a main column and its side column stack |
| wide | `53rem` | 848 | a form and its fixed side panel stack |

- New work reaches for `phone` first and adds no value. [globals.test.ts](../src/app/globals.test.ts) reads the
  `rem` values in this section, so a breakpoint is added or removed here in the same change as its media query.
- A query that tests no width, such as `prefers-reduced-motion`, is not a breakpoint, and neither is the `sizes`
  hint on an image, which describes the image's rendered width.
