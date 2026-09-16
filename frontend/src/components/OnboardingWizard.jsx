import React, { useEffect, useState, useCallback } from 'react';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { useDialogAccessibility } from '../utils/useDialogAccessibility';
import { apiFetch } from '../utils/apiClient';
import {
  Printer,
  Sparkles,
  Search,
  ChevronRight,
  Loader2,
  Bot,
  ArrowLeft,
  CheckCircle,
  Globe,
  Tag,
  Bluetooth,
  Radio,
  Download,
  ExternalLink,
  RefreshCw,
  AlertCircle
} from 'lucide-react';

export default function OnboardingWizard() {
  const dialogRef = useDialogAccessibility(null, { closeOnEscape: false });
  const {
    updateSettingsAPI,
    settings,
    selectedPrinterInfo,
    setSelectedPrinter,
    addManualPrinter,
    setShowAiConfig,
    webBluetoothSupported,
    browserCapability,
    connectWebBluetooth,
    bridgeConnected,
    bridgeChecking,
    connectBridge,
    launchBridgeHelper,
    scanViaBridge,
    setShowHelperSetupModal,
  } = useStore(
    useShallow((state) => ({
      updateSettingsAPI: state.updateSettingsAPI,
      settings: state.settings,
      selectedPrinterInfo: state.selectedPrinterInfo,
      setSelectedPrinter: state.setSelectedPrinter,
      addManualPrinter: state.addManualPrinter,
      setShowAiConfig: state.setShowAiConfig,
      webBluetoothSupported: state.webBluetoothSupported,
      browserCapability: state.browserCapability,
      connectWebBluetooth: state.connectWebBluetooth,
      bridgeConnected: state.bridgeConnected,
      bridgeChecking: state.bridgeChecking,
      connectBridge: state.connectBridge,
      launchBridgeHelper: state.launchBridgeHelper,
      scanViaBridge: state.scanViaBridge,
      setShowHelperSetupModal: state.setShowHelperSetupModal,
    }))
  );

  const [step, setStep] = useState(1);
  const [isScanning, setIsScanning] = useState(false);
  const [scanSource, setScanSource] = useState('');
  const [hasScanned, setHasScanned] = useState(false);
  const [scannedPrinters, setScannedPrinters] = useState([]);

  // Navigation states for manual setup flow
  const [manualStep, setManualStep] = useState('off'); // 'off', 'vendor', 'model', 'added'
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [supportedModels, setSupportedModels] = useState([]);

  useEffect(() => {
    apiFetch('/api/printers/supported_models')
      .then((res) => res.json())
      .then((data) => setSupportedModels(data.models || []))
      .catch((error) => {
        console.error('Failed to fetch supported printer models', error);
        useStore.setState({ apiError: error.message || 'Failed to load supported printer models.' });
      });

    // Auto-probe local helper if available
    connectBridge();
  }, [connectBridge]);

  const finishOnboarding = (mediaTypeAssumption) => {
    updateSettingsAPI({ ...settings, intended_media_type: mediaTypeAssumption });
  };

  const handleConnectBrowserBluetooth = async () => {
    setIsScanning(true);
    setScanSource('browser');
    try {
      const res = await connectWebBluetooth();
      if (res && res.success) {
        setStep(2);
      }
    } finally {
      setIsScanning(false);
    }
  };

  const handleScanHelper = useCallback(async () => {
    setIsScanning(true);
    setScanSource('helper');
    setHasScanned(true);
    setManualStep('off');
    try {
      const devices = await scanViaBridge();
      setScannedPrinters(devices || []);
      if (!devices || devices.length === 0) {
        useStore.setState({ apiError: 'No Bluetooth printers found by Print Helper. Ensure printer is on.' });
      }
    } catch (e) {
      console.error(e);
      useStore.setState({ apiError: `Helper scan failed: ${e.message || e}` });
    } finally {
      setIsScanning(false);
    }
  }, [scanViaBridge]);

  const handleLaunchAndScanHelper = useCallback(async () => {
    launchBridgeHelper();
    setIsScanning(true);
    setScanSource('helper');
    let count = 0;
    const retryTimer = setInterval(async () => {
      count++;
      const res = await connectBridge();
      if (res && res.success) {
        clearInterval(retryTimer);
        await handleScanHelper();
      } else if (count >= 6) {
        clearInterval(retryTimer);
        setIsScanning(false);
        setShowHelperSetupModal(true);
      }
    }, 1000);
  }, [launchBridgeHelper, connectBridge, handleScanHelper, setShowHelperSetupModal]);

  const handleScanServer = async () => {
    setIsScanning(true);
    setScanSource('server');
    setHasScanned(true);
    setManualStep('off');

    try {
      const res = await apiFetch('/api/printers/scan');
      const data = await res.json();
      setScannedPrinters(data.devices || []);
      if (!data.devices || data.devices.length === 0) {
        useStore.setState({
          apiError: 'No Bluetooth printers found on server. If running in Docker, connect via Browser Bluetooth or Local Helper!',
        });
      }
    } catch (e) {
      console.error(e);
      useStore.setState({ apiError: e.message || 'Failed to scan for server printers.' });
    } finally {
      setIsScanning(false);
    }
  };

  const selectPrinter = async (printerObj) => {
    await setSelectedPrinter(printerObj.address, printerObj);
    setStep(2);
  };

  const handleAddManual = async (info) => {
    const address = `manual-${info.model_id || info.model}`;
    const { manualPrinters } = useStore.getState();
    const exists = manualPrinters.some((p) => p.address === address);

    if (exists) {
      await setSelectedPrinter(address, manualPrinters.find((p) => p.address === address));
      setManualStep('added');
      return;
    }

    const manualPrinter = {
      ...info,
      name: `Offline: ${info.name}`,
      address: address,
      transport: 'offline',
      model_id: info.model_id || info.model,
    };

    addManualPrinter(manualPrinter);
    await setSelectedPrinter(manualPrinter.address, manualPrinter);
    setManualStep('added');
  };

  const getGroupedModels = () => {
    if (!selectedVendor) return {};
    const vendorModels = supportedModels.filter((m) => m.vendor === selectedVendor);

    const groups = {
      'Small Labels (12-15mm)': [],
      'Medium Labels (25-30mm)': [],
      'Standard / 2-inch (48-58mm)': [],
      'Large / 3-inch (72-80mm)': [],
      'Extra Large / 4-inch (100mm+)': [],
    };

    vendorModels.forEach((m) => {
      const w = m.width_mm || 48;
      if (w <= 15) groups['Small Labels (12-15mm)'].push(m);
      else if (w <= 30) groups['Medium Labels (25-30mm)'].push(m);
      else if (w <= 58) groups['Standard / 2-inch (48-58mm)'].push(m);
      else if (w <= 80) groups['Large / 3-inch (72-80mm)'].push(m);
      else groups['Extra Large / 4-inch (100mm+)'].push(m);
    });

    Object.keys(groups).forEach((k) => {
      if (groups[k].length === 0) delete groups[k];
    });

    return groups;
  };

  const selectedMediaType = selectedPrinterInfo?.media_type || 'continuous';

  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Welcome setup"
        tabIndex={-1}
        className="bg-white dark:bg-neutral-950 w-full max-w-3xl rounded-xl shadow-2xl flex flex-col border border-neutral-200 dark:border-neutral-800 overflow-hidden min-h-[500px]"
      >
        <div className="bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 p-6 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-2xl font-serif tracking-tight dark:text-white">Welcome to OpenNiimStudio</h2>
            <p className="text-sm text-neutral-500 mt-1">Let's configure your printer and workspace.</p>
          </div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest">
            <span className={step >= 1 ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-400'}>1. Printer</span>
            <ChevronRight size={14} className="text-neutral-300 dark:text-neutral-700" />
            <span className={step >= 2 ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-400'}>2. AI Assistant</span>
          </div>
        </div>

        {step === 1 && (
          <div className="p-8 flex-1 flex flex-col gap-6 relative overflow-hidden">
            {/* --- MAIN MENU --- */}
            {!isScanning && manualStep === 'off' && (
              <div className="flex-1 flex flex-col gap-5 animate-in fade-in duration-300">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* Card 1: Web Bluetooth or Helper */}
                  {webBluetoothSupported ? (
                    <button
                      onClick={handleConnectBrowserBluetooth}
                      className="flex flex-col items-center justify-center text-center gap-3 p-6 border-2 border-blue-200 dark:border-blue-900/60 rounded-xl hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all group cursor-pointer"
                    >
                      <Bluetooth size={32} className="text-blue-500 group-hover:scale-110 transition-transform" />
                      <div>
                        <span className="inline-block text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 mb-1.5">
                          Zero Install
                        </span>
                        <h3 className="font-bold text-sm dark:text-white uppercase tracking-wider">Browser Bluetooth</h3>
                        <p className="text-[10px] text-neutral-500 mt-1">Pair directly via Web Bluetooth</p>
                      </div>
                    </button>
                  ) : (
                    <button
                      onClick={bridgeConnected ? handleScanHelper : handleLaunchAndScanHelper}
                      className="flex flex-col items-center justify-center text-center gap-3 p-6 border-2 border-blue-300 dark:border-blue-800 rounded-xl hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all group cursor-pointer"
                    >
                      <Radio size={32} className="text-blue-500 group-hover:scale-110 transition-transform" />
                      <div>
                        <span
                          className={`inline-block text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded mb-1.5 ${
                            bridgeConnected
                              ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400'
                              : 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {bridgeConnected ? 'Helper Connected' : 'Companion Required'}
                        </span>
                        <h3 className="font-bold text-sm dark:text-white uppercase tracking-wider">
                          {bridgeConnected ? 'Scan via Helper' : 'Print Helper'}
                        </h3>
                        <p className="text-[10px] text-neutral-500 mt-1">
                          {bridgeConnected ? 'Scan local Bluetooth' : 'Launch or install companion'}
                        </p>
                      </div>
                    </button>
                  )}

                  {/* Card 2: Local Helper (if chromium) or Manual Setup */}
                  {webBluetoothSupported ? (
                    <button
                      onClick={bridgeConnected ? handleScanHelper : () => setShowHelperSetupModal(true)}
                      className="flex flex-col items-center justify-center text-center gap-3 p-6 border-2 border-neutral-200 dark:border-neutral-800 rounded-xl hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-all group cursor-pointer"
                    >
                      <Radio size={32} className="text-emerald-500 group-hover:scale-110 transition-transform" />
                      <div>
                        <span
                          className={`inline-block text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded mb-1.5 ${
                            bridgeConnected
                              ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400'
                              : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500'
                          }`}
                        >
                          {bridgeConnected ? 'Helper Ready' : 'Desktop Daemon'}
                        </span>
                        <h3 className="font-bold text-sm dark:text-white uppercase tracking-wider">Print Helper</h3>
                        <p className="text-[10px] text-neutral-500 mt-1">Local desktop bridge</p>
                      </div>
                    </button>
                  ) : (
                    <button
                      onClick={() => setManualStep('vendor')}
                      className="flex flex-col items-center justify-center text-center gap-3 p-6 border-2 border-neutral-200 dark:border-neutral-800 rounded-xl hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-all group cursor-pointer"
                    >
                      <Printer size={32} className="text-emerald-500 group-hover:scale-110 transition-transform" />
                      <div>
                        <span className="inline-block text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-500 mb-1.5">
                          Offline Design
                        </span>
                        <h3 className="font-bold text-sm dark:text-white uppercase tracking-wider">Manual Setup</h3>
                        <p className="text-[10px] text-neutral-500 mt-1">Select offline profile</p>
                      </div>
                    </button>
                  )}

                  {/* Card 3: Manual Setup (Chromium) or Server Scan (Non-Chromium) */}
                  {webBluetoothSupported ? (
                    <button
                      onClick={() => setManualStep('vendor')}
                      className="flex flex-col items-center justify-center text-center gap-3 p-6 border-2 border-neutral-200 dark:border-neutral-800 rounded-xl hover:border-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-all group cursor-pointer"
                    >
                      <Printer size={32} className="text-purple-500 group-hover:scale-110 transition-transform" />
                      <div>
                        <span className="inline-block text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-500 mb-1.5">
                          Offline Design
                        </span>
                        <h3 className="font-bold text-sm dark:text-white uppercase tracking-wider">Manual Setup</h3>
                        <p className="text-[10px] text-neutral-500 mt-1">Select offline profile</p>
                      </div>
                    </button>
                  ) : (
                    <button
                      onClick={handleScanServer}
                      className="flex flex-col items-center justify-center text-center gap-3 p-6 border-2 border-neutral-200 dark:border-neutral-800 rounded-xl hover:border-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 transition-all group cursor-pointer"
                    >
                      <Search size={32} className="text-neutral-400 group-hover:scale-110 transition-transform" />
                      <div>
                        <span className="inline-block text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-500 mb-1.5">
                          Container/Host
                        </span>
                        <h3 className="font-bold text-sm dark:text-white uppercase tracking-wider">Server Scan</h3>
                        <p className="text-[10px] text-neutral-500 mt-1">Scan server adapter</p>
                      </div>
                    </button>
                  )}
                </div>

                {/* Helper notice if Firefox/Safari and not connected */}
                {!webBluetoothSupported && !bridgeConnected && (
                  <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800/80 rounded-lg space-y-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                        <AlertCircle size={15} className="text-amber-600 dark:text-amber-400 shrink-0" />
                        Firefox & Safari require the OpenNiimStudio Print Helper
                      </span>
                      <span className="text-[10px] bg-amber-200/80 dark:bg-amber-900 text-amber-900 dark:text-amber-200 px-2 py-0.5 rounded font-mono font-bold">
                        Companion Not Detected
                      </span>
                    </div>
                    <p className="text-neutral-600 dark:text-neutral-400 leading-relaxed text-[11px]">
                      Because {browserCapability?.browser?.name || 'this browser'} does not support the Web Bluetooth API natively,
                      the lightweight <code>openniim-helper.py</code> script bridges your computer's Bluetooth adapter to this tab.
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <a
                        href="/api/helper/script"
                        download="openniim-helper.py"
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold uppercase tracking-wider text-[10px] flex items-center gap-1.5 rounded-none cursor-pointer"
                      >
                        <Download size={12} /> Download openniim-helper.py
                      </a>
                      <button
                        onClick={handleLaunchAndScanHelper}
                        className="px-3 py-1.5 border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-[10px] font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300 flex items-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw size={12} /> Launch & Test Connection
                      </button>
                      <button
                        onClick={() => setShowHelperSetupModal(true)}
                        className="px-3 py-1.5 border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-[10px] font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300 flex items-center gap-1.5 cursor-pointer"
                      >
                        <ExternalLink size={12} /> Setup Guide
                      </button>
                    </div>
                    <p className="text-[10px] text-neutral-400 dark:text-neutral-500 italic pt-0.5">
                      Tip: Open this page in Google Chrome or Microsoft Edge for 1-click zero-install direct printing without running any script!
                    </p>
                  </div>
                )}

                {/* Helper Connected Banner */}
                {bridgeConnected && (
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 rounded-lg flex items-center justify-between text-xs text-emerald-900 dark:text-emerald-200">
                    <div className="flex items-center gap-2 font-medium">
                      <CheckCircle size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span>Print Helper is connected and ready to scan for local Bluetooth printers.</span>
                    </div>
                    <button
                      onClick={handleScanHelper}
                      className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold uppercase tracking-wider text-[10px] cursor-pointer"
                    >
                      Scan Local Printers
                    </button>
                  </div>
                )}

                {/* Discovered Printers List */}
                {hasScanned && scannedPrinters.length > 0 && (
                  <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg overflow-hidden flex-1 flex flex-col">
                    <div className="bg-neutral-100 dark:bg-neutral-900 px-4 py-2 text-[10px] uppercase font-bold text-neutral-500 shrink-0 flex items-center justify-between">
                      <span>Found Printers ({scannedPrinters.length})</span>
                      <span className="text-[9px] uppercase font-normal text-neutral-400">
                        Source: {scanSource === 'helper' ? 'Local Helper' : 'Server'}
                      </span>
                    </div>
                    <div className="overflow-y-auto max-h-48 divide-y divide-neutral-100 dark:divide-neutral-800">
                      {scannedPrinters.map((p) => (
                        <button
                          type="button"
                          key={p.address}
                          onClick={() => selectPrinter(p)}
                          className="w-full px-4 py-3 flex justify-between items-center cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors text-left"
                        >
                          <div>
                            <div className="font-bold dark:text-white text-sm">{p.name || p.display_address}</div>
                            <div className="text-xs text-neutral-500">
                              {p.width_mm}mm • {p.media_type || 'continuous'} • {p.address}
                            </div>
                          </div>
                          <ChevronRight className="text-blue-500" size={16} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {hasScanned && scannedPrinters.length === 0 && (
                  <div className="border border-dashed border-neutral-300 dark:border-neutral-700 rounded-lg p-6 text-center text-sm text-neutral-500 space-y-2">
                    <p>No Bluetooth printers were found.</p>
                    <p className="text-xs text-neutral-400">
                      Make sure your printer is powered on and within range, or select <strong>Manual Setup</strong> to design offline.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* --- SCANNING LOADING VIEW --- */}
            {isScanning && (
              <div className="flex flex-col justify-center items-center py-12 text-neutral-500 gap-4 flex-1">
                <Loader2 className="animate-spin text-blue-500" size={36} />
                <div className="text-center">
                  <span className="text-sm font-medium dark:text-white block">
                    {scanSource === 'browser'
                      ? 'Waiting for Browser Bluetooth device selection...'
                      : scanSource === 'helper'
                        ? 'Scanning local Bluetooth via Print Helper...'
                        : 'Searching for Bluetooth printers...'}
                  </span>
                  <span className="text-xs text-neutral-400 mt-1 block">Ensure your Niimbot / label printer is turned on</span>
                </div>
              </div>
            )}

            {/* --- MANUAL SETUP: VENDOR SELECTION --- */}
            {!isScanning && manualStep === 'vendor' && (
              <div className="flex flex-col h-full animate-in fade-in slide-in-from-right-4 duration-300">
                <button
                  onClick={() => setManualStep('off')}
                  className="flex items-center gap-1 text-xs uppercase font-bold tracking-widest text-neutral-500 hover:text-neutral-900 dark:hover:text-white transition-colors mb-6 self-start cursor-pointer"
                >
                  <ArrowLeft size={14} /> Back
                </button>
                <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-400 dark:text-neutral-500 mb-4">
                  Select Printer Brand
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <button
                    onClick={() => {
                      setSelectedVendor('generic');
                      setManualStep('model');
                    }}
                    className="flex flex-col items-center text-center gap-3 p-5 border border-neutral-200 dark:border-neutral-800 rounded-xl hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all cursor-pointer"
                  >
                    <Globe size={28} className="text-blue-500" />
                    <div>
                      <div className="font-bold text-sm dark:text-white">Generic Chinese</div>
                      <div className="text-[10px] text-neutral-500 mt-1">"Cat Printers", Mini Printers</div>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      setSelectedVendor('niimbot');
                      setManualStep('model');
                    }}
                    className="flex flex-col items-center text-center gap-3 p-5 border border-neutral-200 dark:border-neutral-800 rounded-xl hover:border-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-all cursor-pointer"
                  >
                    <Tag size={28} className="text-emerald-500" />
                    <div>
                      <div className="font-bold text-sm dark:text-white">Niimbot</div>
                      <div className="text-[10px] text-neutral-500 mt-1">D11, D110, B21, B3S, B18</div>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      setSelectedVendor('phomemo');
                      setManualStep('model');
                    }}
                    className="flex flex-col items-center text-center gap-3 p-5 border border-neutral-200 dark:border-neutral-800 rounded-xl hover:border-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-all cursor-pointer"
                  >
                    <Printer size={28} className="text-purple-500" />
                    <div>
                      <div className="font-bold text-sm dark:text-white">Phomemo</div>
                      <div className="text-[10px] text-neutral-500 mt-1">M02, M110, D30, T02</div>
                    </div>
                  </button>
                </div>

                <div className="mt-6 text-[10px] text-neutral-500 leading-relaxed bg-neutral-50 dark:bg-neutral-900/50 p-3 rounded border border-neutral-100 dark:border-neutral-800">
                  <strong>Hint:</strong> If you bought a generic "Mini Printer" from AliExpress that looks like a cat, it almost always uses the <strong>Generic Chinese</strong> profile (Model: GT01).
                </div>
              </div>
            )}

            {/* --- MANUAL SETUP: MODEL SELECTION --- */}
            {!isScanning && manualStep === 'model' && (
              <div className="flex flex-col h-full animate-in fade-in slide-in-from-right-4 duration-300">
                <button
                  onClick={() => setManualStep('vendor')}
                  className="flex items-center gap-1 text-xs uppercase font-bold tracking-widest text-neutral-500 hover:text-neutral-900 dark:hover:text-white transition-colors mb-6 self-start cursor-pointer"
                >
                  <ArrowLeft size={14} /> Back to Brands
                </button>

                <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-hidden flex flex-col flex-1 max-h-[50vh]">
                  <div className="bg-neutral-50 dark:bg-neutral-900 px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 text-xs font-bold uppercase tracking-widest text-neutral-500 shrink-0">
                    Select Specific Model
                  </div>
                  <div className="overflow-y-auto flex-1 bg-white dark:bg-neutral-950">
                    {Object.entries(getGroupedModels()).map(([groupName, models]) => (
                      <div key={groupName}>
                        <div className="px-4 py-1.5 bg-neutral-100 dark:bg-neutral-900/50 text-[10px] font-bold uppercase tracking-widest text-neutral-400 border-y border-neutral-100 dark:border-neutral-800/50 sticky top-0 backdrop-blur-md">
                          {groupName}
                        </div>
                        <div className="divide-y divide-neutral-100 dark:divide-neutral-800/50">
                          {models.map((m) => (
                            <button
                              key={m.model_no || m.model_id}
                              onClick={() => handleAddManual(m)}
                              className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors group cursor-pointer"
                            >
                              <div>
                                <div className="text-sm font-bold dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                                  {m.name}
                                </div>
                                <div className="text-[10px] text-neutral-500 mt-0.5">
                                  {m.media_type === 'continuous' ? 'Continuous Roll' : 'Pre-cut Labels'}
                                </div>
                              </div>
                              <div className="text-[10px] font-bold tracking-widest uppercase text-neutral-400 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 px-2 py-1 rounded">
                                {m.dpi} DPI
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* --- MANUAL SETUP: ADDED SUCCESS --- */}
            {!isScanning && manualStep === 'added' && (
              <div className="flex flex-col items-center justify-center py-6 gap-6 text-center animate-in zoom-in-95 duration-300 flex-1">
                <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 text-green-500 rounded-full flex items-center justify-center">
                  <CheckCircle size={32} />
                </div>
                <div>
                  <h3 className="text-xl font-serif dark:text-white mb-2">Profile Added</h3>
                  <p className="text-sm text-neutral-500">The offline printer profile has been successfully configured.</p>
                </div>
                <div className="flex w-full gap-4 mt-2 max-w-sm">
                  <button
                    onClick={() => setManualStep('vendor')}
                    className="flex-1 py-3 text-xs uppercase font-bold tracking-widest border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
                  >
                    Add Another
                  </button>
                  <button
                    onClick={() => setStep(2)}
                    className="flex-1 py-3 bg-blue-600 text-white text-xs uppercase font-bold tracking-widest hover:bg-blue-700 flex justify-center items-center gap-2 transition-colors cursor-pointer"
                  >
                    Continue <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* --- STEP 2: AI CONFIG --- */}
        {step === 2 && (
          <div className="p-8 flex-1 flex flex-col items-center justify-center text-center gap-6">
            <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center">
              <Bot size={32} />
            </div>
            <div>
              <h3 className="text-xl font-serif dark:text-white mb-2">Configure Your AI Layout Assistant</h3>
              <p className="text-sm text-neutral-500 max-w-md mx-auto leading-relaxed mb-4">
                OpenNiimStudio includes an advanced AI Agent that can instantly design labels, configure permutations, and inject variables based on plain English requests.
              </p>
              <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 p-4 rounded text-left text-xs text-neutral-600 dark:text-neutral-400">
                <p className="mb-2">
                  <strong>Cloud APIs:</strong> Connect OpenAI, Gemini, or Vertex AI instantly.
                </p>
                <p>
                  <strong>Local Inference (Free):</strong> You can use apps like <em>LM Studio</em> by selecting the "Custom" provider in settings and pointing it to <code>http://localhost:1234/v1</code>.
                </p>
              </div>
            </div>

            <div className="flex w-full gap-4 mt-4 max-w-md">
              <button
                onClick={() => finishOnboarding(selectedMediaType)}
                className="flex-1 py-3 text-xs uppercase font-bold tracking-widest border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                Skip For Now
              </button>
              <button
                onClick={() => {
                  finishOnboarding(selectedMediaType);
                  setShowAiConfig(true);
                }}
                className="flex-[2] py-3 bg-blue-600 text-white text-xs uppercase font-bold tracking-widest hover:bg-blue-700 flex justify-center items-center gap-2 transition-colors cursor-pointer"
              >
                <Sparkles size={16} /> Configure AI Keys
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
