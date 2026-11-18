/**
 * ModuleTabs — Segmented control for in-module tab switching.
 *
 * Visually distinct from the top navigation tabs (underline style).
 * Uses a pill/segmented-control look: grey background, white active tab
 * with subtle shadow, rounded corners. Compact height.
 *
 * Props:
 *   value       — current tab value
 *   onChange     — (event, newValue) => void
 *   tabs        — [{ value, label, icon?, disabled?, path?, to? }]
 *   endAction   — optional ReactNode rendered on the right (e.g. settings button)
 *   basePath    — route mode: tabs carry a `path` relative to this base
 *
 * Without `basePath`, tabs that carry an absolute `to` switch on route mode
 * across different bases (e.g. /recipe-book and /menu/items in one bar).
 * `to` is a bare absolute path: no trailing slash, query string or hash.
 */

import { Tabs, Tab, Box } from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';

// Segment-boundary prefix match, so /recipes never matches a tab at /recipe-book.
const ownsPath = (to, pathname) => pathname === to || pathname.startsWith(`${to}/`);

const ModuleTabs = ({ value, onChange, tabs, endAction, sx, ariaLabel, basePath }) => {
  const navigate = useNavigate();
  const location = useLocation();

  // Route-based mode: derive active value from URL, navigate on click
  let activeValue = value;
  let handleChange = onChange;

  if (basePath != null) {
    const subPath = location.pathname.replace(basePath, '').replace(/^\//, '').split('/')[0] || '';
    activeValue = tabs.find(t => t.path === subPath)?.value ?? tabs[0]?.value;
    handleChange = (event, newValue) => {
      const tab = tabs.find(t => t.value === newValue);
      if (tab?.path != null) {
        navigate(`${basePath}/${tab.path}`);
      }
    };
  } else if (tabs.some((t) => t.to)) {
    // Longest match wins; no match selects nothing rather than the first tab.
    const owner = tabs
      .filter((t) => t.to && ownsPath(t.to, location.pathname))
      .sort((a, b) => b.to.length - a.to.length)[0];
    activeValue = owner?.value ?? false;
    handleChange = (event, newValue) => {
      const tab = tabs.find((t) => t.value === newValue);
      if (tab?.to) navigate(tab.to);
    };
  }

  return (
  <Box
    sx={{
      display: 'flex',
      alignItems: 'center',
      gap: 1,
      mb: 2,
      ...sx,
    }}
  >
    <Tabs
      value={activeValue}
      onChange={handleChange}
      variant="scrollable"
      scrollButtons="auto"
      allowScrollButtonsMobile
      aria-label={ariaLabel || 'Module tabs'}
      TabIndicatorProps={{ sx: { display: 'none' } }}
      sx={{
        minHeight: 40,
        bgcolor: (t) => t.palette.mode === 'dark' ? 'grey.800' : 'grey.100',
        borderRadius: 2,
        p: 0.5,
        flex: endAction ? 1 : undefined,
        '& .MuiTab-root': {
          minHeight: 32,
          minWidth: 'auto',
          textTransform: 'none',
          fontSize: '0.85rem',
          fontWeight: 500,
          borderRadius: 1.5,
          px: 2,
          py: 0.5,
          color: 'text.secondary',
          transition: 'all 0.15s ease',
          '&.Mui-selected': {
            color: 'text.primary',
            bgcolor: 'background.paper',
            boxShadow: (t) => t.palette.mode === 'dark'
                  ? '0 1px 3px rgba(0,0,0,0.4)'
                  : '0 1px 3px rgba(0,0,0,0.12)',
          },
          '&.Mui-disabled': {
            opacity: 0.4,
          },
        },
        // Hide the scroll buttons' ripple background to keep it clean
        '& .MuiTabScrollButton-root': {
          width: 28,
        },
      }}
    >
      {tabs.map((tab) => (
        <Tab
          key={tab.value}
          value={tab.value}
          label={tab.label}
          icon={tab.icon}
          iconPosition="start"
          disabled={tab.disabled}
        />
      ))}
    </Tabs>
    {endAction}
  </Box>
  );
};

export default ModuleTabs;
