# RentCottage design system

This document owns how RentCottage's interface is built: which values are tokens and where they live, the literals
a stylesheet may still write, and the component patterns new work reuses. The Arabic, Sorani and English
presentation rules in the Hard constraints of [AGENTS.md](../AGENTS.md) are contracts, and the rules below are how
the code keeps them.

## Values live in the token block

- The only token block is `:root` in [globals.css](../src/app/globals.css). It holds every interface colour: the
  base palette `--background`, `--card`, `--ink`, `--muted`, `--green`, `--gold` and `--line`, then the groups
  Surfaces, Ink, Lines and accents, Brand tints, Shade over hero imagery, Status and Elevation. It also holds
  the font families `--display` and `--body`, the spacing scale `--space-1` to `--space-7`, the text size scale
  `--font-size-1` to `--font-size-6`, the corner radius, state ring, card shadow and stacking order tokens named
  under Radius, shadow and stacking order, the component tokens named under Spacing and text size, the page width tokens named
  under Page template, and `color-scheme: light`. There is no Tailwind and no theme object.
- Interface colours, font families, spacing, text sizes, corner radii, state rings, the card shadow and stacking
  order come from these tokens through `var(--…)`. [globals.test.ts](../src/app/globals.test.ts) fails on a colour literal outside
  `:root`, on a custom property a stylesheet uses that `:root` does not declare, on a spacing or text size length
  that is neither a scale step nor listed under Tolerated literals, on a listed length that no stylesheet writes,
  on a `border-radius`, `box-shadow` or `z-index` value that is neither its token nor a tolerated literal, on text
  in `--muted`, `--ink-accent` or `--ink-on-dark-accent` below 4.5:1 on a listed surface, on a status dot colour
  below 3:1 on `--status-neutral-bg`, on `--gold` as a
  text colour, and on a width media query outside the list under Breakpoints.
- A colour or font a change needs that the block lacks is added to `:root` in the same change, named for its role
  (what it is for, not what it looks like). Two roles may share a value, each with its own token; one role never
  has two tokens.
- Colours that look alike are one token when they do one job and separate tokens when the jobs differ:
  - `--error` is the one error red: the border of an invalid field, mark or option, the bar beside a list of
    missing items, and the text of an error message. `--error-ring` is its translucent ring.
  - A status label takes a background and text pair chosen together. `--status-approved-bg` and
    `--status-approved-text` are the pair for a good outcome: an approved application and paid or eligible
    earnings. `--status-attention-bg` and `--status-attention-text` are the pair for a label that asks for the
    reader's action; the time-left badge under Status badge takes it. `--status-neutral-bg` is the background of a
    label that is neither good nor bad, and of the status badge and the status banner, which state a status in
    words. `--status-published-dot`, `--status-draft-dot` and `--status-review-dot` are the dot colours of the
    status badge's three tones; each reaches 3:1 on `--status-neutral-bg`, which globals.test.ts checks, and
    `--status-draft-dot` is a darker gold than `--gold` for that reason.
  - `--status-rejected-text` stays separate from `--error`, and `--success-text` from `--status-approved-text`: a
    label's text is chosen with its tint, and a message's text sits on whatever surface its form is on.
  - `--surface-policy` and `--surface-message-customer` stay separate: the policy box is chosen with
    `--accent-policy` and the Customer's message with `--surface-message-owner`, and neither is a status tint.
  - `--muted` is supporting text on a light surface: small print, labels and hints. `--ink-accent` is gold-coloured
    text on a light surface, the gold wash included, and `--ink-on-dark-accent` is the same text on the dark green
    surface. `--gold` is the brand gold for borders and decoration and is never a text colour.
    Normal-size text in these three text tokens reaches 4.5:1 on every surface it sits on, which
    [globals.test.ts](../src/app/globals.test.ts) checks against a list of surfaces, so new work that puts such
    text on another surface adds that surface to the test.
  - `--surface-no-photo` and `--surface-no-photo-band` are the two bands of the cottage card's 'No photos yet'
    panel. `--ink-accent` text sits on them and reaches 4.5:1 on both, which globals.test.ts checks.
  - `--ink-on-dark` is the text colour on a dark surface, the green panels and buttons and the shaded hero
    photograph alike; the one exception is `--ink-on-green-bright`, the white label of the solid green buttons and
    links that the administrator review list, the publication review and the cottage profile editor style for
    themselves. `--ink-on-dark-soft` is the supporting paragraph there.
  - `--line-panel` is the outline of a panel and of a message.
  - `--line-action` is the outline of a secondary button and of a toggle at rest.
  - `--elevation-contact` and `--elevation-cast` are the two layers of the card shadow, tinted with the `--ink`
    colour so the shadow stays warm on the cream surfaces; only `--shadow-card` uses them.
  - `--gold-tint` is the one gold wash, behind a label or a page corner; a notice sits on `--surface-notice`.
    `--green-tint` is the green wash behind content; `--action-pressed` stays separate because it is a state, the
    fill of a pressed toggle.
  - `--tab-indicator` is the line under the current Backoffice tab. It is a darker gold than `--gold` so it reaches
    3:1 on `--card`, and it stays separate from `--status-draft-dot` because the role differs.
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
  reading as a radio button. `--radius-card` is 14 pixels and rounds every other surface: a card, panel, notice,
  tile, image frame, menu and list row.
- A selectable option in a group is either a toggle button (`.action-toggle`), which is a control and takes
  `--radius-control`, or a `ChoiceControl` row of mark and text inside an `OptionGroup`, which has no border or
  fill of its own. The pill is the shape of a status label and of a site header item, never of a selectable
  option.
- A pill is `999px`, a circle is `50%` and a square corner is `0`. They are shapes, not sizes, so they are
  literals. The radio button mark is a circle.
- There is one elevation shadow, `--shadow-card`, and only the card pattern under Content patterns takes it. It has
  two layers: a `1px` contact layer in `--elevation-contact` and a soft layer in `--elevation-cast` offset `8px`
  below the card. Every other surface is set apart by its background and its `1px` `--line` border. A control never
  takes the shadow, because a control's `box-shadow` draws its state rings, and the shadow has no hover or pressed
  variant. `text-shadow` and `drop-shadow()` are not used.
- Every other `box-shadow` is a state ring, each with no offset and no blur: `--shadow-focus` composes a 2px opaque
  cream separator and a 4px opaque green shadow around a keyboard-focused control or ordinary handoff target.
  The first shadow paints above the second, leaving 2px of green beyond the separator. `--shadow-invalid`
  surrounds an invalid field or mark; and `--shadow-pressed` sits inside a pressed toggle. A ring adds to the focus outline described under Accessibility conventions and never replaces it.
  A focused pressed toggle composes `var(--shadow-focus), var(--shadow-pressed)` to retain its inset edge.
- Every `z-index` is one of four layers, lowest first: `--layer-raised` for content above a backdrop in its own
  block, as the hero copy is above its shade; `--layer-overlap` for a block that overlaps the one before it, as
  the search card overlaps the hero; `--layer-header` for the site header; and `--layer-menu` for a menu that
  opens over everything else.
- New work uses these tokens. A fourth radius, a second elevation shadow or a fifth layer is decided in this document
  before a stylesheet writes it.

## Tolerated literals

A stylesheet may write these as literals:

- `0`, `auto`, `none` and `inherit`, hairline `1px` borders, `50%` and `999px` for circles and pills.
- Percentages and `fr` or flex sizing in layout, and the sizing lengths described under Spacing and text size.
- `currentColor` and `transparent`.
- Border and outline widths and offsets, and lengths inside `background`, `transform`, `backdrop-filter` and
  text-decoration properties. New work reuses a value already in use.
- Unitless `line-height` ratios and `letter-spacing` in `em`.
- The cottage card cover's `16 / 10` aspect ratio and the `135deg` angle of its 'No photos yet' bands.
- The two page width tokens, `--page-width` and `--page-width-record`, which hold the sizing lengths named under
  Page template.
- The two component tokens that hold a length, `--hero-headline-gap-rtl` and `--booking-progress-marker`.
- The home page hero composition, whose three lengths lie beyond the largest step. The search card overlaps the
  photograph, and the copy clears the fixed header above it and the card below:
  - `.retreat-copy { padding-block: 11rem 8.5rem }`
  - `.retreat-copy { padding-block-end: 7.5rem }`
  - `.retreat-search { margin-block-start: -4rem }`
- Five display heading size declarations larger than the largest step. Each stays until its screen is moved onto the
  page template, when a page title takes the style under Page template and its entry is removed here; a heading
  that is not a page title, as the home page hero headline and section headings are, keeps its entry until a rule
  in this document replaces it:
  - `.retreat-copy h1 { font-size: clamp(2.5rem, 6vw, 4.4rem) }`
  - `.retreat-copy h1 { font-size: clamp(2.25rem, 12vw, 3.3rem) }`
  - `.results-intro h1 { font-size: clamp(2.6rem, 6vw, 4.5rem) }`
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
- Page heading: `header.page-heading` opens a page on the template. It holds, top to bottom, a back link as
  `ActionLink kind="text"`, the page title, and an optional plain `p` in `--muted` with no margin. Its items start
  at the same inline edge, `--space-2` apart, and the block has `--space-5` below it.
  A page that opens with the Backoffice navigation has no back link; its heading starts at the page title.
- A page may put one small label above its title. Its style is the `.results-intro p` rule, which only the
  not-found screen still uses as a label: `--font-size-1`, bold, in `--ink-accent`, with the title `--space-1`
  below it. No page on the template carries a label; the first that does moves that rule's declarations to a
  shared `page-label` class, so there is one label style.
- Personal information (`/account`) is a record page: `page page-record` with a page heading whose back link goes
  home, the page title and a plain `p`, then the first-name form (`AccountNameForm`, in its details mode).
- A page that is not on the template keeps its own width and heading rules until its screen is moved onto it.

## Component patterns

- [interaction-controls.tsx](../src/components/interaction-controls.tsx) holds the shared controls:
  - `ActionButton`: a primary, secondary or toggle button (`.action`, `.action-primary`, `.action-secondary`,
    `.action-toggle`, sized by `.action-compact` or `.action-regular`). A pending button sets
    `aria-busy` and is disabled. A secondary button has a `--line-action` outline on a `--card` fill with a
    `--green` label. A toggle at rest looks like a secondary button, a pressed one carries the
    `--shadow-pressed` ring, and a disabled one has a dashed border.
  - `ActionLink`: a link styled as a primary, secondary or text action (`.action-link`, `.action-text`).
  - A primary or secondary `ActionButton` or `ActionLink` is as wide as its label (`.action-content`).
    `width="full"` (`.action-full`) is the one exception, the form-column action: a button that submits a form or
    closes a panel fills the column or grid track its fields or facts sit in. An action inside a card in a list or
    grid stays content-width except for View cottage in a Search result footer at the `phone` breakpoint.
    Customer status Withdraw and the separate Messages action also fill their footers at `phone`; Withdraw is
    content-width at the desktop inline end, while recovery keeps its full-width treatment.
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
- Site header: `header.site-header` holds the brand link and the controls (`.site-header-controls`): the language
  button, a rule and the account navigation (`nav.account-navigation`). Its items are the header's own pattern,
  pills and circles that do not use `ActionButton`, `ActionLink` or `Disclosure`. The brand link
  (`.site-brand`) is at least `2.75rem` tall at every width.
  - Language button: `.site-header-language-toggle` is a pill at least `2.75rem` tall, showing the globe icon and
    the current language's own name. It shows at every width and opens the language selector
    (`nav.language-links`), a card of one row per language, each at least `2.75rem` tall, with the current
    language filled. Its name is a visually hidden label followed by the visible language name.
  - Row per state, above the `header` breakpoint: signed out, the language button, the rule, then Sign in, List a
    cottage and Support as pills. When the session cannot be read, the sign-in and list links give way to a
    `role="status"` message and Support stays. Signed in, the language button, the rule and the avatar button, with
    Support and Sign out inside the avatar menu. At or below the `header` breakpoint a signed-out visitor's account
    links sit behind one icon button (`.site-header-toggle`) of three bars, a pill `2.75rem` wide and tall; a
    signed-in person's row is unchanged.
  - Avatar: the button (`.account-menu-toggle`) is a transparent `2.75rem` square with a circular focus shape,
    holding a `2.25rem` circle (`.account-avatar`). The circle shows the first letter of the person's own first
    name, uppercased, as bold `--font-size-3` text: the first letter grapheme of the name, computed on the server
    so that only the letter reaches the header. When there is no letter, whether the person has not given a first
    name yet or the name could not be read, the circle holds a `1.25rem` person icon, which claims nothing about
    the name. On the transparent landing header the circle is `--ink-on-dark` with `--ink` text or icon; on the
    solid header it is `--green` with `--ink-on-dark` text or icon. The button is named by a visually hidden
    "Account" label, never by the letter or the icon.
  - Header band: while the landing header is transparent, a `--shade-mid` band lies behind it, solid for its top
    55% and fading to nothing at its bottom edge. The language button, the account links and the three-bars button
    are filled with `--shade-menu`, which keeps their text and the brand's tagline at AA contrast over any part of
    the photograph. The brand's tagline is `--ink-on-dark` there, not a muted shade. The solid header has neither
    the band nor the fill.
  - Panels: an open panel is a card on `--surface-raised` at `--layer-menu` with the card radius, at least
    `14.5rem` wide, opening under its own button and aligned to that button's end edge, lying over the page and
    moving nothing. At the `phone` breakpoint every panel instead spans the screen directly under the header, with
    no side border or radius.
  - Breakpoint changes: at the `header` breakpoint the row stops wrapping, the rule is hidden and a signed-out
    visitor's account links move into the three-bars panel; at the `phone` breakpoint the panels span the screen, the
    brand's tagline is hidden and its name is smaller; at the `compact` breakpoint the language button drops its
    globe.
  - Disclosures: the language button and the three-bars button are disclosures. Each reports `aria-expanded` and
    names its panel with `aria-controls`, and no `menu` role is used for either; an icon button is named by
    `aria-label`. At the `header` breakpoint the stylesheet shows and hides the three-bars panel from its
    button's `aria-expanded`, so the two cannot disagree; the language selector is hidden the same way at every
    width.
  - Avatar menu: the avatar button is a menu button. It carries `aria-haspopup="menu"`, `aria-expanded` and
    `aria-controls`, and opens `.account-menu-panel`, a `role="menu"` named by the button through
    `aria-labelledby`; the panel carries the `hidden` attribute, set from the same state as the button's
    `aria-expanded`. Every destination is a `role="menuitem"` with `tabindex="-1"`, each row at least `2.75rem`
    tall: the person's own destinations in a `role="group"` named "Account", whose first item is Personal
    information for every role, a rule, Support, then Sign out as a button inside a `role="none"` form. Focus moves to the first item when the menu opens, or to the last when it
    opens by ArrowUp.

    | Key | In the menu button | In the open menu |
    |---|---|---|
    | Enter, Space, click | Opens the menu or closes it | Activates the item |
    | ArrowDown | Opens the menu on its first item | Next item, from the last to the first |
    | ArrowUp | Opens the menu on its last item | Previous item, from the first to the last |
    | Home, End | None | First item, last item |
    | Tab | Moves on | Closes the menu and moves on |
    | Escape | Closes the menu | Closes the menu and returns focus to the button |

  - Closing: one panel is open at a time. A panel closes when a destination or Sign out is chosen, on Escape, which
    returns focus to the visible button that is expanded, on a press outside the header and when focus leaves the
    header. Focus is not trapped and no panel is a dialog.
  - Required first-name step: while a signed-in person has not given a first name, the header is solid and in
    flow on every route, the landing page included, and the step replaces the page under it (see Accessibility
    conventions).
- Icons: an icon is an inline `svg` in the component that uses it, with `aria-hidden="true"`, a 24-unit
  `viewBox`, no fill and a 2-unit `currentColor` stroke with round ends, so it takes its control's text colour.
  The control's rule sets its size and the control's `aria-label` names the control; an icon never carries the
  name. The site header's globe, three bars and person are the only three. There is no icon library and no icon font.
- Backoffice navigation: `BackofficeNavigation` in
  [backoffice-navigation.tsx](../src/components/backoffice-navigation.tsx) is the one navigation of the Owner
  Backoffice and the Platform Administrator pages, and owns each area's list of destinations. It is a server
  component whose row of tabs is the client component `BackofficeNavigationLinks` in
  [backoffice-navigation-links.tsx](../src/components/backoffice-navigation-links.tsx), which brings the focused
  tab, and on first render the current tab, wholly into view inside the row with room for its focus ring, without
  moving the page. A page renders it as the first child of `<main>`, only in a branch that has passed that page's own
  access check, names its destination with `current`, and adds `nested` on a page beneath that destination. It
  renders `nav.backoffice-navigation` as a tab bar, named through `aria-labelledby` by its area label, which is
  visually hidden. Each destination is a tab, `a.backoffice-navigation-tab`, the bar's own pattern and not an
  `ActionLink`, and is `position: relative` so its visually hidden count label stays inside the scrolling row. The
  current tab carries `aria-current="page"`, or `aria-current="true"` on a nested page, and shows
  it with a `--tab-indicator` line under it and `--green` text, so it is never shown by colour alone. The bar is a
  cream band that reaches both screen edges, with its tabs on one line that scrolls sideways inside the bar with a
  hidden scrollbar and never scrolls the page. The bar is `display: flow-root` so the row's negative margins stay
  inside it and the current tab's indicator meets the band's hairline, and `min-inline-size: 0` so it shrinks inside a
  grid or flex parent. The owner's Bookings tab may carry `span.backoffice-navigation-count`,
  a `--gold` pill with the number in `--ink` at `--font-size-1`, shown only when at least one Booking Request is
  waiting. The number is preceded by visually hidden text, so the tab is announced with its name and the count. A
  page passes the count through `waitingBookingRequests` and the navigation loads nothing itself. An unavailable
  count is shown as no pill only where the page lists no requests either, never in place of a failed load. The
  block has no direction selector. A page renders at most one and
  never adds a brand link, which the site header owns; a page with no access check of its own does not render it.
- Read back and confirm: [cottage-location-fields.tsx](../src/components/cottage-location-fields.tsx) is the
  pattern for a value the interface cannot show and a mistake in which is costly. The entry is read back in words
  in a `role="status"` element named by `aria-label`, with its numbers in `<bdi dir="ltr">`; a problem is a
  `.field-error` message there and `aria-invalid` on the fields; a correction is offered as an `ActionButton` and
  never applied unasked; and a native `required` checkbox, shown only for a valid reading and unticked by any
  edit, confirms it before the form submits.
- Optional Booking Period filters sit inside a `Disclosure`. Filter controls keep their existing `ActionButton`
  toggle pattern. Actual profile options use one native
  `fieldset`/`legend` per Service Day with `.booking-period-options` and regular `ActionButton` toggles;
  `aria-pressed` exposes the selection. The profile's `.booking-period-list` holds full-width outlined toggle
  rows: name over time at the inline start, price at the inline end, with the name, time and price inside the
  same control. `aria-labelledby` retains the existing name-only accessible name; `aria-describedby` associates
  time, price and explicit unavailability text. Unavailability remains in the same list item, shown only for an
  option that cannot be chosen. Pressed rows retain the shared tint, inset edge and focused pressed rings.
  Disable the fieldset and onward actions during URL navigation. Missing choices are corrected only through an
  explicit `ActionButton`; changed availability uses `ActionFeedback`. Results reuse `.result-shifts` inside
  named `.result-service-day` groups. Each option there is a row of two aligned lines: its name over its time at
  the start edge, and its price over its availability text at the end edge, with a selected filter's
  `span.status-badge` on its own line under the row. Results show a decorative availability dot beside the
  explicit word, in `--success-text` when available and `--muted` otherwise; it never carries the state alone.
  Times use `<bdi dir="ltr">` in every locale. Loading, stale selection, missing periods, disabled actions,
  cross-midnight times and unavailable prices retain their existing meanings.
- Progress steps: `BookingRequestProgress` in
  [booking-request-progress.tsx](../src/components/booking-request-progress.tsx) renders an
  `ol.booking-request-progress` with `role="list"`, named by `aria-label`, with one `li` per step carrying
  `data-state` and `aria-current="step"` on the step in progress or needing action. The marker is decorative and
  `aria-hidden`; the state is always present as text, visually hidden with `.visually-hidden` for completed and
  not-started steps, so no state is conveyed by colour alone. The Customer Booking Request status page shows the
  steps, and a Customer's Confirmed Booking page shows them all completed inside `.booking-request-progress-card`
  above the Confirmed Booking details. States are derived by `customerBookingRequestProgress` and never stored.
  Inside Customer status `.customer-booking-request-progress`, the status sentence and progress share one lifted
  card. Its four columns remain horizontal at `phone`, with wrapping names at `--font-size-2` and state text at
  `--font-size-1`. The neutral connector track is 6px thick and turns `--gold` only after a completed step;
  markers and state text remain authoritative for current, upcoming, stopped and action-required states.
  The track is centred on the marker using `--booking-progress-marker`; owner and Confirmed Booking progress
  retain their own layouts.
- Results paging: `nav.results-paging`, named by `aria-label`, follows a paged list of results and holds only
  secondary content-width `ActionLink`s at the inline end: one back to the first results on a continued page, then
  one to the next results when more exist. Paging continues from the last result shown, so it has no page numbers
  and no total, and the `nav` is omitted when neither link applies.
- Automatic translation: generated text sits under `p.translation-label`, which names it in `--ink-translation`, in
  one paragraph that carries the reader's `lang` and the `dir` from `directionFor(locale)` while it shows the
  translation and the original's own `lang` and direction while it shows the original. One compact secondary
  `ActionButton` switches between the two and keeps its place, so focus stays on it, and once Translate or Report
  settles owned focus returns to it when the pending or removed button dropped it; a second reports the translation on
  screen and `ActionFeedback` answers it. When no translation can be produced the original stays and
  `ActionFeedback` says so. [customer-review-translation.tsx](../src/components/customer-review-translation.tsx) is
  the pattern; the conversation in `messaging-conversation.tsx` keeps its own rules until it is moved onto it.
- An `ActionButton` may open a block that belongs to it by carrying `aria-expanded`, and `aria-controls` while the
  block is open, as the request row's Decline does. Focus stays on the button, pressing it again closes the block,
  and the block is not a dialog. `Disclosure` remains the pattern where the summary and its content share one
  column.
- A new button, link-styled action, form field, checkbox, radio button, option group, disclosure or submit
  feedback reuses these. A pattern they lack is added there, not built inside a feature component.

## Content patterns

Global classes in `src/app/globals.css` present facts, lists of records, cards, statuses, section titles and empty
lists. Each sits on a semantic element and uses tokens only. Apart from the section heading none has a margin of
its own; the block it sits in sets the space around it.

- Fact list: `dl.fact-list`, with one `div` per fact holding a `dt` and its `dd`, shows the labelled details of one
  record. The label is in `--muted` and sits in a column beside its value, with `--space-3` between them and
  `--space-4` between facts; at the `phone` breakpoint the label stacks above its value. A value with several
  lines puts each in a `span`. A fact list never carries the record's status. The search summary on results,
  `section.search-summary`, is a ruled flex-wrapping strip with wrapping facts, `--space-3` between rows and
  `--space-5` between columns; long facts and filters remain readable. The fact list in a result row is at
  `--font-size-2` with `--space-1` between facts.
- List row: `ul.list-rows` shows a list of a person's records, one `li` per record. Each is a bordered row, with a
  `1px` `--line` border, `--radius-card` corners and `--space-3` between rows. A row has exactly one link,
  `a.list-row-title`, which holds only the record's name in bold, spans the row's width and is at least `2.75rem`
  tall. Everything else is plain supporting text outside the link: `p.list-row-meta`, in `--muted` at
  `--font-size-2`, holds plain text, a reference in `bdi`, a status badge and a date in `time`, and wraps. Further blocks of the
  same record follow inside the `li`.
- Card: `article.card` presents one record among several in a grid or list on a page that uses the Page template.
  The same `.card` surface also applies to the public cottage booking aside and the Customer Booking Request
  status/progress, reference/details and separate Messages groups. It is a `--card` surface with `--radius-card` corners and the `--shadow-card` elevation shadow. It shows no
  border: its `1px` border is `transparent`, so the card keeps an edge where the browser forces colours and removes
  shadows. It sets no padding and no layout; the block that uses it does. Its text has three tiers: `card-title` on
  the record's heading, in `--display` at weight 700 in `--ink` at `--font-size-4`, with line height `1.25` and
  `1.4` in Sorani; `card-detail` for the line that places or describes the record, in `--muted` at
  `--font-size-2`; and `card-small-print` for counts and other secondary facts, in `--muted` at `--font-size-1`.
  The cottage list card, `.cottage-profile-card`, uses the pattern and adds the Cottage card rules below. A
  panel, notice, list row or empty state outside those named groups is not a card and keeps its `1px` `--line`
  border.
- Search result: each result uses the card surface with an `18rem` photo beside its details, moving above them at
  `tablet`. Without a photo, omit the empty frame and use the full detail width. The detail header places its
  overview at the inline start and From Price at the inline end, in `--display`, `--green` and `--font-size-5`,
  with its qualifying note retained. At `phone` use the order overview, price, Service Days, footer, with the
  price start-aligned. Each Service Day has three option columns, stacking at `tablet`; a historical fourth
  option wraps to the next row, and additional days remain. The fee note and View cottage share a ruled footer
  after all days, stacking with a full-width action at `phone`. Matched amenities, filters and paging remain.
- Public cottage page: the first published photo spans the page column in `.profile-main-image`, `29rem` high
  on desktop and `16 / 10` at `tablet`, cropped at `50% 62%`, with `--space-5` clear space below. Remaining
  photos in `.profile-gallery` use `16 / 10` frames with `--radius-card` corners, in order across three columns,
  wrapping further rows, with `--space-3` gaps and `--space-2` at `phone`. Never truncate the published media
  array. Zero photos creates no hero, empty gallery or reserved photo gap; one photo creates only the hero.
  The desktop layout has a flexible prose column and a `23rem` booking column, `--space-7` apart and
  `--space-5` between rows. The booking aside begins level with the thumbnails, or facts when there are no
  thumbnails, and stays static at every width. At `tablet` the document and visual order is lead photo,
  thumbnails, facts, booking, then description, amenities, rules and reviews. Ruled capacity/room facts and
  prose sit directly on parchment; description and House Rules use `--font-size-4`, green section headings use
  the section-title pattern, and amenities occupy two ruled columns. Prose is at most `36rem` wide, with
  `--space-7` between facts and prose and between prose sections. The booking card has `--space-5` padding,
  `--space-4` at `phone`, a green heading, the existing fee note and full-width quote/message actions. Keep every
  existing loading, stale-selection, missing-period, disabled, cross-midnight and price-unavailable state.
- Cottage card: a cottage list card has five rows held in a subgrid so cards in a row align: cover, title, detail,
  small print, actions. The card grid fills its row with empty columns, so a lone card keeps its column width.
  The cover runs edge to edge at `16 / 10`, cropped with `object-fit: cover`, on `--surface-placeholder` while
  it loads, and shows the first ready photo in the photo editor's order with a translated text alternative that
  names the cottage. Status badges sit over the cover at its block start and inline start, `--space-3` in, on
  `--layer-raised`. A cottage with no ready photo shows the 'No photos yet' panel: `135deg` bands of
  `--surface-no-photo` and `--surface-no-photo-band`, each `--space-3` wide, with the label centred in bold
  `--ink-accent` at `--font-size-2`. The actions row puts the open action at the inline start. The owner's card
  shows the From Price in `--muted` at `--font-size-2`, formatted like every other amount, at the inline end of the
  actions row, or on its own line below the open action where the row is too narrow; it shows nothing where there
  is no price.
- Request row: `article.card.request-row` shows one waiting Booking Request, in a single-column `div.request-rows`
  with `--space-3` between rows. It uses the card pattern and is a three-column grid with `--space-4` padding and
  gaps: a `5rem` square image frame with `--radius-card` corners on `--surface-placeholder`, left empty when the
  cottage has no public photo; the facts, which are a `card-title` heading with the customer and party size, a
  `card-detail` line with the cottage, Booking Period and price, the time-left status badge and a `View request`
  text link to the full Booking Request page, which does not prefetch; and the two actions, each as wide as its
  label. The photo's `alt` is empty because the facts beside it name the cottage. A block an action opens, as
  Decline opens its reason, spans the row beneath all three. At the `phone` breakpoint the actions move beneath the
  photo and facts and stay side by side.
- Summary tile: `ul.summary-tiles` under a page heading holds one `li.summary-tile` per count, in equal columns
  with `--space-4` between them, `--space-2` at the `phone` breakpoint. A tile is a `--card` block with a `1px`
  `--line` border, `--radius-card` corners and `--space-4` padding, `--space-3` at the `phone` breakpoint, holding
  the number in a `strong`, in `--display` in `--green` at `--font-size-5`, above its label in a `span`, in
  `--muted` at `--font-size-1`. It is not a card and takes no shadow. A count that cannot be known leaves its tile
  out and is never shown as zero; a page with nothing to count shows the empty state and no tiles. On the Cottage
  Owner's cottages page the empty state holds only its sentence: the create form that follows it is the page's next
  action, and where creation is unavailable no action is invented.
- Status badge: `span.status-badge` is the compact status of one item in a list row or card. Its text is the
  translated status label, so the status never depends on colour. It is a pill on `--status-neutral-bg` with bold
  `--ink` text at `--font-size-1`. A badge may add one tone class, which draws a `0.5rem` dot before the label,
  `--space-2` from it and on the side the text starts: `status-badge-published` for a record Customers can see,
  `status-badge-draft` for a private record not yet submitted, and `status-badge-review` for a submitted record
  waiting for a decision with nothing published. The dot repeats the label and is never the only sign of the
  status; a badge with any other status, or one that states a fact that is not a status, has no dot. A badge that
  states the time left before a deadline, as a waiting Booking Request's does, adds `status-badge-attention`, which
  sets the `--status-attention-bg` and `--status-attention-text` pair and draws no dot: its words state the time
  left, so the colour only repeats them. It is never the page-level status. Over a cottage card's cover it is
  unchanged and stays opaque, so its contrast never depends on the photo.
- Rating stars: the `span.stars` beside a published review's rating is decorative and hidden from assistive technology, so the rating text carries the meaning.
- Status banner: `p.status-banner` is the page-level status of a record page. It follows the page title, at most
  one per page, and keeps `role="status"` and `aria-live="polite"`. Customer Booking Request status places the
  title on parchment above an unboxed `--space-5` stack: status/progress in one lifted group, reference/all facts
  in a second, and Messages/action in a third. There is no photograph: the reference stands alone and Cottage
  is the first fact. The details group has `--space-5` padding, a rule between reference and facts, and Customer
  Total between two rules with its value in `--display`. Its action footer aligns to the inline end; Messages
  is a `--space-5`-padded heading/action row with errors spanning both columns, stacking at `phone`. All
  deadlines, notes, errors and notification details remain readable. The quote/form, its pre-live gate and
  Confirmed/Cancelled Booking compositions retain their own designs. The banner is a block on
  `--status-neutral-bg` with `--radius-card` corners, holding the status label in bold `--green`, followed by one
  plain-language sentence in `--ink`, in a `span`, where the status has one.
- Section heading: `h2.section-title` titles a section below the page title; the `h1` takes `page-title`. It is
  `--display` in `--green` at `--font-size-4` with line height `1.25`, and has `--space-4` below it.
- Empty state: `div.empty-state` fills a list or record area that has nothing to show. It is a `--card` block with
  a `1px` `--line` border, `--radius-card` corners and `--space-5` padding, holding one `p` with a single sentence
  saying what is absent and, `--space-3` below it, one next action as a secondary content-width `ActionLink`. It
  is not an error; a failure uses `role="alert"`.
- New work that shows facts, a list of records, a card, a status, a section title or an empty list reuses these. A screen
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
- Keyboard focus uses opaque forest-green `--focus-ring` (`#22402f`) and cream `--focus-outline` (`#fffcf5`).
  From the control outward, a `2px` cream separator keeps the `2px` green ring distinct on green controls, then
  a cream outline surrounds it. Shared `.action`, `.action-link`, `.form-control`, `.choice-control` marks and
  `.disclosure` summaries have a `2px` cream outline; other buttons, inputs, selects, textareas and links use
  `3px`. Both have a `4px` outline offset. The green and cream bands contrast at least 9:1 with each other;
  the green band reaches at least 3:1 on bright surfaces. Measure the rendered bands against their actual adjacent surfaces, including
  perimeter pixels over photographs and gradients; the token ratios alone do not prove visibility there.
- Focused fields and disclosure summaries have a green border. Invalid fields and choice marks retain their red
  error border and semantics; keyboard focus replaces the translucent invalid halo with the two bands, and blur
  restores that halo. Focused pressed toggles retain their inset edge, tint and pressed semantics.
- `.cottage-shift-schedule-form` controls inherit this shared two-band focus treatment.
- A busy action keeps native `disabled` blocking against duplicate activation. Only a focused initiating control
  owns focus through that action: after settlement, focus returns to the same enabled control, or to its explicitly
  named successor when the control is removed or remains disabled. A control made busy by another action does not
  claim focus. Callers name successors by ID; a missing target never falls back to the page body or an arbitrary
  control.
- A connected source that is transiently disabled keeps its focus intent; keep its target heading connected
  during pending and render the matching local `ActionFocusTarget` only when the caller's existing pending state
  or result says the action has settled, authorizing the named successor if the source remains disabled.
- For a feedback successor, `ActionFeedback` accepts optional `focusTargetId?: string`. It applies the ID,
  `tabIndex={-1}` and `action-focus-target` to its existing paragraph and includes the matching local
  `ActionFocusTarget`, preserving the status or alert role and content. The prop is the readiness signal
  described above: supply it only for a ready named successor and omit it while pending or for untargeted feedback.
- Existing headings, status text and landmarks explicitly named as busy-action successors use `tabIndex={-1}`
  and `action-focus-target`. When focus is visible after keyboard interaction, including a programmatic
  keyboard handoff, `.action-focus-target:focus-visible` uses the cream separator, green ring and cream `3px`
  outline with a `4px` offset. Fresh ordinary pointer focus on these targets does not draw an outline. These
  non-control targets keep their existing semantics, copy and layout and stay outside the sequential Tab order. Verify each new
  target's visible focus and contrast against its actual adjacent surface in the running view. Viewport-width
  non-control targets add `action-focus-target-inset`: this exception uses a green `3px` outline at
  `outline-offset: -3px` without a shadow on the existing light page surfaces. The outline stays inside the
  viewport and paints above the existing non-positioned opaque page background; inset contrast needs rendered verification.
- Moving focus elsewhere, Tab intent, an outside pointer action, browser history navigation, window blur or
  pagehide permanently cancels owned focus, even if the element the person moved to later disappears. An action
  that navigates must explicitly opt into a handoff to a named destination target after its commit; ordinary
  navigation and initial page loads do not move focus through this pattern.
- The required first-name step (`AccountNameGate`) replaces the page with a standalone `main` holding the step
  title as an `h1`, a short introduction and the first-name form. The page underneath stays mounted and hidden,
  so it keeps its state and is revealed unchanged after saving. The step title takes focus when the step shows,
  unless focus is already in the site header or in the step. "Save and continue" names the avatar button
  (`site-header-account-button`) as its focus successor.
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

- A media query that tests width is `max-width` with one of the five values below. Custom properties cannot be
  used in media queries, so the values are literals, written in `rem` so a layout follows the reader's browser
  text size; the pixel figures are those at the browser default.

| Name | `max-width` | Pixels | At or below it |
|---|---|---|---|
| compact | `24rem` | 384 | a two-up grid of short values becomes one column; the site header's language button drops its globe |
| phone | `40rem` | 640 | the phone layout: fields, rows and headers stack, and a form may set its buttons to fill the width; the site header's open panels span the screen and its brand drops the tagline |
| tablet | `47.5rem` | 760 | a main column and its side column stack |
| wide | `53rem` | 848 | a form and its fixed side panel stack |
| header | `64rem` | 1024 | the site header stops wrapping its row, hides the rule and moves a signed-out visitor's links into a panel opened from one icon button |

- New work reaches for `phone` first and adds no value. [globals.test.ts](../src/app/globals.test.ts) reads the
  `rem` values in this section, so a breakpoint is added or removed here in the same change as its media query.
- A query that tests no width, such as `prefers-reduced-motion`, is not a breakpoint, and neither is the `sizes`
  hint on an image, which describes the image's rendered width.
