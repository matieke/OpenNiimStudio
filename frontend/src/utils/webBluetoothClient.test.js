import { describe, expect, test, vi, beforeEach } from 'vitest';
import {
  isWebBluetoothSupported,
  getWebBluetoothSupportStatus,
} from './webBluetoothClient';

describe('webBluetoothClient', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  test('detects when Web Bluetooth is not available in test environment', () => {
    expect(isWebBluetoothSupported()).toBe(false);
    const status = getWebBluetoothSupportStatus();
    expect(status.supported).toBe(false);
    expect(status.reason).toBeDefined();
  });

  test('detects Web Bluetooth when navigator.bluetooth is present and context is secure', () => {
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', {
      bluetooth: {
        requestDevice: vi.fn(),
      },
    });

    expect(isWebBluetoothSupported()).toBe(true);
    const status = getWebBluetoothSupportStatus();
    expect(status.supported).toBe(true);
    expect(status.reason).toBeNull();
  });

  test('decodes Niimbot barcodes properly into dimensions', async () => {
    const { decodeNiimbotBarcode } = await import('./webBluetoothClient');
    // User's exact roll barcode:
    const roll12x40 = decodeNiimbotBarcode('01222281');
    expect(roll12x40.width_mm).toBe(40);
    expect(roll12x40.height_mm).toBe(12);
    expect(roll12x40.is_rotated).toBe(true);

    const roll12x30 = decodeNiimbotBarcode('01230000');
    expect(roll12x30.width_mm).toBe(30);
    expect(roll12x30.height_mm).toBe(12);

    const roll12x22 = decodeNiimbotBarcode('01222000');
    expect(roll12x22.width_mm).toBe(22);
    expect(roll12x22.height_mm).toBe(12);
  });

  test('reads RFID info via getWebBluetoothRfidInfo', async () => {
    const { getWebBluetoothRfidInfo } = await import('./webBluetoothClient');
    const mockClient = {
      isConnected: () => true,
      protocol: {
        rfidInfo: vi.fn().mockResolvedValue({
          tagPresent: true,
          barCode: '01222281',
          serialNumber: 'PZ1H903305002150',
          uuid: '881d3ba569a50000',
          allPaper: 186,
          usedPaper: 18,
          consumablesType: 1,
        }),
      },
    };

    const res = await getWebBluetoothRfidInfo(mockClient);
    expect(res.success).toBe(true);
    expect(res.tag_present).toBe(true);
    expect(res.barcode).toBe('01222281');
    expect(res.width_mm).toBe(40);
    expect(res.height_mm).toBe(12);
    expect(res.total_labels).toBe(160);
    expect(res.used_labels).toBe(18);
    expect(res.remaining_labels).toBe(142);
  });

  test('handles third-party non-RFID rolls gracefully without error', async () => {
    const { getWebBluetoothRfidInfo } = await import('./webBluetoothClient');
    const mockClient = {
      isConnected: () => true,
      protocol: {
        rfidInfo: vi.fn().mockResolvedValue({
          tagPresent: false,
        }),
      },
    };

    const res = await getWebBluetoothRfidInfo(mockClient);
    expect(res.success).toBe(true);
    expect(res.tag_present).toBe(false);
    expect(res.message).toContain('No RFID tag');
  });

  test('queries battery charge level via protocol and normalizes 0..4 or 0..100', async () => {
    const { getWebBluetoothBatteryLevel } = await import('./webBluetoothClient');
    const mockClientBars = {
      isConnected: () => true,
      protocol: {
        getBatteryChargeLevel: vi.fn().mockResolvedValue(3),
      },
    };

    const batBars = await getWebBluetoothBatteryLevel(mockClientBars);
    expect(batBars).toBe(75);

    const mockClientPercent = {
      isConnected: () => true,
      protocol: {
        getBatteryChargeLevel: vi.fn().mockResolvedValue(88),
      },
    };

    const batPct = await getWebBluetoothBatteryLevel(mockClientPercent);
    expect(batPct).toBe(88);
  });
});
