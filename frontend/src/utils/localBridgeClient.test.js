import { describe, expect, test, vi, beforeEach } from 'vitest';
import { checkBridgeStatus, LocalBridgeClient } from './localBridgeClient';

describe('localBridgeClient', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  test('reports bridge not running when WebSocket cannot connect', async () => {
    vi.stubGlobal('WebSocket', vi.fn().mockImplementation(() => {
      const mockWs = {
        close: vi.fn(),
      };
      setTimeout(() => {
        if (mockWs.onerror) mockWs.onerror(new Error('Connection refused'));
      }, 10);
      return mockWs;
    }));

    const status = await checkBridgeStatus(100);
    expect(status.running).toBe(false);
  });

  test('reports bridge running when WebSocket opens', async () => {
    vi.stubGlobal('WebSocket', vi.fn().mockImplementation(() => {
      const mockWs = {
        close: vi.fn(),
        send: vi.fn(),
      };
      setTimeout(() => {
        if (mockWs.onopen) mockWs.onopen();
        if (mockWs.onmessage) {
          mockWs.onmessage({ data: JSON.stringify({ action: 'ready', version: '0.3.2', build_type: 'binary' }) });
        }
      }, 10);
      return mockWs;
    }));

    const status = await checkBridgeStatus(100);
    expect(status.running).toBe(true);
    expect(status.helperInfo?.version).toBe('0.3.2');
    expect(status.helperInfo?.buildType).toBe('binary');
  });

  test('LocalBridgeClient sends print command and handles success response', async () => {
    let messageListener = null;
    let sentData = null;

    vi.stubGlobal('WebSocket', vi.fn().mockImplementation(() => {
      const mockWs = {
        readyState: 1, // OPEN
        send: vi.fn((msg) => { sentData = JSON.parse(msg); }),
        close: vi.fn(),
      };
      setTimeout(() => {
        if (mockWs.onopen) mockWs.onopen();
      }, 10);
      // capture onmessage setter
      Object.defineProperty(mockWs, 'onmessage', {
        set(fn) { messageListener = fn; },
        get() { return messageListener; }
      });
      return mockWs;
    }));

    const client = new LocalBridgeClient();
    await client.connect();
    expect(client.isConnected).toBe(true);

    const printPromise = client.printImages({
      mac_address: 'AA:BB:CC:DD:EE:FF',
      images: ['data:image/png;base64,sample'],
    });

    expect(sentData.action).toBe('print');
    expect(sentData.mac_address).toBe('AA:BB:CC:DD:EE:FF');

    // Simulate helper response
    messageListener({ data: JSON.stringify({ action: 'print_result', success: true }) });

    const result = await printPromise;
    expect(result.success).toBe(true);

    client.disconnect();
    expect(client.isConnected).toBe(false);
  });

  test('LocalBridgeClient getLogs and clearLogs interaction', async () => {
    let messageListener = null;
    let sentData = null;

    vi.stubGlobal('WebSocket', vi.fn().mockImplementation(() => {
      const mockWs = {
        readyState: 1,
        send: vi.fn((msg) => { sentData = JSON.parse(msg); }),
        close: vi.fn(),
      };
      setTimeout(() => {
        if (mockWs.onopen) mockWs.onopen();
      }, 10);
      Object.defineProperty(mockWs, 'onmessage', {
        set(fn) { messageListener = fn; },
        get() { return messageListener; }
      });
      return mockWs;
    }));

    const client = new LocalBridgeClient();
    await client.connect();

    const logsPromise = client.getLogs();
    expect(sentData.action).toBe('get_logs');
    messageListener({ data: JSON.stringify({ action: 'logs_result', logs: ['Line 1', 'Line 2'], log_file: '/tmp/helper.log' }) });
    const logRes = await logsPromise;
    expect(logRes.logs).toHaveLength(2);
    expect(logRes.logFile).toBe('/tmp/helper.log');

    const clearPromise = client.clearLogs();
    expect(sentData.action).toBe('clear_logs');
    messageListener({ data: JSON.stringify({ action: 'logs_cleared' }) });
    const clearRes = await clearPromise;
    expect(clearRes).toBe(true);

    const updatePromise = client.triggerSelfUpdate('http://test-server:8000');
    expect(sentData.action).toBe('self_update');
    expect(sentData.server_url).toBe('http://test-server:8000');
    messageListener({ data: JSON.stringify({ action: 'self_update_result', success: true, message: 'Updated' }) });
    const updateRes = await updatePromise;
    expect(updateRes).toBe('Updated');

    client.disconnect();
  });
});
