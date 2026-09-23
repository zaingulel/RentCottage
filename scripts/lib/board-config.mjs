// board-config.mjs — the ONE home for every RentCottage-specific board string the
// reader (board.mjs) and the writers (board-move/board-add/issue-publish) use.
//
// These values are facts about one live GitHub Projects board, not logic: an owner
// rename, a project move, a Status rename or a routing-option change is a single
// edit here rather than a hunt through five modules that each re-declared them.
// One exception: renaming `Backlog` or `Done` also means editing the Project
// automation that names it, which has no update API. The rule lives in
// docs/ISSUE-TRACKER.md.
// A second, differently-valued copy elsewhere is the bug this file exists to make
// impossible. Every other toolkit file is byte-identical to Flowgauge's, so a fix
// lands in both repositories as the same change; this file is the one that differs.

// Which project the board IS.
export const BOARD_OWNER = 'zaingulel';
// The GraphQL root field GitHub serves the owner's Projects under: 'user' for a personal
// account, 'organization' for an organisation. A wrong value fails loudly as a GitHub
// GraphQL error, never as a silently empty board.
export const BOARD_OWNER_TYPE = 'user';
export const BOARD_PROJECT_NUMBER = 4;
export const BOARD_REPOSITORY = 'RentCottage';

// The Status column names, in board order. The three lists below are subsets of it.
export const STATUS_OPTIONS = ['Backlog', 'Ready', 'In progress', 'Awaiting push', 'In review', 'Done'];

// The pickable backlog per /resume: the two columns you draw candidates from.
export const PICKABLE_STATUSES = ['Backlog', 'Ready'];

// Waiting on the owner, not on a session: no stalled-claim clock runs here.
export const WAIT_STATUSES = ['Awaiting push'];

// The end of the line — a card here makes no claim on anything.
export const TERMINAL_STATUSES = ['Done'];

// The single-select field that routes a card to a front of work, and its options in
// display order (the order the pick view groups them in).
export const ROUTING_FIELD = 'Workstream';
export const ROUTING_OPTIONS = ['Go-to-market', 'Product', 'Platform'];

// A single-select field whose one option parks a card: the card keeps its Status column
// but is never pickable, and the pick view names it on a "Parked" line instead. RentCottage
// has no parked lane.
export const PARKED_LANE = null;

// The label that marks an epic; the bare form is Flowgauge's legacy alias, kept so the
// shared tests stay byte-identical. No RentCottage issue carries it.
export const EPIC_LABELS = ['type:epic', 'epic'];
