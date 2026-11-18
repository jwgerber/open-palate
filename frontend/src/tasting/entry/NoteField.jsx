/**
 * The cup's note. Local state between keystrokes so typing repaints one
 * field, not the whole entry; the value reaches the reducer on blur, or after
 * a short pause in typing, since a refresh does not blur the field first. Mount
 * it with `key={coffeeId}` so a cup switch starts from that cup's saved note.
 * Callers that leave the screen by button (Review / Log) blur the active element
 * first so the pending text is committed in the same event.
 */
import { memo, useEffect, useState } from 'react';
import { TextField } from '@mui/material';

const NOTE_SAVE_PAUSE_MS = 500;

function NoteField({ note, onCommit }) {
  const [value, setValue] = useState(note);
  useEffect(() => {
    if (value === note) return undefined;
    const timer = setTimeout(() => onCommit(value), NOTE_SAVE_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [value, note, onCommit]);
  return (
    <TextField
      fullWidth
      multiline
      minRows={2}
      value={value}
      onChange={(ev) => setValue(ev.target.value)}
      onBlur={() => { if (value !== note) onCommit(value); }}
      placeholder="Note (optional)"
      inputProps={{ 'aria-label': 'Note', style: { fontSize: 16 } }}
      sx={{ mt: 2 }}
    />
  );
}

export default memo(NoteField);
