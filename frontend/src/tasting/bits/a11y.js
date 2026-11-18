/** Shared sx fragments for the tasting entry primitives (raw ButtonBase has no focus ring). */
export const focusRing = {
  '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
};

/**
 * A palette role's text shade that clears contrast on the page background in
 * both modes: `.dark` on light, `.light` on dark (`.dark` on a dark surface
 * is nearly invisible). Use as an sx `color`.
 */
export const shadeText = (role) => (t) => (t.palette.mode === 'dark' ? t.palette[role].light : t.palette[role].dark);
