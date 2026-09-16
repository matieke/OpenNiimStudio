import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Sidebar from './Sidebar';
import { useStore } from '../store';

describe('Sidebar component', () => {
  let root = null;
  let div = null;

  beforeEach(() => {
    window.matchMedia = window.matchMedia || function() {
      return {
        matches: false,
        addListener: function() {},
        removeListener: function() {}
      };
    };

    useStore.setState({
      webBluetoothSupported: true,
      bridgeConnected: false,
      connectBridge: vi.fn().mockResolvedValue({ success: true })
    });
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root.unmount();
      });
      root = null;
    }
    if (div && div.parentNode) {
      div.parentNode.removeChild(div);
      div = null;
    }
  });

  it('renders without throwing ReferenceError for browserCapability', async () => {
    div = document.createElement('div');
    document.body.appendChild(div);

    root = createRoot(div);
    await act(async () => {
      root.render(<Sidebar />);
    });

    expect(div.innerHTML).toContain('Printers');
  });

  it('renders without throwing ReferenceError when helper is connected', async () => {
    useStore.setState({
      bridgeConnected: true,
      helperInfo: { version: '0.3.2', buildType: 'binary', isFrozen: true }
    });

    div = document.createElement('div');
    document.body.appendChild(div);

    root = createRoot(div);
    await act(async () => {
      root.render(<Sidebar />);
    });

    expect(div.innerHTML).toContain('v0.3.2 (Binary)');
  });
});
