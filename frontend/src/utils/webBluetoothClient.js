/**
 * Web Bluetooth Client for CatLabel
 * Enables users to connect directly from their browser on their laptop, tablet, or phone
 * to Bluetooth label printers without routing through the backend server.
 */

import {
  NiimbotBluetoothClient,
  ImageEncoder,
  Utils,
} from '@mmote/niimbluelib';

/**
 * Check if the current browser and context support Web Bluetooth
 */
export function isWebBluetoothSupported() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  return Boolean(navigator.bluetooth && typeof navigator.bluetooth.requestDevice === 'function');
}

/**
 * Get human-friendly diagnostics if Web Bluetooth is unavailable
 */
export function getWebBluetoothSupportStatus() {
  if (typeof window === 'undefined') {
    return { supported: false, reason: 'Environment does not support Web APIs' };
  }

  if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return {
      supported: false,
      reason: 'Web Bluetooth requires a secure HTTPS connection. Please access the server over HTTPS.'
    };
  }

  if (!navigator.bluetooth) {
    return {
      supported: false,
      reason: 'Your browser does not support Web Bluetooth. Please use Google Chrome, Microsoft Edge, Opera, or Bluefy (on iOS).'
    };
  }

  return { supported: true, reason: null };
}

/**
 * Convert a data URL image to an HTMLCanvasElement
 */
async function dataUrlToCanvas(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not acquire 2D canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve(canvas);
    };
    img.onerror = (err) => reject(err);
    img.src = dataUrl;
  });
}

/**
 * Connect to a Niimbot printer via Web Bluetooth
 */
export async function connectWebBluetoothPrinter() {
  const status = getWebBluetoothSupportStatus();
  if (!status.supported) {
    throw new Error(status.reason);
  }

  const client = new NiimbotBluetoothClient();

  const connInfo = await client.connect();
  const deviceName = connInfo.deviceName || 'Niimbot Printer';

  let printerInfo = null;
  let modelMeta = null;

  try {
    printerInfo = await client.fetchPrinterInfo();
  } catch (err) {
    console.warn('Could not fetch printer info packet:', err);
  }

  try {
    modelMeta = client.getModelMetadata();
  } catch (err) {
    console.warn('Could not fetch model metadata:', err);
  }

  try {
    client.startHeartbeat();
  } catch (err) {
    console.warn('Could not start heartbeat:', err);
  }

  const modelId = modelMeta?.model || 'niimbot';
  const dpi = modelMeta?.dpi || 203;

  const rawBattery = printerInfo?.batteryPercents ?? printerInfo?.batteryLevel ?? null;
  const normalizedBattery = typeof rawBattery === 'number' ? (rawBattery <= 4 ? rawBattery * 25 : rawBattery) : null;

  return {
    client,
    deviceName,
    address: `web-ble-${deviceName.toLowerCase().replace(/\s+/g, '-')}`,
    model_id: modelId,
    vendor: 'niimbluelib',
    dpi,
    transport: 'web_bluetooth',
    battery_level: normalizedBattery,
    printerInfo,
    modelMeta,
  };
}

/**
 * Disconnect a Web Bluetooth printer session
 */
export async function disconnectWebBluetoothPrinter(client) {
  if (!client) return;
  try {
    if (typeof client.stopHeartbeat === 'function') {
      client.stopHeartbeat();
    }
  } catch (e) {
    console.warn('Error stopping heartbeat:', e);
  }

  try {
    if (typeof client.disconnect === 'function') {
      await client.disconnect();
    }
  } catch (e) {
    console.warn('Error disconnecting Web Bluetooth client:', e);
  }
}

/**
 * Print an array of image data URLs directly via Web Bluetooth
 */
export async function printViaWebBluetooth(client, images, options = {}) {
  if (!client || !client.isConnected()) {
    throw new Error('Web Bluetooth printer is not connected.');
  }

  const copies = Math.max(1, options.copies || 1);
  const isRotated = Boolean(options.isRotated);
  const density = typeof options.density === 'number' ? options.density : 3;
  const onProgress = options.onProgress || (() => {});

  const taskType = client.getPrintTaskType() || 'D110';
  const totalPages = images.length * copies;

  client.stopHeartbeat();

  try {
    for (let imgIdx = 0; imgIdx < images.length; imgIdx++) {
      const dataUrl = images[imgIdx];
      const canvas = await dataUrlToCanvas(dataUrl);

      // NiimBlueLib takes 'left' for rotated (90 deg clockwise) or 'top' for upright
      // If canvas is landscape (width > height), orientation must be 'left' so cols matches the physical printhead width
      const isLandscape = canvas.width > canvas.height;
      const direction = (isRotated || isLandscape) ? 'left' : 'top';
      const encoded = ImageEncoder.encodeCanvas(canvas, 'black', direction);

      const printTask = client.protocol.newPrintTask(taskType, {
        totalPages: copies,
        density,
        speed: 0,
        labelType: 1, // standard label
        statusPollIntervalMs: 100,
        statusTimeoutMs: 8000,
      });

      await printTask.printInit();

      const progressListener = (event) => {
        if (event && typeof event.pagePrintProgress === 'number') {
          const overall = ((imgIdx * copies + (event.page || 0)) / totalPages) * 100;
          onProgress(Math.min(100, Math.round(overall)));
        }
      };

      client.on('printprogress', progressListener);

      try {
        await printTask.printPage(encoded, copies);
        await printTask.waitForFinished();
      } finally {
        client.off('printprogress', progressListener);
      }

      if (imgIdx < images.length - 1) {
        await Utils.sleep(150);
      }
    }
  } finally {
    try {
      if (client.protocol && typeof client.protocol.printEnd === 'function') {
        await client.protocol.printEnd();
      }
    } catch (err) {
      console.warn('Error ending print session:', err);
    }
    client.startHeartbeat();
  }
}

export const KNOWN_NIIMBOT_BARCODES = {
  '01222281': { width_mm: 40, height_mm: 12, is_rotated: true, nominal_labels: 160, preset_name: 'Pre-cut: Niimbot 40x12mm' },
  '01240': { width_mm: 40, height_mm: 12, is_rotated: true, nominal_labels: 160, preset_name: 'Pre-cut: Niimbot 40x12mm' },
  '01230': { width_mm: 30, height_mm: 12, is_rotated: true, nominal_labels: 210, preset_name: 'Pre-cut: Niimbot 30x12mm' },
  '01222': { width_mm: 22, height_mm: 12, is_rotated: true, nominal_labels: 260, preset_name: 'Pre-cut: Niimbot 22x12mm' },
  '01530': { width_mm: 30, height_mm: 15, is_rotated: true, nominal_labels: 210, preset_name: 'Pre-cut: Niimbot 30x15mm' },
  '01450': { width_mm: 50, height_mm: 14, is_rotated: true, nominal_labels: 130, preset_name: 'Pre-cut: Niimbot 50x14mm' },
  '01275': { width_mm: 75, height_mm: 12, is_rotated: true, nominal_labels: 80, preset_name: 'Pre-cut: Niimbot 75x12mm' },
};

export function decodeNiimbotBarcode(barcode) {
  const clean = String(barcode || '').trim();
  if (KNOWN_NIIMBOT_BARCODES[clean]) {
    return { ...KNOWN_NIIMBOT_BARCODES[clean] };
  }
  for (const [prefix, info] of Object.entries(KNOWN_NIIMBOT_BARCODES)) {
    if (clean.startsWith(prefix)) {
      return { ...info };
    }
  }

  let width_mm = 40;
  let height_mm = 12;
  const match = clean.match(/^0?(\d{2})(\d{2})/);
  if (match) {
    const val1 = parseInt(match[1], 10);
    const val2 = parseInt(match[2], 10);
    if (val1 >= 10 && val1 <= 100 && val2 >= 10 && val2 <= 150) {
      width_mm = Math.max(val1, val2);
      height_mm = Math.min(val1, val2);
    }
  }
  return {
    width_mm,
    height_mm,
    is_rotated: true,
    preset_name: `Pre-cut: Niimbot ${width_mm}x${height_mm}mm`,
  };
}

/**
 * Read the paper roll's RFID tag from a connected Web Bluetooth Niimbot printer
 */
export async function getWebBluetoothRfidInfo(client) {
  if (!client || !client.isConnected()) {
    throw new Error('Web Bluetooth printer is not connected.');
  }

  try {
    const info = await client.abstraction.rfidInfo();
    if (!info || !info.tagPresent) {
      return {
        success: true,
        tag_present: false,
        message: 'No RFID tag detected in current roll',
      };
    }

    const dim = decodeNiimbotBarcode(info.barCode);
    const usedLabels = info.usedPaper >= 0 ? info.usedPaper : 0;
    const totalLabels = dim.nominal_labels || (info.allPaper > 0 ? info.allPaper : 0);
    const remainingLabels = Math.max(0, Math.min(totalLabels, totalLabels - usedLabels));

    return {
      success: true,
      tag_present: true,
      barcode: info.barCode,
      serial: info.serialNumber,
      uuid: info.uuid,
      total_labels: totalLabels,
      used_labels: usedLabels,
      remaining_labels: remainingLabels,
      width_mm: dim.width_mm,
      height_mm: dim.height_mm,
      is_rotated: dim.is_rotated,
      preset_name: dim.preset_name,
    };
  } catch (err) {
    console.warn('Failed to query RFID via Web Bluetooth:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Query the current battery charge level (percentage 0..100) from a connected Web Bluetooth printer
 */
export async function getWebBluetoothBatteryLevel(client) {
  if (!client || (typeof client.isConnected === 'function' && !client.isConnected())) {
    return null;
  }

  try {
    if (client.protocol && typeof client.protocol.getBatteryChargeLevel === 'function') {
      const charge = await client.protocol.getBatteryChargeLevel();
      if (typeof charge === 'number' && charge >= 0) {
        return charge <= 4 ? charge * 25 : Math.min(100, charge);
      }
    }
  } catch (err) {
    console.warn('Could not query battery charge level via protocol:', err);
  }

  const p = client.info?.batteryPercents ?? client.info?.batteryLevel;
  if (typeof p === 'number' && p >= 0) {
    return p <= 4 ? p * 25 : Math.min(100, p);
  }

  return null;
}
