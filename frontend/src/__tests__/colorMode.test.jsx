/**
 * The appearance switch: Automatic follows the device, Light and Dark pin it,
 * and the choice is remembered on this device only. Storage that throws
 * (private mode, blocked site data) must never break the app.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useTheme } from '@mui/material/styles';
import { ColorModeProvider, COLOR_MODE_KEY } from '../colorMode';
import ColorModeButton from '../ColorModeButton';

function mockSystemDark(dark) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: query.includes('dark') ? dark : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function Probe() {
  return <span data-testid="mode">{useTheme().palette.mode}</span>;
}

const renderApp = () => render(
  <ColorModeProvider>
    <ColorModeButton />
    <Probe />
  </ColorModeProvider>,
);

const choose = (label) => {
  fireEvent.click(screen.getByRole('button', { name: /appearance/i }));
  fireEvent.click(screen.getByRole('menuitem', { name: label }));
};

beforeEach(() => { localStorage.clear(); mockSystemDark(false); });
afterEach(() => { vi.restoreAllMocks(); });

describe('appearance switch', () => {
  it('follows the device by default', () => {
    mockSystemDark(true);
    renderApp();
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
  });

  it('pins dark when chosen and remembers it', () => {
    renderApp();
    expect(screen.getByTestId('mode')).toHaveTextContent('light');
    choose('Dark');
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
    expect(localStorage.getItem(COLOR_MODE_KEY)).toBe('dark');
  });

  it('a remembered Light wins over a dark device', () => {
    localStorage.setItem(COLOR_MODE_KEY, 'light');
    mockSystemDark(true);
    renderApp();
    expect(screen.getByTestId('mode')).toHaveTextContent('light');
  });

  it('going back to Automatic follows the device again and forgets the pin', () => {
    localStorage.setItem(COLOR_MODE_KEY, 'light');
    mockSystemDark(true);
    renderApp();
    choose('Automatic');
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
    expect(localStorage.getItem(COLOR_MODE_KEY)).toBeNull();
  });

  it('ignores a junk stored value', () => {
    localStorage.setItem(COLOR_MODE_KEY, 'purple');
    renderApp();
    expect(screen.getByTestId('mode')).toHaveTextContent('light');
  });

  it('still switches when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderApp();
    choose('Dark');
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
  });

  it('marks the current choice in the menu', () => {
    localStorage.setItem(COLOR_MODE_KEY, 'dark');
    renderApp();
    fireEvent.click(screen.getByRole('button', { name: /appearance/i }));
    expect(screen.getByRole('menuitem', { name: 'Dark' })).toHaveClass('Mui-selected');
    expect(screen.getByRole('menuitem', { name: 'Automatic' })).not.toHaveClass('Mui-selected');
  });
});
