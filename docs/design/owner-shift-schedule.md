# Owner shift schedule

This is the accepted owner-setup contract. [GLOSSARY.md](../../GLOSSARY.md) owns the domain terms and the
[product agreement](../product/rentcottage-mvp-prd.md#d-set-shifts-prices-and-availability) owns the product rules.
This manual records the accepted design and migration boundary; it is not a claim that production construction,
runtime verification or the broader customer journey in #265 is complete.

## Enter and check the schedule

Use two semantic field groups in Morning then Evening order. Each has a persistent translated identity, an
optional local name and labelled native start/end time controls. The owner chooses the actual hours; there are
no preset times, universal Morning/Evening windows or automatic swaps. Morning must start earlier than Evening.
Preserve an existing stored name. A blank new or cleared name defaults to the group's translated identity in the
editing language and uses the existing name field. Display stored names as original-text fallback without
claiming that they have translated versions; the fixed translated group identity remains visible alongside them.

Explain that all times use Iraq local time, UTC+3. Native controls may use the device's 12-hour or 24-hour entry
format; the textual read-back uses explicit 24-hour times. A shift ending earlier than it starts ends the next
day, written out beside the ending time. Its booking date, price and availability belong to the date it starts.
Equal individual start and end times are invalid. Reject overlapping shifts, including Evening overlapping the
following day's Morning. Touching endpoints are valid; no minimum cleaning gap is required.

Show each shift's actual interval and a distinct Full-day read-back below both groups. Full-day contains both
component shifts and runs continuously from Morning's start through Evening's final end, including time between
them. Its independently configured price comes from the existing pricing workflow, never a sum of the individual
prices. Pricing remains a separately saved section with standard, weekday and specific-date prices. Identify its
shift fields by translated Morning/Evening identities plus stored names, and show the actual access intervals.

Cleaning guidance is a suggestion beside the access explanation. The owner chooses whether to leave a gap and
its length; Full-day customers may remain during that gap. Consecutive Full-day bookings include the overnight
interval between bundles. Full-day is not necessarily 24 hours. Equal bundle endpoints mean the following day,
so a valid 09:00-to-09:00 bundle provides 24 hours rather than empty access.

These fictional examples are explanations, not defaults or marketplace-wide hours:

| Schedule or selection | Access read-back |
|---|---|
| Morning 09:00 to 15:00; Evening 17:00 to 23:00 | Individual shifts exclude 15:00 to 17:00; Full-day includes that gap and covers 09:00 to 23:00 continuously. |
| Morning 09:00 to 15:00; Evening 17:00 to 02:00 next day | Evening belongs to its start date; Full-day covers 09:00 to 02:00 next day, a hand-worked 17 hours. |
| Full-day on 12 and 13 October with that schedule | Continuous access from 12 October at 09:00 through 14 October at 02:00, including the overnight gap, a hand-worked 41 hours. |
| Morning 09:00 to 15:00; Evening 17:00 to 09:00 next day | Full-day covers 09:00 to the next 09:00, a hand-worked 24 hours; Evening touches the following Morning. |

## Confirm, save and edit

The read-back describes the current draft. Incomplete or invalid fields show their problem, never a saved
interval presented as valid draft coverage. Associate field errors with their controls and focus the first
invalid field after attempted submission. Require explicit confirmation of the times before saving and clear
that confirmation after any edit. Disable editing and submission while saving. Report a saved schedule only
after validated server success, then use that returned schedule as the saved baseline for another edit. A stale
revision requires reload; a refusal or unavailable result must not look like success.

Editing requires an approved Cottage Owner and a draft Cottage Profile. Retain authorization checks, expected
revision checks, atomic replacement, immutable history and the fences protecting active inventory commitments
and payment authorization claims. Submitted profiles are read-only. A historical three-shift schedule is shown
in full as read-only with a clear support instruction, never truncated to two rows.

Explain before Save that changes apply prospectively. Existing requests and confirmed bookings retain their
original times, stored names, purchased coverage, price, payment facts and accepted policy snapshots. Never
recompute them from the current schedule. A new revision requires prices and availability to be set again;
previous settings are not copied and the new schedule does not open automatically.

## Presentation and access

Build with the tokens and shared patterns in [DESIGN-SYSTEM.md](../DESIGN-SYSTEM.md). Keep the surrounding owner
page width and section-title pattern. The text-only layout uses two equal fieldset columns above the 40rem phone
breakpoint and stacks them in the same reading order below it, with `--space-4` gaps and `--space-5` panel padding.
Reuse FormControl, ActionButton, ChoiceControl, ActionFeedback and the read-back-and-confirm pattern. Controls
are at least 2.75rem high. There is no timeline editor, companion illustration, decorative icon or motion.

The Full-day fact list uses the notice surface with its actual interval emphasized in green. Cleaning guidance
is ordinary supporting text. Use logical spacing, English left-to-right and Arabic/Sorani right-to-left layouts.
Isolate clock, date and price runs with `bdi dir="ltr"`, and original names with `bdi dir="auto"`; translated
next-day words remain beside the endpoint. Reuse the established palette, Changa headings and Karla/Almarai body
fonts through their existing tokens.

The accepted schedule-form focus exception uses `--green` for the existing 2px outline with 2px offset on action
buttons, form controls and choice-control marks within `.cottage-shift-schedule-form`. The design system owns
that exception; other shared focus treatment remains unchanged. Enabled controls and error states still require
actual contrast and keyboard verification. The broader gold-focus repair in #703 is separate.

## Migration admission and rollback

Keep the historical table shape and readers compatible with two- or three-shift schedules; only new authorized
saves require exactly two. Migration admission scans every revision, including history, in one transaction
before changing the writer. Stop new application writes and verify no in-flight schedule calls on the explicitly
owned target. Lock `public.owner_application_cottage_profiles`, `public.cottage_shift_schedule_revisions` and
`public.cottage_shifts` in that order with ACCESS EXCLUSIVE locks for the short transaction.

Any three-shift revision aborts with RC205 and an operator message that migration is blocked, no rows were
rewritten and an owner decision is required. Other malformed counts also fail loudly. Do not remap, delete or
rewrite rows, including mock rows, to bypass admission. Refusal rolls back the transaction's function changes
and leaves existing rows and pointers intact. The owner-approved mock-data ruling permits this fail-loud
admission, not a shared or hosted database operation.

After a successful release, use a reviewed forward migration to restore prior writer/function definitions and
the earlier application artifact. Do not edit applied migration history, delete revisions or recompute bookings.
Preserve the repaired 24-hour coverage calculation while valid 24-hour bookings exist. Deployment and shared
database operations require their own authorization.

## Grounding and validation limits

The design uses explicit time fields and complete textual intervals. Prior art supports those choices:
[Checkfront's setup guide](https://support.checkfront.com/hc/en-us/articles/19868388054940-Configuring-allocation-and-visibility-for-items-using-the-Item-Builder-Classic-Items)
describes start/end times and crossing calendar days, and
[Dayuse's price explanation](https://support.dayuse.com/hc/en-us/articles/360020362440-What-is-included-in-the-price)
connects price to an access interval. Their inventory and payment rules do not define RentCottage's rules.
[World Wide Web Consortium forms guidance](https://www.w3.org/WAI/tutorials/forms/),
[error notification guidance](https://www.w3.org/WAI/tutorials/forms/notifications/),
[bidirectional text guidance](https://www.w3.org/International/articles/inline-bidi-markup/) and
[reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) ground labelled groups, associated errors,
direction isolation and a layout that preserves complete text at narrow widths.

Owner acceptance covers this design, its scoped green focus treatment and migration refusal on any historical
three-shift revision. Static proposal inspection covered English, Arabic and Sorani at desktop and narrow
widths, with direction repairs and independent AI copy review. It used read-only fields and disabled save and
confirmation controls; it proves no production saving, enabled-control contrast or accessible interaction.

Representative-user comprehension evidence is unavailable. No native-speaker review, screen-reader session,
automated accessibility scan or real browser zoom check was performed on the proposal. AI copy review does not
establish human comprehension or native fluency. Production interaction, keyboard/error/focus checks and the
database, migration, history, payment, concurrency and Worker observations remain separate required evidence;
this manual records none of them as passed.
