import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const { authState } = vi.hoisted(() => ({ authState: { current: null } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => authState.current }));

const { useTastingIdentity } = await import('../useTastingIdentity');

const identity = (auth) => {
  authState.current = { user: null, group: { timezone: 'UTC' }, ...auth };
  return renderHook(() => useTastingIdentity()).result.current;
};

describe('useTastingIdentity', () => {
  it.each([
    ['member', { isPerson: true, canManage: false, canCloseAny: false, isSharedDevice: false, canKiosk: false }],
    ['editor', { isPerson: true, canManage: true, canCloseAny: false, isSharedDevice: false, canKiosk: false }],
    ['admin', { isPerson: true, canManage: true, canCloseAny: true, isSharedDevice: false, canKiosk: false }],
  ])('a signed-in %s', (role, expected) => {
    expect(identity({ kind: 'user', role })).toMatchObject(expected);
  });

  it('a shared device is not a person and manages nothing', () => {
    expect(identity({ kind: 'device', role: null })).toMatchObject({
      isPerson: false, canManage: false, canCloseAny: false, isSharedDevice: true, canKiosk: true,
    });
  });

  it('a signed-out visitor is nothing', () => {
    expect(identity({ kind: null, role: null })).toMatchObject({
      isPerson: false, canManage: false, canCloseAny: false, isSharedDevice: false,
    });
  });

  it('carries the group time zone', () => {
    expect(identity({ kind: 'user', role: 'member', group: { timezone: 'America/Chicago' } }).timezone).toBe('America/Chicago');
  });
});
