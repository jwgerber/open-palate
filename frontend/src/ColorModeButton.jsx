import { useState } from 'react';
import { IconButton, ListItemIcon, ListItemText, Menu, MenuItem } from '@mui/material';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import BrightnessAutoOutlinedIcon from '@mui/icons-material/BrightnessAutoOutlined';
import { useColorMode } from './colorMode';

const OPTIONS = [
  { mode: 'system', label: 'Automatic', Icon: BrightnessAutoOutlinedIcon },
  { mode: 'light', label: 'Light', Icon: LightModeOutlinedIcon },
  { mode: 'dark', label: 'Dark', Icon: DarkModeOutlinedIcon },
];

/** Header button: pick Light, Dark, or Automatic (follow the device). */
export default function ColorModeButton() {
  const { mode, setMode } = useColorMode();
  const [anchor, setAnchor] = useState(null);
  const current = OPTIONS.find((o) => o.mode === mode) ?? OPTIONS[0];
  const pick = (next) => { setMode(next); setAnchor(null); };
  return (
    <>
      <IconButton
        aria-label={`Appearance: ${current.label}`}
        aria-haspopup="menu"
        onClick={(e) => setAnchor(e.currentTarget)}
        size="small"
      >
        <current.Icon fontSize="small" />
      </IconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {OPTIONS.map(({ mode: m, label, Icon }) => (
          <MenuItem key={m} selected={m === mode} onClick={() => pick(m)}>
            <ListItemIcon><Icon fontSize="small" /></ListItemIcon>
            <ListItemText>{label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
