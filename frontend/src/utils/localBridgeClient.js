/**
 * Local Print Bridge Client
 * Communicates with the CatLabel print helper daemon running on localhost (ws://127.0.0.1:9123).
 * Used by browsers that do not support Web Bluetooth (Firefox, desktop Safari).
 */

const BRIDGE_WS_URL = 'ws://127.0.0.1:9123';
const PROTOCOL_URL = 'openniim://start';
const LEGACY_PROTOCOL_URL = 'catlabel://start';

/**
 * Probe if the local print helper is currently running on localhost
 * and detect its version and binary/python status
 */
export async function checkBridgeStatus(timeoutMs = 1500) {
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') {
    return { running: false, helperInfo: null };
  }

  return new Promise((resolve) => {
    let resolved = false;
    let ws = null;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try {
          if (ws) ws.close();
        } catch (_e) {}
        resolve({ running: false, helperInfo: null });
      }
    }, timeoutMs);

    try {
      ws = new WebSocket(BRIDGE_WS_URL);

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.action === 'ready' || data.version) {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              try { ws.close(); } catch (_e) {}
              resolve({
                running: true,
                helperInfo: {
                  version: data.version || '0.3.2',
                  buildType: data.build_type || (data.is_frozen ? 'binary' : 'python'),
                  isFrozen: Boolean(data.is_frozen || data.build_type === 'binary'),
                  platform: data.platform || ''
                }
              });
            }
          }
        } catch (_e) {}
      };

      ws.onopen = () => {
        try {
          ws.send(JSON.stringify({ action: 'ping' }));
        } catch (_e) {}

        // If no greeting packet arrives within the probe window, resolve as legacy helper
        const fallbackMs = Math.max(5, Math.min(Math.floor(timeoutMs / 2), 200));
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            try {
              ws.close();
            } catch (_e) {}
            resolve({
              running: true,
              helperInfo: {
                version: 'Legacy',
                buildType: 'legacy_python',
                isFrozen: false
              }
            });
          }
        }, fallbackMs);
      };

      ws.onerror = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve({ running: false, helperInfo: null });
        }
      };
    } catch (_e) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve({ running: false, helperInfo: null });
      }
    }
  });
}

/**
 * Trigger launch of the local helper via OS registered URL protocol (catlabel://start)
 */
export function launchBridgeViaProtocol() {
  if (typeof window === 'undefined') return;

  try {
    const link = document.createElement('a');
    link.href = PROTOCOL_URL;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      try {
        document.body.removeChild(link);
      } catch (_e) {}
    }, 1000);
  } catch (_e) {
    try {
      window.location.assign(PROTOCOL_URL);
    } catch (_err) {}
  }
}

/**
 * Session managing communication with the local helper
 */
export class LocalBridgeClient {
  constructor() {
    this.ws = null;
    this.heartbeatTimer = null;
    this.callbacks = new Map();
    this.isConnected = false;
    this.helperInfo = null;
    this.onInfo = null;
    this.onProgress = null;
    this.onDisconnect = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(BRIDGE_WS_URL);

        this.ws.onopen = () => {
          this.isConnected = true;
          this.startHeartbeat();
          try {
            this.ws.send(JSON.stringify({
              action: 'client_hello',
              server_version: '0.3.2',
              server_url: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8000'
            }));
          } catch (_e) {}
          resolve(true);
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
          } catch (err) {
            console.warn('Malformed message from helper bridge:', err);
          }
        };

        this.ws.onerror = (err) => {
          this.isConnected = false;
          reject(err);
        };

        this.ws.onclose = () => {
          this.isConnected = false;
          this.stopHeartbeat();
          if (this.onDisconnect) {
            this.onDisconnect();
          }
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ action: 'ping' }));
      }
    }, 4000);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  handleMessage(data) {
    const action = data.action;
    if (action === 'ready' || action === 'info_result' || action === 'hello_ack' || (action === 'pong' && data.version)) {
      const ver = data.version || (this.helperInfo?.version || '0.3.2');
      this.helperInfo = {
        version: ver,
        buildType: data.build_type || (data.is_frozen ? 'binary' : (ver ? 'python' : 'legacy_python')),
        isFrozen: Boolean(data.is_frozen || data.build_type === 'binary'),
        platform: data.platform || (this.helperInfo?.platform || ''),
        updateAvailable: Boolean(data.update_available || (ver && ver < '0.3.2')),
        logFile: data.log_file || (this.helperInfo?.logFile || '')
      };
      if (this.onInfo) {
        this.onInfo(this.helperInfo);
      }
    } else if (action === 'logs_result' && this.callbacks.has('logs')) {
      const { resolve } = this.callbacks.get('logs');
      this.callbacks.delete('logs');
      resolve({ logs: data.logs || [], logFile: data.log_file || '' });
    } else if (action === 'logs_cleared' && this.callbacks.has('clear_logs')) {
      const { resolve } = this.callbacks.get('clear_logs');
      this.callbacks.delete('clear_logs');
      resolve(true);
    } else if (action === 'self_update_result' && this.callbacks.has('self_update')) {
      const { resolve, reject } = this.callbacks.get('self_update');
      this.callbacks.delete('self_update');
      if (data.success) {
        resolve(data.message || 'Update completed');
      } else {
        reject(new Error(data.message || 'Self-update failed'));
      }
    } else if (action === 'scan_result' && this.callbacks.has('scan')) {
      const { resolve } = this.callbacks.get('scan');
      this.callbacks.delete('scan');
      resolve(data.devices || []);
    } else if (action === 'print_progress') {
      if (this.onProgress && typeof data.progress === 'number') {
        this.onProgress(data.progress);
      }
    } else if (action === 'rfid_result' && this.callbacks.has('rfid')) {
      const { resolve, reject } = this.callbacks.get('rfid');
      this.callbacks.delete('rfid');
      if (data.success) {
        resolve(data);
      } else {
        reject(new Error(data.error || 'RFID query failed on local helper'));
      }
    } else if (action === 'battery_result' && this.callbacks.has('battery')) {
      const { resolve, reject } = this.callbacks.get('battery');
      this.callbacks.delete('battery');
      if (data.success) {
        resolve(data.battery_level);
      } else {
        reject(new Error(data.error || 'Battery query failed on local helper'));
      }
    } else if (action === 'print_result' && this.callbacks.has('print')) {
      const { resolve, reject } = this.callbacks.get('print');
      this.callbacks.delete('print');
      if (data.success) {
        resolve(data);
      } else {
        reject(new Error(data.error || 'Print failed on local helper'));
      }
    }
  }

  async scanPrinters(timeoutMs = 15000) {
    if (!this.isConnected || !this.ws) {
      throw new Error('Local helper is not connected');
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.callbacks.has('scan')) {
          this.callbacks.delete('scan');
          reject(new Error('Scan timed out on local helper'));
        }
      }, timeoutMs);

      this.callbacks.set('scan', {
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      this.ws.send(JSON.stringify({ action: 'scan' }));
    });
  }

  async getRfidInfo(macAddress, timeoutMs = 12000) {
    if (!this.isConnected || !this.ws) {
      throw new Error('Local helper is not connected');
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.callbacks.has('rfid')) {
          this.callbacks.delete('rfid');
          reject(new Error('RFID query timed out on local helper'));
        }
      }, timeoutMs);

      this.callbacks.set('rfid', {
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      this.ws.send(JSON.stringify({
        action: 'get_rfid',
        mac_address: macAddress,
      }));
    });
  }

  async getBatteryLevel(macAddress, timeoutMs = 8000) {
    if (!this.isConnected || !this.ws) {
      throw new Error('Local helper is not connected');
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.callbacks.has('battery')) {
          this.callbacks.delete('battery');
          reject(new Error('Battery query timed out on local helper'));
        }
      }, timeoutMs);

      this.callbacks.set('battery', {
        resolve: (data) => {
          clearTimeout(timer);
          resolve(data);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      this.ws.send(JSON.stringify({
        action: 'get_battery',
        mac_address: macAddress,
      }));
    });
  }

  async printImages(jobPayload, onProgress = null) {
    if (!this.isConnected || !this.ws) {
      throw new Error('Local helper is not connected');
    }

    this.onProgress = onProgress;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.callbacks.has('print')) {
          this.callbacks.delete('print');
          reject(new Error('Print job timed out on local helper'));
        }
      }, 90000);

      this.callbacks.set('print', {
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      this.ws.send(JSON.stringify({
        action: 'print',
        ...jobPayload,
      }));
    });
  }

  async getLogs(timeoutMs = 5000) {
    if (!this.isConnected || !this.ws) {
      throw new Error('Local helper is not connected');
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.callbacks.delete('logs');
        reject(new Error('Log retrieval timed out'));
      }, timeoutMs);
      this.callbacks.set('logs', {
        resolve: (val) => { clearTimeout(timer); resolve(val); },
        reject: (err) => { clearTimeout(timer); reject(err); }
      });
      this.ws.send(JSON.stringify({ action: 'get_logs' }));
    });
  }

  async clearLogs(timeoutMs = 5000) {
    if (!this.isConnected || !this.ws) {
      throw new Error('Local helper is not connected');
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.callbacks.delete('clear_logs');
        reject(new Error('Clearing logs timed out'));
      }, timeoutMs);
      this.callbacks.set('clear_logs', {
        resolve: (val) => { clearTimeout(timer); resolve(val); },
        reject: (err) => { clearTimeout(timer); reject(err); }
      });
      this.ws.send(JSON.stringify({ action: 'clear_logs' }));
    });
  }

  async triggerSelfUpdate(serverUrl, timeoutMs = 30000) {
    if (!this.isConnected || !this.ws) {
      throw new Error('Local helper is not connected');
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.callbacks.delete('self_update');
        reject(new Error('Self-update timed out on local helper'));
      }, timeoutMs);
      this.callbacks.set('self_update', {
        resolve: (val) => { clearTimeout(timer); resolve(val); },
        reject: (err) => { clearTimeout(timer); reject(err); }
      });
      const url = serverUrl || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8000');
      this.ws.send(JSON.stringify({ action: 'self_update', server_url: url }));
    });
  }

  disconnect() {
    this.stopHeartbeat();
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_e) {}
      this.ws = null;
    }
    this.isConnected = false;
  }
}
