/**
 * My palate — your tastings on one page, in two sections that never mix:
 * basic tastings (1-5 stars, `created_via='account'` reads) and cuppings
 * (Advanced totals out of 100). Nothing here names another taster.
 */
import { useEffect, useState } from 'react';
import { Alert, Box, CircularProgress, Typography } from '@mui/material';
import { tastingApi } from '../tastingApi';
import { apiErrorMessage } from '../../apiError';
import Eyebrow from '../bits/Eyebrow';
import Card from '../bits/Card';
import { BigNumber } from '../bits/ConsensusHeadline';
import { plural } from '../format';
import { signed } from '../coffees/coffeeSupport';
import { signedLean } from '../bits/chartMath';
import BasicSection from './BasicSection';
import CuppingSection from './CuppingSection';

const EMPTY_CUPPING = { reads: 0, coffees: 0, open_reads: 0, lean: {}, lean_mean: null, lean_coffees: 0, votes: { yes: 0, maybe: 0, no: 0 }, room_yes_share: null, cups: [] };

function Summary({ title, value, caption, empty = 'Not yet' }) {
  return (
    <Card sx={{ py: 1.5 }}>
      <Eyebrow>{title}</Eyebrow>
      <BigNumber size={28} sx={{ lineHeight: 1.2 }}>{value ?? '—'}</BigNumber>
      <Typography variant="body2" color="text.secondary">{value == null ? empty : caption}</Typography>
    </Card>
  );
}

export default function PalateTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    tastingApi.getPalate().then((d) => { if (live) setData(d); }).catch((e) => { if (live) setError(apiErrorMessage(e, "Couldn't load your palate.")); });
    return () => { live = false; };
  }, []);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!data) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  // The frontend can deploy before the backend adds this block.
  const cupping = data.cupping ?? EMPTY_CUPPING;
  if (data.tastings === 0 && cupping.reads === 0 && cupping.open_reads === 0) {
    return (
      <Card>
        <Typography sx={{ fontWeight: 600 }}>Nothing here yet.</Typography>
        <Typography variant="body2" color="text.secondary">Taste or cup something and your palate starts here. Shared-device basic tastings don't count — they're the room's, not yours.</Typography>
      </Card>
    );
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pb: 4 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
        <Summary title="Basic tastings" value={data.bias == null ? null : signed(data.bias)} caption={`${plural(data.coffees, 'coffee')} · 1-5 stars`} />
        <Summary
          title="Cuppings"
          value={cupping.lean_mean == null ? null : signedLean(cupping.lean_mean)}
          caption={`${plural(cupping.lean_coffees, 'coffee')} · per category`}
          empty={cupping.reads > 0 ? 'Needs 3 others on a coffee' : 'Not yet'}
        />
      </Box>
      <Box>
        <Typography variant="h6" component="h2" sx={{ mb: 1, fontSize: 18 }}>Basic tastings</Typography>
        <BasicSection data={data} />
      </Box>
      <Box>
        <Typography variant="h6" component="h2" sx={{ mb: 1, fontSize: 18 }}>Cuppings</Typography>
        <CuppingSection cupping={cupping} />
      </Box>
    </Box>
  );
}
