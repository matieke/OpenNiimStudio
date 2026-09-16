import React, { useState, useEffect } from 'react';
import { X, Download, CheckCircle, AlertCircle, RefreshCw, Radio, Terminal, ExternalLink, Bluetooth } from 'lucide-react';
import { checkBridgeStatus, launchBridgeViaProtocol } from '../utils/localBridgeClient';
import { useStore } from '../store';

export default function HelperSetupModal({ isOpen, onClose, onConnected }) {
  const [status, setStatus] = useState('idle'); // 'idle' | 'checking' | 'connected' | 'failed'
  const [autoChecking, setAutoChecking] = useState(false);

  const webBluetoothSupported = useStore((state) => state.webBluetoothSupported);
  const browserCapability = useStore((state) => state.browserCapability);
  const connectWebBluetooth = useStore((state) => state.connectWebBluetooth);

  useEffect(() => {
    let interval = null;
    if (isOpen) {
      handleTestConnection();
      // Poll every 3 seconds while modal is open
      interval = setInterval(async () => {
        const res = await checkBridgeStatus(1000);
        if (res.running) {
          setStatus('connected');
          if (onConnected) onConnected();
        }
      }, 3000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTestConnection = async () => {
    setStatus('checking');
    const res = await checkBridgeStatus(1500);
    if (res.running) {
      setStatus('connected');
      if (onConnected) onConnected();
    } else {
      setStatus('failed');
    }
  };

  const handleLaunchProtocol = () => {
    launchBridgeViaProtocol();
    setTimeout(() => {
      handleTestConnection();
    }, 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xl w-full max-w-lg overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-sm">
              <Radio size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-900 dark:text-white">
                {webBluetoothSupported ? 'Bluetooth Compatibility' : 'Firefox & Safari Print Helper'}
              </h2>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                {webBluetoothSupported
                  ? `${browserCapability?.browser?.name || 'Your browser'} supports Web Bluetooth`
                  : 'Bluetooth companion for browsers without Web Bluetooth'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors p-1"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 text-xs text-neutral-700 dark:text-neutral-300">
          
          {webBluetoothSupported ? (
            <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 rounded-sm space-y-3">
              <div className="flex items-center gap-2 font-bold text-sm text-emerald-800 dark:text-emerald-300">
                <CheckCircle size={18} className="shrink-0" />
                <span>Zero Installation Required!</span>
              </div>
              <p className="text-xs leading-relaxed">
                You are using <strong>{browserCapability?.browser?.name || 'Google Chrome'}</strong>, which already supports Web Bluetooth natively. You do <strong>not</strong> need to download, install, or run this print helper!
              </p>
              <div className="pt-2 flex items-center gap-3">
                <button
                  onClick={() => {
                    onClose();
                    connectWebBluetooth();
                  }}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-wider transition-colors inline-flex items-center gap-2 rounded-none cursor-pointer"
                >
                  <Bluetooth size={15} /> Connect via Browser Bluetooth
                </button>
                <button
                  onClick={onClose}
                  className="px-3 py-2 border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-medium cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ) : (
            <div className="p-3 bg-blue-50/70 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-900/40 text-blue-900 dark:text-blue-200 leading-relaxed text-[11px]">
              <p className="font-semibold mb-1">
                Detected: {browserCapability?.browser?.name || 'Firefox'} • Companion Mode
              </p>
              Firefox and desktop Safari do not support the Web Bluetooth API natively. The lightweight CatLabel helper acts as a local bridge between your browser and your computer's Bluetooth adapter.
              <div className="mt-1 font-medium text-blue-700 dark:text-blue-300">
                ⚡ <strong>Zero clutter:</strong> The helper automatically shuts down 15 seconds after you close CatLabel tabs.
              </div>
            </div>
          )}

          {/* Steps (Only shown for non-Web-Bluetooth browsers like Firefox/Safari) */}
          {!webBluetoothSupported && (
            <div className="space-y-4">
              {/* Step 1 */}
              <div className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center font-bold text-neutral-700 dark:text-neutral-300 shrink-0 text-xs">
                  1
                </div>
                <div className="flex-1 space-y-2">
                  <p className="font-bold text-neutral-900 dark:text-white">Download the Print Helper</p>
                  <a
                    href="/api/helper/script"
                    download="catlabel-helper.py"
                    className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer"
                  >
                    <Download size={14} /> Download catlabel-helper.py
                  </a>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center font-bold text-neutral-700 dark:text-neutral-300 shrink-0 text-xs">
                  2
                </div>
                <div className="flex-1 space-y-1.5">
                  <p className="font-bold text-neutral-900 dark:text-white">Run the helper on your computer</p>
                  <div className="bg-neutral-950 text-neutral-200 p-2.5 rounded font-mono text-[11px] flex items-center justify-between border border-neutral-800">
                    <code>python3 catlabel-helper.py</code>
                  </div>
                  <p className="text-[10px] text-neutral-400">
                    First run automatically registers the <code>catlabel://</code> protocol so future launches work with one click.
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center font-bold text-neutral-700 dark:text-neutral-300 shrink-0 text-xs">
                  3
                </div>
                <div className="flex-1 space-y-2">
                  <p className="font-bold text-neutral-900 dark:text-white">Verify Connection</p>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleTestConnection}
                      disabled={status === 'checking'}
                      className="inline-flex items-center gap-2 px-3 py-1.5 border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 font-medium transition-colors text-xs cursor-pointer"
                    >
                      <RefreshCw size={13} className={status === 'checking' ? 'animate-spin' : ''} />
                      {status === 'checking' ? 'Testing...' : 'Test Connection'}
                    </button>

                    <button
                      onClick={handleLaunchProtocol}
                      className="text-blue-600 dark:text-blue-400 hover:underline text-xs flex items-center gap-1 cursor-pointer"
                      title="Try opening with registered catlabel:// protocol"
                    >
                      Launch via catlabel:// <ExternalLink size={12} />
                    </button>
                  </div>

                  {/* Connection feedback */}
                  {status === 'connected' && (
                    <div className="flex items-center gap-2 text-green-600 dark:text-green-400 font-semibold text-xs pt-1">
                      <CheckCircle size={15} /> Helper is connected and ready to print!
                    </div>
                  )}
                  {status === 'failed' && (
                    <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-xs pt-1">
                      <AlertCircle size={15} /> Helper not detected on ws://127.0.0.1:9123. Ensure it is running.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950/50">
          <span className="text-[10px] text-neutral-400">
            Chromium browsers (Chrome/Edge) don't need this helper.
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-neutral-900 hover:bg-black dark:bg-neutral-800 dark:hover:bg-neutral-700 text-white font-bold uppercase tracking-wider text-xs transition-colors"
          >
            {status === 'connected' ? 'Done' : 'Close'}
          </button>
        </div>

      </div>
    </div>
  );
}
