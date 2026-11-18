/**
 * Drops what the browser remembered about whoever was just signed in: the cached
 * coffee list (its `tasted_by_me` marks are theirs) and any parked or saved flight
 * draft. Called on sign-out and device disconnect so the next person on the same
 * phone or tablet starts clean.
 */
import tastingApi from './tastingApi';
import { clearParkedDraft } from './log/useFlightDraft';

export function forgetLocalState() {
  tastingApi.invalidateCoffees();
  clearParkedDraft();
}
