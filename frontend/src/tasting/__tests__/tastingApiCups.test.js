import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api', () => ({ default: { get: vi.fn(), put: vi.fn() } }));
import api from '../../api';
import { tastingApi } from '../tastingApi';

describe('tastingApi.putFlightCups', () => {
  beforeEach(() => {
    api.get.mockReset().mockResolvedValue({ data: { coffees: [] } });
    api.put.mockReset().mockResolvedValue({ data: { cups: [] } });
    tastingApi.invalidateCoffees();
  });

  it('sends the wire names and resolves to the body', async () => {
    const body = await tastingApi.putFlightCups(7, { cups: [{ coffee_id: 1 }], newLabels: ['H3'] });
    expect(api.put).toHaveBeenCalledWith('/tasting/flights/7/cups', { cups: [{ coffee_id: 1 }], new_labels: ['H3'] });
    expect(body).toEqual({ cups: [] });
  });

  it('sends the shared device id only when given', async () => {
    await tastingApi.putFlightCups(7, { cups: [{ coffee_id: 1 }], memberId: 12 });
    expect(api.put.mock.calls[0][1].member_id).toBe(12);
  });

  it('drops the cached coffee list after a rename, not after a reorder', async () => {
    await tastingApi.getCoffees();
    await tastingApi.putFlightCups(7, { cups: [{ coffee_id: 1 }] });
    await tastingApi.getCoffees();
    expect(api.get).toHaveBeenCalledTimes(1);
    await tastingApi.putFlightCups(7, { cups: [{ coffee_id: 1, name: 'New' }] });
    await tastingApi.getCoffees();
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});
