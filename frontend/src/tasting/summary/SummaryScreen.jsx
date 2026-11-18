/**
 * The Advanced cupping summary: the ranking, then one collapsible card per
 * coffee. While the flight is open (no result yet) it is the same waiting state
 * the basic flight uses. A summary body has `coffees`, not `cups`, which is why
 * a Advanced flight must never be routed through RevealScreen.
 */
import { lazy, Suspense, useCallback, useState } from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import ConfirmDialog from '../../common/ConfirmDialog';
import Screen from '../bits/Screen';
import Eyebrow from '../bits/Eyebrow';
import { WaitingState, DeleteMine, DeleteClosedFlight } from '../log/screens/RevealScreen';
import RankingTable from './RankingTable';
import CoffeeSummaryCard from './CoffeeSummaryCard';
import CalibrationBlock from './CalibrationBlock';
import { tastingApi } from '../tastingApi';
import { toGroupTime, getGroupTimezone } from '../../time';
import { useTastingIdentity } from '../useTastingIdentity';
import { mayEnterPaper } from '../paper/mayEnterPaper';
import { apiErrorMessage } from '../../apiError';

const PaperEntryDialog = lazy(() => import('../paper/PaperEntryDialog'));

export default function SummaryScreen({ draft, onDone, onCloseFlight, closing = false, onDelete, onDeleteFlight, onRefreshResult, memberId }) {
  const [openIds, setOpenIds] = useState(() => new Set());
  const toggle = useCallback((id) => setOpenIds((s) => {
    const next = new Set(s);
    if (!next.delete(id)) next.add(id);
    return next;
  }), []);
  const select = useCallback((id) => {
    setOpenIds((s) => new Set(s).add(id));
    document.getElementById(`cup-card-${id}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, []);

  const identity = useTastingIdentity();
  const { isSharedDevice, canManage } = identity;
  const [enteringPaper, setEnteringPaper] = useState(false);
  const [removing, setRemoving] = useState(null);   // the paper read awaiting confirm
  const [removeError, setRemoveError] = useState(null);
  const [downloadError, setDownloadError] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const body = draft.result;
  // The server refuses the shared-device door, and a device-hosted cupping's host can't delete from anywhere.
  const canRemovePaper = !!body?.named && !isSharedDevice && (canManage || !!body.flight?.is_host);
  const removePaper = useCallback(async () => {
    const read = removing;
    setRemoving(null);
    try {
      setRemoveError(null);
      await tastingApi.deleteTastings(body.flight.id, { tasterKey: read.taster_key });
      await onRefreshResult?.();
    } catch (e) {
      setRemoveError(apiErrorMessage(e, "Couldn't remove the paper sheet."));
    }
  }, [removing, body, onRefreshResult]);
  const afterPaperSaved = async () => {
    setEnteringPaper(false);
    await onRefreshResult?.();
  };
  const canDownload = !!body?.named && !isSharedDevice;
  // A shared device can type paper sheets in but never remove them (the shared-device door can't delete).
  // An unnamed body carries no reads, so the device that may enter paper is told up front too.
  const askEditorToRemove = isSharedDevice && !!body && (
    mayEnterPaper(body.flight, identity) || body.coffees.some((c) => c.reads?.some((r) => r.created_via === 'paper')));
  const download = useCallback(async () => {
    const f = body.flight;
    // The flight's date is the group-local day it opened, not the UTC one.
    const day = toGroupTime(f.opened_at, getGroupTimezone())?.format('YYYY-MM-DD') ?? 'flight';
    try {
      setDownloadError(null);
      setDownloading(true);
      await tastingApi.downloadCuppingCsv(f.id, `cupping-${day}-${f.id}.csv`);
    } catch {
      setDownloadError("Couldn't download the spreadsheet. Try again.");
    } finally {
      setDownloading(false);
    }
  }, [body]);

  if (!body) {
    if (!draft.flight) return null;
    return (
      <WaitingState
        flight={draft.flight} error={draft.error} onClose={onDone} onCloseFlight={onCloseFlight}
        onDelete={onDelete} onDeleteFlight={onDeleteFlight} closing={closing}
      />
    );
  }
  return (
    <Screen
      title={body.flight?.name || 'Cupping summary'}
      onClose={onDone}
      trailing={canDownload && (
        <Button size="small" startIcon={<DownloadIcon />} onClick={download} disabled={downloading} sx={{ minHeight: 44 }}>Download spreadsheet</Button>
      )}
      footer={(
        <>
          <Button variant="contained" size="large" onClick={onDone} sx={{ minHeight: 52 }}>Done</Button>
          {mayEnterPaper(body.flight, identity) && (
            <Button variant="outlined" size="large" onClick={() => setEnteringPaper(true)} sx={{ minHeight: 48 }}>Enter a paper sheet</Button>
          )}
          {askEditorToRemove && (
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>To remove a paper sheet, ask an editor.</Typography>
          )}
          <DeleteMine onDelete={onDelete} busy={closing} shared />
          <DeleteClosedFlight onDelete={onDeleteFlight} busy={closing} />
        </>
      )}
    >
      {draft.error && <Alert severity="error" sx={{ mt: 2 }}>{draft.error}</Alert>}
      {downloadError && <Alert severity="error" sx={{ mt: 2 }}>{downloadError}</Alert>}
      {removeError && <Alert severity="error" sx={{ mt: 2 }}>{removeError}</Alert>}
      {body.coffees.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 3 }}>Nobody logged a cup in this cupping.</Typography>
      ) : (
        <>
          <Eyebrow sx={{ mt: 2, mb: 1 }}>Ranking</Eyebrow>
          <RankingTable coffees={body.coffees} onSelect={select} />
          {body.calibration && <Box sx={{ mt: 3 }}><CalibrationBlock calibration={body.calibration} /></Box>}
          <Eyebrow sx={{ mt: 3, mb: 1 }}>Coffees</Eyebrow>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {body.coffees.map((c) => (
              <CoffeeSummaryCard
                key={c.coffee_id} coffee={c} named={body.named} yours={body.yours?.[c.coffee_id]}
                open={openIds.has(c.coffee_id)} onToggle={toggle}
                onRemovePaper={canRemovePaper ? setRemoving : undefined}
              />
            ))}
          </Box>
        </>
      )}
      <ConfirmDialog
        open={!!removing}
        title="Remove paper sheet?"
        message={`Remove ${removing?.taster_name ?? ''}'s paper sheet from this cupping?`}
        confirmLabel="Remove" confirmColor="error"
        onConfirm={removePaper}
        onClose={() => setRemoving(null)}
      />
      {enteringPaper && (
        <Suspense fallback={null}>
          <PaperEntryDialog
            open flight={body.flight} memberId={memberId}
            onClose={() => setEnteringPaper(false)} onSaved={afterPaperSaved}
          />
        </Suspense>
      )}
    </Screen>
  );
}
