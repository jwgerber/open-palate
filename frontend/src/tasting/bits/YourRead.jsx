/**
 * One person's read of a coffee, for that person: Overall stars, the four
 * attribute words, the §5.2 sentence, the note, defects. Rendered inside the
 * caller's Card on the reveal and on the coffee page. `read` is the
 * `_entry_dict` shape (vals + sentence + tags + defects + note).
 */
import { Box, Typography } from '@mui/material';
import Eyebrow from './Eyebrow';
import Stars from './Stars';
import AttributeBars from './AttributeBars';

export default function YourRead({ read, when }) {
  return (
    <Box data-testid="your-read">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Eyebrow>Your read</Eyebrow>
        {when && <Typography variant="caption" color="text.secondary">{when}</Typography>}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
        <Stars value={read.overall} size={22} />
        {read.overall != null && <Typography variant="body2" color="text.secondary">{read.overall} of 5</Typography>}
      </Box>
      <AttributeBars vals={read} sx={{ mt: 1.5 }} />
      {read.sentence && <Typography sx={{ fontStyle: 'italic', mt: 1.5 }}>{read.sentence}</Typography>}
      {read.note && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>{read.note}</Typography>}
      {read.defects?.length > 0 && (
        <Typography variant="body2" sx={{ color: 'error.dark', mt: 0.5 }}>Defects noted: {read.defects.join(', ')}</Typography>
      )}
    </Box>
  );
}
