import { describe, it, expect } from 'vitest';
import { detectBrowser, getBluetoothCapability } from './browserDetection';

describe('browserDetection', () => {
  it('detects Chrome correctly', () => {
    const nav = {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      vendor: 'Google Inc.'
    };
    const res = detectBrowser(nav);
    expect(res.name).toBe('Google Chrome');
    expect(res.isChromium).toBe(true);
    expect(res.isFirefox).toBe(false);
  });

  it('detects Firefox correctly', () => {
    const nav = {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0',
      vendor: ''
    };
    const res = detectBrowser(nav);
    expect(res.name).toBe('Mozilla Firefox');
    expect(res.isFirefox).toBe(true);
    expect(res.isChromium).toBe(false);
  });

  it('detects Edge correctly', () => {
    const nav = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
      vendor: 'Google Inc.'
    };
    const res = detectBrowser(nav);
    expect(res.name).toBe('Microsoft Edge');
    expect(res.isEdge).toBe(true);
    expect(res.isChromium).toBe(true);
  });

  it('detects Safari correctly', () => {
    const nav = {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      vendor: 'Apple Computer, Inc.'
    };
    const res = detectBrowser(nav);
    expect(res.name).toBe('Apple Safari');
    expect(res.isSafari).toBe(true);
    expect(res.isChromium).toBe(false);
  });

  it('evaluates Web Bluetooth capability for Chrome when bluetooth API is available', () => {
    const nav = {
      userAgent: 'Mozilla/5.0 Chrome/120.0.0.0',
      vendor: 'Google Inc.',
      bluetooth: { requestDevice: () => {} }
    };
    const win = { isSecureContext: true, location: { hostname: 'example.com' } };
    const cap = getBluetoothCapability(win, nav);
    expect(cap.supportsWebBluetooth).toBe(true);
    expect(cap.requiresHelper).toBe(false);
    expect(cap.status).toBe('native_ready');
  });

  it('marks helper required for Firefox', () => {
    const nav = {
      userAgent: 'Mozilla/5.0 Firefox/120.0',
      vendor: ''
    };
    const win = { isSecureContext: true, location: { hostname: 'example.com' } };
    const cap = getBluetoothCapability(win, nav);
    expect(cap.supportsWebBluetooth).toBe(false);
    expect(cap.requiresHelper).toBe(true);
    expect(cap.status).toBe('firefox_helper_required');
  });

  it('detects when Chromium requires HTTPS', () => {
    const nav = {
      userAgent: 'Mozilla/5.0 Chrome/120.0.0.0',
      vendor: 'Google Inc.'
    };
    const win = { isSecureContext: false, location: { hostname: '192.168.1.50' } };
    const cap = getBluetoothCapability(win, nav);
    expect(cap.supportsWebBluetooth).toBe(false);
    expect(cap.requiresHelper).toBe(true);
    expect(cap.status).toBe('needs_https');
  });
});
