/**
 * Flavors — the picked tray, the breadcrumb, the wheel and the Search list.
 *
 * The tray groups picked terms by family (tap a family name to jump the wheel
 * there), shows the auto sentence in italics (display only — never saved
 * to `note`), and removes a term with ×. Search is the accessible fast path:
 * a plain filtered list of every lexicon term.
 */
import { memo, useMemo, useState } from 'react';
import {
  Box, Button, ButtonBase, Dialog, DialogTitle, DialogContent, IconButton, InputAdornment,
  List, ListItemButton, ListItemText, TextField, Typography, Divider,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import HomeIcon from '@mui/icons-material/Home';
import CloseIcon from '@mui/icons-material/Close';
import FlavorWheel from './FlavorWheel';
import TermChip from './TermChip';
import Eyebrow from '../bits/Eyebrow';
import { groupTags, describe, nodeAt, ALL_TERMS, MAX_TAGS_PER_CUP, ROOT_KEYS } from '../lexicon';

function FlavorPicker({ coffeeLabel, tags, onCycle, onRemove, path, onPath }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const count = Object.keys(tags).length;
  const groups = useMemo(() => groupTags(tags), [tags]);
  const sentence = useMemo(() => describe(tags), [tags]);
  const { node, children } = nodeAt(path);
  const crumbs = [{ label: 'All flavors', path: [] }, ...path.map((l, i) => ({ label: l, path: path.slice(0, i + 1) }))];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography sx={{ fontSize: 15, fontWeight: 600 }}>
          Flavors
          <Typography component="span" sx={{ ml: 1, fontSize: 13, fontWeight: 500, color: 'text.secondary' }}>{count} of {MAX_TAGS_PER_CUP}</Typography>
        </Typography>
        <Button variant="outlined" size="small" startIcon={<SearchIcon />} onClick={() => setSearchOpen(true)} sx={{ minHeight: 36 }}>Search</Button>
      </Box>

      {count > 0 && (
        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'background.default', px: 1.5, py: 1.25 }} data-testid="picked-tray">
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Eyebrow sx={{ display: 'inline' }}>Picked · {coffeeLabel}</Eyebrow>
            <Typography variant="caption" color="text.secondary">{count} of {MAX_TAGS_PER_CUP} — tap to remove</Typography>
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mt: 1 }}>
            {groups.map((g) => (
              <Box key={g.familyLabel} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <ButtonBase onClick={() => onPath([g.familyLabel])} sx={{ gap: 0.75, borderRadius: 1, px: 0.5, minWidth: 72, justifyContent: 'flex-start' }} aria-label={`Open ${g.familyLabel}`}>
                  <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: g.tint, border: '1px solid rgba(0,0,0,.08)' }} />
                  <Typography sx={{ fontSize: 13 }}>{g.familyLabel}</Typography>
                </ButtonBase>
                {g.items.map((it) => (
                  <TermChip key={it.key} term={it.key} strength={it.strength} onRemove={onRemove} />
                ))}
              </Box>
            ))}
          </Box>
          {sentence && (
            <>
              <Divider sx={{ my: 1 }} />
              <Typography sx={{ fontSize: 14, fontStyle: 'italic', color: 'text.primary' }} data-testid="auto-sentence">{sentence}</Typography>
            </>
          )}
        </Box>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 44, gap: 0.5 }}>
        {path.length > 0 && (
          <IconButton size="small" aria-label="Back" onClick={() => onPath(path.slice(0, -1))}><ChevronLeftIcon /></IconButton>
        )}
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5, flex: 1 }} aria-label="Flavor breadcrumb">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <Box key={c.label + i} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <ButtonBase onClick={() => onPath(c.path)} disabled={last} sx={{ borderRadius: 1, px: 0.25 }}>
                  <Typography sx={{ fontFamily: (t) => t.typography.h4.fontFamily, fontSize: 15, fontWeight: last ? 600 : 500, color: last ? 'text.primary' : 'primary.main' }}>{c.label}</Typography>
                </ButtonBase>
                {!last && <Typography sx={{ color: 'text.disabled' }}>›</Typography>}
              </Box>
            );
          })}
        </Box>
        {path.length > 0 && (
          <Button variant="outlined" size="small" startIcon={<HomeIcon />} onClick={() => onPath([])} sx={{ minHeight: 36 }}>All</Button>
        )}
      </Box>

      <FlavorWheel path={path} tags={tags} onPath={onPath} onCycle={onCycle} />
      <Typography sx={{ fontSize: 11, color: count >= MAX_TAGS_PER_CUP ? 'warning.ink' : 'text.secondary', textAlign: 'center' }} aria-live="polite">
        {count >= MAX_TAGS_PER_CUP
          ? `${MAX_TAGS_PER_CUP} of ${MAX_TAGS_PER_CUP} picked — remove one to add another`
          : path.length === 0
            ? `${ROOT_KEYS.length} families — tap one to open it`
            : `${children.length} under ${node?.label} · tap the center to take "${node?.label}" as is`}
      </Typography>

      <TermSearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} tags={tags} onCycle={onCycle} />
    </Box>
  );
}

export default memo(FlavorPicker);

export function TermSearchDialog({ open, onClose, tags, onCycle }) {
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const rows = useMemo(() => (ql
    ? ALL_TERMS.filter((t) => t.label.toLowerCase().includes(ql) || t.path.join(' ').toLowerCase().includes(ql))
    : ALL_TERMS.filter((t) => t.leaf)).slice(0, 80), [ql]);
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 1 }}>
        Find a flavor
        <IconButton aria-label="Close search" onClick={onClose}><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent sx={{ pt: 0 }}>
        <TextField
          fullWidth
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="blueberry, jasmine, cocoa…"
          inputProps={{ 'aria-label': 'Search flavors', style: { fontSize: 16 } }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }}
          sx={{ mb: 1 }}
        />
        <List dense disablePadding>
          {rows.map((t) => {
            const s = tags[t.key] || 0;
            return (
              <ListItemButton key={t.key} onClick={() => onCycle(t.key)} selected={!!s} sx={{ borderRadius: 1, minHeight: 44 }}>
                <ListItemText
                  primary={<span style={{ fontWeight: s ? 600 : 400 }}>{t.label}{s === 3 ? ' !' : s ? ' ✓' : ''}</span>}
                  secondary={t.path.slice(0, -1).join(' › ') || 'family'}
                />
              </ListItemButton>
            );
          })}
          {rows.length === 0 && <Typography color="text.secondary" sx={{ p: 2 }}>Nothing matches.</Typography>}
        </List>
      </DialogContent>
    </Dialog>
  );
}
