# RentCottage design system

This document owns how RentCottage's interface is built: which values are tokens and where they live, the literals
a stylesheet may still write, and the component patterns new work reuses. The Arabic, Sorani and English
presentation rules in the Hard constraints of [AGENTS.md](../AGENTS.md) are contracts, and the rules below are how
the code keeps them.

## Values live in the token block

- The only token block is `:root` in [globals.css](../src/app/globals.css). It holds every interface colour: the
  base palette `--background`, `--card`, `--ink`, `--muted`, `--green`, `--gold` and `--line`, then the groups
  Surfaces, Ink, Lines and accents, Brand tints, Shade over hero imagery, and Status. It also holds the font
  families `--display` and `--body`, and `color-scheme: light`. There is no Tailwind and no theme object.
- Interface colours and font families come from these tokens through `var(--…)`.
  [globals.test.ts](../src/app/globals.test.ts) fails on a colour literal outside `:root` other than in an elevation
  shadow, and on a custom property a stylesheet uses that `:root` does not declare.
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

## Tolerated literals

A stylesheet may write these as literals:

- `0`, hairline `1px` borders, `50%` and `999px` for circles and pills.
- Percentages and `fr` or flex sizing in layout.
- `currentColor` and `transparent`.
- Radius, stacking order and breakpoint values, and elevation `box-shadow` values including their colours, until
  #435 settles their scale. New work reuses a value already in use rather than inventing one.
- A focus ring written as a `box-shadow` that starts `0 0 0` is not an elevation shadow: its colour is a token.

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

- Media queries are `max-width`. Custom properties cannot be used in media queries, so breakpoints are literals.
- In use in `src/app/globals.css`: `850px`, `760px`, `700px`, `620px`, `420px` and `40rem`. The CSS modules also
  use `42rem`, `37rem`, `36rem` and `24rem`.
- New work reuses one of these until #435 names a set.

## Existing debt

These are known gaps, not standards to copy.

- #442: several near-identical colours are separate tokens, such as four error reds and several success greens;
  which of them are one role is not yet decided.
- #435: there is no shared scale for radius, shadow, stacking order or breakpoints.
