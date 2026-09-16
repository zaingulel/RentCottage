// board-config.mjs — the ONE home for every RentCottage-specific board string the
// reader (board.mjs) and the writers (board-move/board-add) use.
//
// These values are facts about one live GitHub Projects board, not logic: an owner
// rename, a project move, a Status rename or a routing-option change is a single
// edit here rather than a hunt through five modules that each re-declared them.
// A second, differently-valued copy elsewhere is the bug this file exists to make
// impossible.
//
// This is the only file in the board toolkit that differs from Flowgauge's copy
// (#290). Every other module is byte-identical so a fix lands in both repositories
// as the same change; keep RentCottage's divergence here and nowhere else.

// Which project the board IS.
export const BOARD_OWNER = 'zaingulel';
export const BOARD_PROJECT_NUMBER = 4;
export const BOARD_REPOSITORY = 'RentCottage';

// The Status column names, in board order. The three lists below are subsets of it.
// #291 adds Flowgauge's Awaiting push between In progress and In review.
export const STATUS_OPTIONS = ['Backlog', 'Ready', 'In progress', 'In review', 'Done'];

// The pickable backlog per /resume Step 1: the two columns you draw candidates from.
export const PICKABLE_STATUSES = ['Backlog', 'Ready'];

// Waiting on the owner, not on a session: no stalled-claim clock runs here. Empty
// until #291 adds Awaiting push; an empty list exempts nothing, which is correct
// while the board has no such column.
export const WAIT_STATUSES = [];

// The end of the line — a card here makes no claim on anything.
export const TERMINAL_STATUSES = ['Done'];

// The single-select field that routes a card to a front of work, and its options in
// display order (the order the pick view groups them in). #291 replaces Area with
// Flowgauge's Workstream.
export const ROUTING_FIELD = 'Area';
export const ROUTING_OPTIONS = [
  'Foundation & quality',
  'Customer marketplace',
  'Owner backoffice',
  'Booking lifecycle',
  'Administration & governance',
];

// The label that marks an epic. RentCottage decomposes through native sub-issues and
// has no epic label, so the two epic rules stay inert until one exists.
export const EPIC_LABELS = [];
