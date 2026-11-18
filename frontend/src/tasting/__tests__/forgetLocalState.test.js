import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../api', () => ({ default: { get: vi.fn() } }));
import api from '../../api';
import tastingApi from '../tastingApi';
import { forgetLocalState } from '../forgetLocalState';
import { loadDraft, saveDraft } from '../log/draftStorage';
import { initialDraft } from '../log/flightDraft';

beforeEach(() => { localStorage.clear(); api.get.mockReset(); });

describe('forgetLocalState', () => {
  it('drops the cached coffee list so the next person refetches their own marks', async () => {
    api.get.mockResolvedValue({ data: [{ id: 1, tasted_by_me: true }] });
    await tastingApi.getCoffees();
    await tastingApi.getCoffees();
    expect(api.get).toHaveBeenCalledTimes(1);
    forgetLocalState();
    await tastingApi.getCoffees();
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('drops saved flight drafts', () => {
    saveDraft('u-1', { ...initialDraft(), screen: 'entry', picked: [{ id: 1, name: 'Guji' }] });
    expect(loadDraft('u-1')).not.toBeNull();
    forgetLocalState();
    expect(loadDraft('u-1')).toBeNull();
  });
});
