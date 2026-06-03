/**
 * @jest-environment jest-environment-jsdom
 */
/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '../theme/ThemeContext';
import { useTheme } from '../theme/useTheme';
import { ThemeToggle } from '../theme/ThemeToggle';

// ─── matchMedia mock (defined once, handler swapped per test) ────────────────

type MQHandler = (e: Partial<MediaQueryListEvent>) => void;
let _mqChangeHandler: MQHandler | null = null;
let _mqMatches = false;

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    get matches() { return query === '(prefers-color-scheme: dark)' ? _mqMatches : false; },
    media: query,
    onchange: null,
    addEventListener: (_: string, fn: MQHandler) => {
      if (query === '(prefers-color-scheme: dark)') _mqChangeHandler = fn;
    },
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }),
});

// ─── helpers ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'stellar-theme';

function TestConsumer() {
  const { theme, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={toggleTheme}>toggle</button>
    </div>
  );
}

function renderWithProvider(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  _mqMatches = false;
  _mqChangeHandler = null;
});

// ─── default ─────────────────────────────────────────────────────────────────

describe('ThemeContext default value', () => {
  it('provides light theme by default', () => {
    renderWithProvider(<TestConsumer />);
    expect(screen.getByTestId('theme').textContent).toBe('light');
  });
});

// ─── theme switching ──────────────────────────────────────────────────────────

describe('theme switching', () => {
  it('toggles from light to dark', async () => {
    const user = userEvent.setup();
    renderWithProvider(<TestConsumer />);
    await user.click(screen.getByRole('button', { name: 'toggle' }));
    expect(screen.getByTestId('theme').textContent).toBe('dark');
  });

  it('toggles back from dark to light', async () => {
    const user = userEvent.setup();
    renderWithProvider(<TestConsumer />);
    await user.click(screen.getByRole('button', { name: 'toggle' }));
    await user.click(screen.getByRole('button', { name: 'toggle' }));
    expect(screen.getByTestId('theme').textContent).toBe('light');
  });

  it('adds dark class to <html> when dark', async () => {
    const user = userEvent.setup();
    renderWithProvider(<TestConsumer />);
    await user.click(screen.getByRole('button', { name: 'toggle' }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('removes dark class from <html> when switching to light', async () => {
    const user = userEvent.setup();
    renderWithProvider(<TestConsumer />);
    await user.click(screen.getByRole('button', { name: 'toggle' })); // → dark
    await user.click(screen.getByRole('button', { name: 'toggle' })); // → light
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});

// ─── persistence ─────────────────────────────────────────────────────────────

describe('localStorage persistence', () => {
  it('persists dark preference', async () => {
    const user = userEvent.setup();
    renderWithProvider(<TestConsumer />);
    await user.click(screen.getByRole('button', { name: 'toggle' }));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
  });

  it('persists light preference', async () => {
    const user = userEvent.setup();
    renderWithProvider(<TestConsumer />);
    await user.click(screen.getByRole('button', { name: 'toggle' }));
    await user.click(screen.getByRole('button', { name: 'toggle' }));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
  });

  it('reads stored dark preference on mount', () => {
    localStorage.setItem(STORAGE_KEY, 'dark');
    renderWithProvider(<TestConsumer />);
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('stored light preference overrides dark system preference', () => {
    localStorage.setItem(STORAGE_KEY, 'light');
    _mqMatches = true; // system prefers dark
    renderWithProvider(<TestConsumer />);
    expect(screen.getByTestId('theme').textContent).toBe('light');
  });
});

// ─── system preference fallback ──────────────────────────────────────────────

describe('system preference fallback', () => {
  it('uses dark when system prefers dark and no stored pref', () => {
    _mqMatches = true;
    renderWithProvider(<TestConsumer />);
    expect(screen.getByTestId('theme').textContent).toBe('dark');
  });

  it('uses light when system prefers light and no stored pref', () => {
    renderWithProvider(<TestConsumer />);
    expect(screen.getByTestId('theme').textContent).toBe('light');
  });

  it('responds to OS preference change when no stored pref', () => {
    renderWithProvider(<TestConsumer />);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(_mqChangeHandler).not.toBeNull();
    act(() => { _mqChangeHandler!({ matches: true } as MediaQueryListEvent); });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(screen.getByTestId('theme').textContent).toBe('dark');
  });

  it('ignores OS preference change when stored pref exists', () => {
    localStorage.setItem(STORAGE_KEY, 'light');
    renderWithProvider(<TestConsumer />);
    act(() => { _mqChangeHandler?.({ matches: true } as MediaQueryListEvent); });
    expect(screen.getByTestId('theme').textContent).toBe('light');
  });
});

// ─── ThemeToggle ──────────────────────────────────────────────────────────────

describe('ThemeToggle', () => {
  it('has accessible label for light mode', () => {
    renderWithProvider(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
  });

  it('has accessible label for dark mode', () => {
    localStorage.setItem(STORAGE_KEY, 'dark');
    renderWithProvider(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
  });

  it('has aria-pressed=false in light mode', () => {
    renderWithProvider(<ThemeToggle />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
  });

  it('has aria-pressed=true in dark mode', () => {
    localStorage.setItem(STORAGE_KEY, 'dark');
    renderWithProvider(<ThemeToggle />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('toggles theme on click', async () => {
    const user = userEvent.setup();
    renderWithProvider(<><ThemeToggle /><TestConsumer /></>);
    await user.click(screen.getByRole('button', { name: 'Switch to dark mode' }));
    expect(screen.getByTestId('theme').textContent).toBe('dark');
  });
});

// ─── rendering in both themes ─────────────────────────────────────────────────

describe('rendering in both themes', () => {
  it('renders children in light mode without dark class', () => {
    renderWithProvider(<div data-testid="child">hello</div>);
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('renders children in dark mode with dark class', () => {
    localStorage.setItem(STORAGE_KEY, 'dark');
    renderWithProvider(<div data-testid="child">hello</div>);
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('applies dark class instantly on mount (no flicker)', () => {
    localStorage.setItem(STORAGE_KEY, 'dark');
    renderWithProvider(<TestConsumer />);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
