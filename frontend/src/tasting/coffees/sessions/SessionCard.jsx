/**
 * One tasting session of a coffee: header, totals strip, per-category table and
 * who tasted what. A withheld session (fewer than 3 reads, `room` and `reads`
 * both null) shows only your own read and a note.
 */
import { Box, Chip, Typography } from '@mui/material';
import { BAR_VOTE_LABELS, SCALE_WORDS } from '../../content';
import Card from '../../bits/Card';
import Eyebrow from '../../bits/Eyebrow';
import Stars from '../../bits/Stars';
import VoteBar from '../../bits/VoteBar';
import { InitialAvatar } from '../../bits/People';
import CategoryTable from './CategoryTable';
import DeleteReadButton from './DeleteReadButton';
import { f1, formatSessionDate, ordinal, signed } from './sessionFormat';

const FOOTER = "Each person's scores and notes are shown to editors and the cupping's host.";
const WITHHELD_MINE = "Only your read shows. The room's numbers appear once 3 people have tasted it.";
const WITHHELD_NONE = 'Scores stay private until 3 people have tasted it.';

function Stat({ label, children }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Eyebrow>{label}</Eyebrow>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{children}</Box>
    </Box>
  );
}

const VoteChip = ({ vote }) => (vote ? <Chip size="small" label={BAR_VOTE_LABELS[vote] ?? vote} /> : null);

function TotalsStrip({ session }) {
  const { yours, room, sheet } = session;
  if (!yours) return null;
  let body;
  if (sheet === 'advanced') {
    const others = room?.others_avg?.total ?? null;
    const lean = yours.total != null && others != null ? yours.total - others : null;
    body = (
      <>
        <Stat label="Your total">{f1(yours.total)}<VoteChip vote={yours.vote} /></Stat>
        {others != null && <Stat label="Everyone else">{f1(others)}</Stat>}
        {lean != null && <Stat label="Your lean">{signed(lean)}</Stat>}
        {room?.votes && <Box sx={{ flex: 1, minWidth: 160 }}><VoteBar votes={room.votes} /></Box>}
      </>
    );
  } else {
    const word = yours.overall != null ? SCALE_WORDS.overall[yours.overall - 1] : null;
    const others = room?.others_avg?.overall ?? null;
    const lean = yours.overall != null && others != null ? yours.overall - others : null;
    body = (
      <>
        <Stat label="Your stars">
          <Stars value={yours.overall} />
          {word && <Typography component="span" sx={{ fontSize: 15, fontWeight: 400 }}>{word}</Typography>}
        </Stat>
        {others != null && <Stat label="Everyone else"><Stars value={others} />{f1(others)}</Stat>}
        {lean != null && <Stat label="Your lean">{signed(lean)}</Stat>}
      </>
    );
  }
  return (
    <Box data-testid="totals-strip" sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 3, py: 1.5 }}>
      {body}
    </Box>
  );
}

function Terms({ terms = [], defects = [] }) {
  if (!terms.length && !defects.length) return null;
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.5 }}>
      {terms.map((t) => <Chip key={t} size="small" variant="outlined" label={t} />)}
      {defects.map((d) => <Chip key={d} size="small" color="error" variant="outlined" label={`defect: ${d}`} />)}
    </Box>
  );
}

function YourRead({ session, canDelete, onDelete }) {
  const { yours } = session;
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Eyebrow>What you tasted</Eyebrow>
        <Terms terms={yours.terms} defects={yours.defects} />
        {yours.note && <Typography sx={{ mt: 0.5, fontStyle: 'italic' }}>{yours.note}</Typography>}
      </Box>
      {canDelete && <DeleteReadButton label="Delete your read" onClick={onDelete} />}
    </Box>
  );
}

function RoomTasted({ room }) {
  if (!room.terms.length && !room.defects.length) return null;
  return (
    <Box sx={{ mt: 2 }}>
      <Eyebrow>What the room tasted</Eyebrow>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.5 }}>
        {room.terms.map((t) => <Chip key={t.term} size="small" variant="outlined" label={`${t.label} ${t.count}`} />)}
        {room.defects.map((d) => <Chip key={d.term} size="small" color="error" variant="outlined" label={`${d.term} ${d.count}`} />)}
      </Box>
    </Box>
  );
}

function NamedReads({ session, canDelete, onDelete }) {
  return (
    <Box sx={{ mt: 2 }}>
      <Eyebrow>What people tasted</Eyebrow>
      {session.reads.map((r) => {
        const who = r.is_you ? 'Your' : `${r.taster_name}'s`;
        return (
          <Box key={r.taster_key} data-testid="read-row" sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
            <InitialAvatar name={r.taster_name} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography sx={{ fontWeight: 600 }}>{r.taster_name}</Typography>
                {r.vote && <Chip size="small" label={BAR_VOTE_LABELS[r.vote] ?? r.vote} />}
              </Box>
              <Terms terms={r.terms} defects={r.defects} />
              {r.note && <Typography sx={{ mt: 0.5, fontStyle: 'italic' }}>{r.note}</Typography>}
            </Box>
            {canDelete(r) && (
              <DeleteReadButton
                label={r.is_you ? 'Delete your read' : `Delete ${r.taster_name}'s read`}
                onClick={() => onDelete(r.is_you ? { flightId: session.flight_id, who } : { flightId: session.flight_id, tasterKey: r.taster_key, who })}
              />
            )}
          </Box>
        );
      })}
    </Box>
  );
}

export default function SessionCard({ session, onDeleteRead, canManage, isPerson }) {
  const { room, reads, yours, rank, vs_flight: vsFlight } = session;
  const withheld = room == null;
  const canDeleteOwn = isPerson && (!session.shared || canManage);
  const canDelete = (r) => (r.is_you ? canDeleteOwn : canManage);
  const ownDelete = () => onDeleteRead({ flightId: session.flight_id, who: 'Your' });

  return (
    <Card component="section" aria-label={`Session ${formatSessionDate(session.date)}`}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
        <Typography sx={{ fontWeight: 600, fontSize: 17 }}>{formatSessionDate(session.date)}</Typography>
        {session.name && <Typography color="text.secondary">{session.name}</Typography>}
        {session.cup_label && <Chip size="small" label={session.cup_label} />}
        <Typography variant="body2" color="text.secondary">
          {session.sheet === 'advanced' ? 'Advanced' : 'Basic sheet'}
        </Typography>
        <Typography variant="body2" color="text.secondary">{`${session.n} ${session.n === 1 ? 'taster' : 'tasters'}`}</Typography>
        {rank && <Chip size="small" color="primary" variant="outlined" label={`${ordinal(rank.place)} of ${rank.of} cups`} />}
        {vsFlight != null && <Typography variant="body2" color="text.secondary">{`${signed(vsFlight)} vs flight average`}</Typography>}
      </Box>

      {withheld ? (
        <Box sx={{ mt: 1.5 }}>
          <Typography color="text.secondary">{yours ? WITHHELD_MINE : WITHHELD_NONE}</Typography>
          {yours && (
            <Box sx={{ mt: 1.5 }}>
              <TotalsStrip session={session} />
              <YourRead session={session} canDelete={canDeleteOwn} onDelete={ownDelete} />
            </Box>
          )}
        </Box>
      ) : (
        <>
          <TotalsStrip session={session} />
          <CategoryTable session={session} />
          {reads ? (
            <NamedReads session={session} canDelete={canDelete} onDelete={onDeleteRead} />
          ) : (
            <>
              {yours && (
                <Box sx={{ mt: 2 }}>
                  <YourRead session={session} canDelete={canDeleteOwn} onDelete={ownDelete} />
                </Box>
              )}
              <RoomTasted room={room} />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>{FOOTER}</Typography>
            </>
          )}
        </>
      )}
    </Card>
  );
}
