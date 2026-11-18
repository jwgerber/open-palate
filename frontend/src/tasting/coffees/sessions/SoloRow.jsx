/**
 * One line for a solo tasting: date, prep, your stars (basic) or total (Advanced), the terms,
 * and a delete. Your own read deletes for any person; someone else's only for an editor.
 */
import { Box, Typography } from '@mui/material';
import { PREP_LABELS } from '../../content';
import Stars from '../../bits/Stars';
import DeleteReadButton from './DeleteReadButton';
import { f1, formatSessionDate } from './sessionFormat';

export default function SoloRow({ session, onDeleteRead, canManage, isPerson }) {
  const { yours } = session;
  const own = !!yours;
  const reader = own ? null : session.reads?.[0];
  // Someone else's read can only be deleted when the server named it.
  const canDelete = own ? isPerson : canManage && !!reader;
  const terms = (own ? yours : reader)?.terms ?? [];
  const shown = own ? yours : reader;

  const del = () => (own
    ? onDeleteRead({ flightId: session.flight_id, who: 'Your' })
    : onDeleteRead({ flightId: session.flight_id, tasterKey: reader.taster_key, who: `${reader.taster_name}'s` }));

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 48, flexWrap: 'wrap', borderBottom: '1px solid', borderColor: 'divider' }}>
      <Typography sx={{ fontSize: 15, minWidth: 92 }}>{formatSessionDate(session.date)}</Typography>
      <Typography variant="body2" color="text.secondary">{PREP_LABELS[session.prep] ?? session.prep}</Typography>
      {session.sheet === 'advanced'
        ? <Typography sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{f1(shown?.total)}</Typography>
        : <Stars value={shown?.overall ?? null} size={16} />}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
        {terms.map((t) => <Typography key={t} variant="body2" color="text.secondary">{t}</Typography>)}
      </Box>
      {canDelete && <DeleteReadButton label={own ? 'Delete your read' : `Delete ${reader.taster_name}'s read`} onClick={del} />}
    </Box>
  );
}
