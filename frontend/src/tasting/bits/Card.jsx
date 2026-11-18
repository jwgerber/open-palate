/** A paper card. `outlined` swaps the shadow for a divider border (reveal cards). */
import { Box } from '@mui/material';

export default function Card({ children, sx, outlined = false, ...rest }) {
  return (
    <Box
      sx={{
        p: 2, borderRadius: 2, bgcolor: 'background.paper',
        ...(outlined ? { border: '1px solid', borderColor: 'divider' } : { boxShadow: (t) => t.shadows[1] }),
        ...sx,
      }}
      {...rest}
    >
      {children}
    </Box>
  );
}
