import { IconButton } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';

/** A 44px delete target; `label` is the full accessible name ("Delete Robin's read"). */
export default function DeleteReadButton({ label, onClick }) {
  return (
    <IconButton aria-label={label} onClick={onClick} sx={{ width: 44, height: 44 }}>
      <DeleteOutlineIcon fontSize="small" />
    </IconButton>
  );
}
