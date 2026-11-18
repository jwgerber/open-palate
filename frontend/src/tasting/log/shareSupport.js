/** Shared-flight constants, kept out of the component files for fast refresh. */
export const POLL_MS = 5000;
// The Advanced live poll (timer + passes while tasters score). The clock ticks locally, so only
// a pass change travels; slower keeps a room full of tasters on one IP under the rate limit.
export const LIVE_POLL_MS = 15000;

/** The link a joiner opens: a path on this origin (the server serves the app at every path). */
export const flightLink = (id) => `${window.location.origin}/f/${id}`;
/** Print sheets open in their own tab: the print route for one Advanced flight, or the blank sheet. */
export const sheetsLink = (id) => `${window.location.origin}/print/sheets/${id}`;
export const blankSheetsLink = () => sheetsLink('blank');
