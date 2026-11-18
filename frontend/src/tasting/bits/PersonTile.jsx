/** A 64px roster tile: one person's first name, tapped to pick them. */
import { ButtonBase } from '@mui/material';
import { alpha } from '@mui/material/styles';

export default function PersonTile({ person, onPick, disabled = false }) {
  return (
    <ButtonBase
      disabled={disabled}
      onClick={() => onPick(person)}
      sx={{
        minHeight: 64, borderRadius: 2, border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper',
        px: 1.5, fontSize: 15, fontWeight: 500, textAlign: 'center',
        '&.Mui-disabled': { opacity: 0.5 },
        '&:active': { bgcolor: (t) => alpha(t.palette.primary.main, 0.12) },
      }}
    >
      {person.first_name || person.name}
    </ButtonBase>
  );
}
