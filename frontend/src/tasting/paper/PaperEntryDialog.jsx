/**
 * Type a paper cupping sheet back in as someone else's read: pick the taster,
 * then the Advanced entry screen in "paper" mode, then ONE write to
 * POST /flights/<id>/paper. The dialog owns its own draft reducer, so it never
 * touches the user's own parked sheet.
 */
import { useMemo, useReducer, useState } from 'react';
import { Dialog, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ConfirmDialog from '../../common/ConfirmDialog';
import AdvancedEntryScreen from '../advanced/AdvancedEntryScreen';
import PaperTasterScreen from './PaperTasterScreen';
import ScanBlock from './ScanBlock';
import { shrinkPhoto } from './shrinkPhoto';
import { matchTaster } from './matchTaster';
import { CUPS_PER_PAGE } from '../print/printSheet';
import { reducer, initialDraft, buildEntries, scanUnread } from '../log/flightDraft';
import { useOnline } from '../../common/useOnline';
import { tastingApi } from '../tastingApi';
import { apiErrorMessage } from '../../apiError';

const hasTyping = (draft) => Object.values(draft.entries).some((e) =>
  Object.keys(e.advanced).length > 0 || !!e.vote || Object.keys(e.tags).length > 0
  || Object.keys(e.defects).length > 0 || !!e.note?.trim());

function PaperEntryBody({ flight, memberId, onClose, onSaved }) {
  const online = useOnline();
  const [draft, dispatch] = useReducer(reducer, flight, (f) => reducer(initialDraft(), { type: 'seedFromFlight', flight: f }));
  const [taster, setTaster] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [path, setPath] = useState([]);
  const [roster, setRoster] = useState(null);
  const [scan, setScan] = useState({ reading: false, error: null, warnings: [], readName: null, flags: {} });
  const pages = Math.max(1, Math.ceil(flight.cups.length / CUPS_PER_PAGE));

  // Match against the roster as it arrives: the scan can finish before the tiles load.
  const suggestion = useMemo(() => {
    if (!scan.readName) return null;
    const hit = matchTaster(scan.readName, roster);
    return hit ? { ...hit, readName: scan.readName } : { guestName: scan.readName, name: scan.readName, readName: scan.readName };
  }, [scan.readName, roster]);

  const readSheet = async (files) => {
    if (!online || scan.reading) return;
    setScan((s) => ({ ...s, reading: true, error: null }));
    let photos;
    try {
      photos = await Promise.all(files.map((f) => shrinkPhoto(f)));
    } catch {
      setScan((s) => ({ ...s, reading: false, error: "Couldn't open that photo — try another, or type the sheet in." }));
      return;
    }
    try {
      const result = await tastingApi.scanPaperSheet(flight.id, { photos, memberId });
      dispatch({ type: 'scanFill', cups: result.cups, replaceAll: true });
      setScan({ reading: false, error: null, warnings: result.warnings || [], readName: result.taster?.read_name || null, flags: scanUnread(draft, result.cups) });
    } catch (e) {
      setScan((s) => ({ ...s, reading: false, error: apiErrorMessage(e, "Couldn't read the photo right now — type the sheet in instead.") }));
    }
  };

  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  // A save in flight can't be abandoned: the sheet would land after the typist thinks it was discarded.
  const requestClose = () => {
    if (busy) return;
    if (hasTyping(draft)) setConfirmClose(true); else onClose();
  };

  const save = async () => {
    if (!online || busy) return;
    setBusy(true);
    dispatch({ type: 'error', error: null });
    try {
      const result = await tastingApi.enterPaperSheet(flight.id, {
        tasterMemberId: taster.memberId, guestName: taster.guestName, entries: buildEntries(draft), memberId,
      });
      onSaved(result);
    } catch (e) {
      // A 409's `error` is a code; its `message` is the line meant for people.
      const message = e?.response?.data?.message || apiErrorMessage(e, "Couldn't save the paper sheet. Your entries are still here.");
      dispatch({ type: 'error', error: message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open fullScreen={fullScreen} maxWidth="sm" fullWidth onClose={requestClose}
      slotProps={{ paper: { 'aria-label': 'Paper cupping sheet', sx: { height: fullScreen ? '100%' : 'min(844px, 92vh)', bgcolor: 'background.default' } } }}
    >
      {!taster ? (
        <PaperTasterScreen
          onPick={setTaster} onClose={requestClose} onRoster={setRoster}
          scanBlock={<ScanBlock pages={pages} online={online} busy={scan.reading} error={scan.error} onRead={readSheet} />}
          suggestion={suggestion} warnings={scan.warnings} locked={scan.reading}
        />
      ) : (
        <AdvancedEntryScreen
          draft={draft} dispatch={dispatch} online={online} busy={busy} onClose={requestClose} onLog={save}
          path={path} onPath={setPath} variant="paper" paperName={taster.name} scanFlags={scan.flags}
        />
      )}
      <ConfirmDialog
        open={confirmClose}
        title="Discard this paper sheet?"
        message="Discard this paper sheet? Nothing has been saved."
        confirmLabel="Discard" cancelLabel="Keep typing" confirmColor="warning"
        onConfirm={() => { if (!busy) onClose(); }}
        onClose={() => setConfirmClose(false)}
      />
    </Dialog>
  );
}

/** Mounted only while open, so every opening starts a fresh sheet. */
export default function PaperEntryDialog({ open, flight, memberId, onClose, onSaved }) {
  if (!open) return null;
  return <PaperEntryBody flight={flight} memberId={memberId} onClose={onClose} onSaved={onSaved} />;
}
