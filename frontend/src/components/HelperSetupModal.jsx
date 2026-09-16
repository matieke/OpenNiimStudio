import React, { useState, useEffect, useRef } from 'react';
import {
  X, Download, CheckCircle, AlertCircle, RefreshCw, Radio, Terminal,
  ExternalLink, Bluetooth, FileText, Copy, Check, Trash2, DownloadCloud, Activity
} from 'lucide-react';
import { checkBridgeStatus, launchBridgeViaProtocol } from '../utils/localBridgeClient';
import { useStore } from '../store';

export default function HelperSetupModal({ isOpen, onClose, onConnected }) {
  const [activeTab, setActiveTab] = useState('setup'); // 'setup' | 'logs'
  const [status, setStatus] = useState('idle'); // 'idle' | 'checking' | 'connected' | 'failed'
  const [logs, setLogs] = useState([]);
  const [logFile, setLogFile] = useState('');
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [copied, setCopied] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateMsg, setUpdateMsg] = useState('');

  const logEndRef = useRef(null);

  const webBluetoothSupported = useStore((state) => state.webBluetoothSupported);
  const browserCapability = useStore((state) => state.browserCapability);
  const connectWebBluetooth = useStore((state) => state.connectWebBluetooth);
  const helperInfo = useStore((state) => state.helperInfo);
  const bridgeConnected = useStore((state) => state.bridgeConnected);
  const fetchBridgeLogs = useStore((state) => state.fetchBridgeLogs);
  const clearBridgeLogs = useStore((state) => state.clearBridgeLogs);
  const updateBridgeHelper = useStore((state) => state.updateBridgeHelper);

  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isWindows = /windows|win32/i.test(userAgent);
  const isLinux = /linux|x11/i.test(userAgent) && !/android/i.test(userAgent);

  const isOutdated = helperInfo && (helperInfo.updateAvailable || (helperInfo.version && helperInfo.version < '0.3.2'));

  useEffect(() => {
    let interval = null;
    if (isOpen) {
      handleTestConnection();
      // Poll connection status while modal is open
      interval = setInterval(async () => {
        const res = await checkBridgeStatus(1000);
        if (res.running) {
          setStatus('connected');
          if (onConnected) onConnected();
        } else {
          setStatus((prev) => (prev === 'connected' ? 'failed' : prev));
        }
      }, 3000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isOpen]);

  // Load logs when switching to logs tab or when modal opens
  useEffect(() => {
    let logPoll = null;
    if (isOpen && activeTab === 'logs' && bridgeConnected) {
      loadLogs();
      logPoll = setInterval(() => {
        loadLogs(true);
      }, 2500);
    }
    return () => {
      if (logPoll) clearInterval(logPoll);
    };
  }, [isOpen, activeTab, bridgeConnected]);

  const loadLogs = async (silent = false) => {
    if (!silent) setLoadingLogs(true);
    try {
      const res = await fetchBridgeLogs();
      if (res) {
        setLogs(res.logs || []);
        if (res.logFile) setLogFile(res.logFile);
      }
    } catch (_e) {
      // Ignored if closed or disconnected
    } finally {
      if (!silent) setLoadingLogs(false);
    }
  };

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

  const handleCopyLogs = () => {
    if (!logs.length) return;
    navigator.clipboard.writeText(logs.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClearLogs = async () => {
    try {
      await clearBridgeLogs();
      setLogs([]);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSelfUpdate = async () => {
    setUpdating(true);
    setUpdateMsg('Downloading update from server and relaunching...');
    try {
      await updateBridgeHelper();
      setUpdateMsg('Update dispatched! Reconnecting in a moment...');
      setTimeout(async () => {
        await handleTestConnection();
        setUpdating(false);
        setUpdateMsg('');
      }, 3000);
    } catch (e) {
      setUpdating(false);
      setUpdateMsg(`Update failed: ${e.message || e}`);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xl w-full max-w-xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150 max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-sm">
              <Radio size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-900 dark:text-white flex items-center gap-2">
                <span>{webBluetoothSupported ? 'Bluetooth Compatibility' : 'Local Print Helper'}</span>
                {helperInfo?.version && (
                  <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono font-normal ${
                    isOutdated
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                      : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                  }`}>
                    v{helperInfo.version} ({helperInfo.buildType === 'binary' ? 'Binary' : 'Python'})
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                {webBluetoothSupported
                  ? `${browserCapability?.browser?.name || 'Your browser'} supports Web Bluetooth`
                  : 'Desktop bridge with system tray icon and live diagnostics'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors p-1 cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-neutral-200 dark:border-neutral-800 px-6 bg-neutral-100/60 dark:bg-neutral-950/30 gap-4">
          <button
            onClick={() => setActiveTab('setup')}
            className={`py-2 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors cursor-pointer ${
              activeTab === 'setup'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
            }`}
          >
            Setup & Downloads
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`py-2 text-xs font-semibold uppercase tracking-wider border-b-2 transition-colors flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'logs'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
            }`}
          >
            <FileText size={13} />
            <span>Diagnostics & Logs</span>
            {logs.length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 bg-neutral-200 dark:bg-neutral-800 text-[10px] rounded-full font-mono">
                {logs.length}
              </span>
            )}
          </button>
        </div>

        {/* Update Banner (if running outdated helper) */}
        {isOutdated && (
          <div className="mx-6 mt-4 p-3 bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 rounded-sm flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <AlertCircle size={16} className="text-amber-600 shrink-0" />
              <div>
                <span className="font-bold">Helper update available:</span> Running v{helperInfo.version}, server is v0.3.2.
              </div>
            </div>
            <button
              onClick={handleSelfUpdate}
              disabled={updating}
              className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs uppercase tracking-wider transition-colors inline-flex items-center gap-1 shrink-0 rounded-none cursor-pointer"
            >
              {updating ? <RefreshCw size={12} className="animate-spin" /> : <DownloadCloud size={12} />}
              {updating ? 'Updating...' : 'Update Now'}
            </button>
          </div>
        )}

        {updateMsg && (
          <div className="mx-6 mt-2 text-[11px] text-blue-600 dark:text-blue-400 font-medium">
            {updateMsg}
          </div>
        )}

        {/* Tab 1: Setup & Downloads */}
        {activeTab === 'setup' && (
          <div className="p-6 space-y-5 text-xs text-neutral-700 dark:text-neutral-300 overflow-y-auto max-h-[60vh]">
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
                <p className="font-semibold mb-1 flex items-center gap-1.5">
                  <Activity size={13} className="text-blue-600" />
                  <span>Detected: {browserCapability?.browser?.name || 'Firefox'} • Desktop Helper Mode</span>
                </p>
                Firefox and desktop Safari do not support the Web Bluetooth API natively. The standalone helper runs locally with a <strong>System Tray Icon</strong> and provides direct Bluetooth communication.
                <div className="mt-1 font-medium text-blue-700 dark:text-blue-300">
                  ⚡ <strong>Auto-terminates:</strong> The helper automatically exits 15 seconds after all OpenNiimStudio tabs are closed.
                </div>
              </div>
            )}

            {!webBluetoothSupported && (
              <div className="space-y-4">
                {/* Step 1: Download Standalone Binary */}
                <div className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center font-bold text-neutral-700 dark:text-neutral-300 shrink-0 text-xs">
                    1
                  </div>
                  <div className="flex-1 space-y-2">
                    <p className="font-bold text-neutral-900 dark:text-white">Download Standalone Print Helper (v0.3.2)</p>
                    <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      Standalone executables with system tray support. <strong>No Python installation needed.</strong>
                    </p>
                    
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {/* Windows Binary Button */}
                      <a
                        href="/api/helper/download/windows"
                        download="openniim-helper-windows.exe"
                        className={`inline-flex items-center gap-1.5 px-3 py-2 text-white font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer ${
                          isWindows ? 'bg-blue-600 hover:bg-blue-700 ring-2 ring-blue-400/50' : 'bg-neutral-800 hover:bg-neutral-700'
                        }`}
                        title="Standalone Windows executable with system tray"
                      >
                        <Download size={13} /> Windows (.exe)
                      </a>

                      {/* Linux Binary Button */}
                      <a
                        href="/api/helper/download/linux"
                        download="openniim-helper-linux"
                        className={`inline-flex items-center gap-1.5 px-3 py-2 text-white font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer ${
                          isLinux ? 'bg-blue-600 hover:bg-blue-700 ring-2 ring-blue-400/50' : 'bg-neutral-800 hover:bg-neutral-700'
                        }`}
                        title="Standalone Linux 64-bit binary with system tray"
                      >
                        <Download size={13} /> Linux (Binary)
                      </a>

                      {/* Python Script fallback */}
                      <a
                        href="/api/helper/script"
                        download="openniim-helper.py"
                        className="inline-flex items-center gap-1 px-2.5 py-2 border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300 text-xs transition-colors cursor-pointer"
                        title="Python source code"
                      >
                        <Terminal size={12} /> Python (.py)
                      </a>
                    </div>
                  </div>
                </div>

                {/* Step 2: Run & System Tray */}
                <div className="flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center font-bold text-neutral-700 dark:text-neutral-300 shrink-0 text-xs">
                    2
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <p className="font-bold text-neutral-900 dark:text-white">Run on your computer</p>
                    {isWindows ? (
                      <p className="text-[11px] text-neutral-600 dark:text-neutral-300">
                        Double-click <code className="bg-neutral-100 dark:bg-neutral-800 px-1 py-0.5 rounded font-mono">openniim-helper-windows.exe</code>. A system tray icon appears where you can view live logs or check for updates.
                      </p>
                    ) : (
                      <div className="space-y-1">
                        <div className="bg-neutral-950 text-neutral-200 p-2.5 font-mono text-[11px] border border-neutral-800">
                          <code>chmod +x openniim-helper-linux && ./openniim-helper-linux</code>
                        </div>
                        <p className="text-[10px] text-neutral-400">
                          Starts the helper with a desktop system tray icon and registers the <code className="text-blue-400">openniim://</code> protocol.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Step 3: Verify Connection */}
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
                        title="Try opening with registered openniim:// protocol"
                      >
                        Launch via Protocol <ExternalLink size={12} />
                      </button>
                    </div>

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
        )}

        {/* Tab 2: Diagnostics & Live Logs */}
        {activeTab === 'logs' && (
          <div className="p-6 space-y-3 text-xs flex-1 flex flex-col min-h-[300px] max-h-[60vh]">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-bold text-neutral-900 dark:text-white">Helper Bridge Log Stream</span>
                {logFile && (
                  <p className="text-[10px] text-neutral-400 font-mono truncate max-w-sm" title={logFile}>
                    File: {logFile}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => loadLogs(false)}
                  disabled={loadingLogs || !bridgeConnected}
                  className="px-2.5 py-1 border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-[11px] font-medium transition-colors inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  title="Refresh logs"
                >
                  <RefreshCw size={11} className={loadingLogs ? 'animate-spin' : ''} /> Refresh
                </button>
                <button
                  onClick={handleCopyLogs}
                  disabled={!logs.length}
                  className="px-2.5 py-1 border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-[11px] font-medium transition-colors inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  title="Copy logs to clipboard"
                >
                  {copied ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={handleClearLogs}
                  disabled={!logs.length || !bridgeConnected}
                  className="px-2.5 py-1 border border-neutral-300 dark:border-neutral-700 hover:bg-red-50 dark:hover:bg-red-950/30 text-neutral-500 hover:text-red-600 text-[11px] transition-colors inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  title="Clear in-memory logs"
                >
                  <Trash2 size={11} /> Clear
                </button>
              </div>
            </div>

            {/* Log Console Window */}
            <div className="flex-1 bg-neutral-950 text-neutral-200 p-3 font-mono text-[11px] rounded border border-neutral-800 overflow-y-auto space-y-1 h-[280px]">
              {!bridgeConnected ? (
                <div className="text-neutral-500 italic py-8 text-center">
                  Helper is not currently connected to ws://127.0.0.1:9123.
                  <br />
                  Start the helper binary on your computer to view live logs.
                </div>
              ) : logs.length === 0 ? (
                <div className="text-neutral-500 italic py-8 text-center">
                  {loadingLogs ? 'Loading logs from helper...' : 'No log messages received yet.'}
                </div>
              ) : (
                logs.map((line, idx) => (
                  <div
                    key={idx}
                    className={`leading-relaxed break-all ${
                      line.includes('[ERROR]') || line.includes('error') || line.includes('failed')
                        ? 'text-red-400'
                        : line.includes('[WARNING]')
                        ? 'text-amber-400'
                        : line.includes('discovered printer') || line.includes('valid printers')
                        ? 'text-emerald-400'
                        : 'text-neutral-300'
                    }`}
                  >
                    {line}
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>

            <div className="text-[10px] text-neutral-400 flex items-center justify-between">
              <span>Auto-refreshes every 2.5s while this tab is open.</span>
              <span>Desktop users can also right-click the tray icon &gt; <strong>View Logs</strong>.</span>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950/50">
          <span className="text-[10px] text-neutral-400">
            Chromium browsers (Chrome/Edge) can also print without helper via Web Bluetooth.
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-neutral-900 hover:bg-black dark:bg-neutral-800 dark:hover:bg-neutral-700 text-white font-bold uppercase tracking-wider text-xs transition-colors cursor-pointer"
          >
            {status === 'connected' ? 'Done' : 'Close'}
          </button>
        </div>

      </div>
    </div>
  );
}
