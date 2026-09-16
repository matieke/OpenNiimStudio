import React, { useCallback, useState, useEffect } from 'react';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import ProjectTree from './ProjectTree';
import SavePresetModal from './SavePresetModal';
import PrinterDropdown from './PrinterDropdown';
import PresetPickerModal from './PresetPickerModal';
import HelperSetupModal from './HelperSetupModal';
import { getPageIndices } from '../utils/canvasPages';
import { apiFetch } from '../utils/apiClient';
import { launchBridgeViaProtocol } from '../utils/localBridgeClient';
import {
  ChevronDown, ChevronRight, LayoutTemplate,
  Menu, Printer, Wifi, Archive, Bluetooth, Radio, Settings2,
  Tag, RefreshCw
} from 'lucide-react';

export default function Sidebar() {
  const {
    items,
    selectedPrinter,
    setSelectedPrinter,
    theme,
    setTheme,
    isSidebarCollapsed,
    toggleSidebar,
    printCopies,
    setPrintCopies,
    isPrinting,
    printPages,
    selectedPagesForPrint,
    manualPrinters,
    pageLayouts,
    currentPage,
    webBluetoothSession,
    webBluetoothProgress,
    connectWebBluetooth,
    disconnectWebBluetooth,
    webBluetoothSupported,
    browserCapability,
    bridgeConnected,
    bridgeChecking,
    connectBridge,
    disconnectBridge,
    launchBridgeHelper,
    scanViaBridge,
    showHelperSetupModal,
    setShowHelperSetupModal,
    loadedPaperInfo,
    isReadingRfid,
    readPrinterRfid
  } = useStore(useShallow((state) => ({
    items: state.items, selectedPrinter: state.selectedPrinter, setSelectedPrinter: state.setSelectedPrinter,
    theme: state.theme, setTheme: state.setTheme, isSidebarCollapsed: state.isSidebarCollapsed,
    toggleSidebar: state.toggleSidebar, printCopies: state.printCopies, setPrintCopies: state.setPrintCopies,
    isPrinting: state.isPrinting, printPages: state.printPages, selectedPagesForPrint: state.selectedPagesForPrint,
    manualPrinters: state.manualPrinters, pageLayouts: state.pageLayouts, currentPage: state.currentPage,
    webBluetoothSession: state.webBluetoothSession, webBluetoothProgress: state.webBluetoothProgress,
    connectWebBluetooth: state.connectWebBluetooth, disconnectWebBluetooth: state.disconnectWebBluetooth,
    webBluetoothSupported: state.webBluetoothSupported,
    browserCapability: state.browserCapability,
    bridgeConnected: state.bridgeConnected, bridgeChecking: state.bridgeChecking,
    connectBridge: state.connectBridge, disconnectBridge: state.disconnectBridge,
    launchBridgeHelper: state.launchBridgeHelper, scanViaBridge: state.scanViaBridge,
    showHelperSetupModal: state.showHelperSetupModal, setShowHelperSetupModal: state.setShowHelperSetupModal,
    loadedPaperInfo: state.loadedPaperInfo, isReadingRfid: state.isReadingRfid, readPrinterRfid: state.readPrinterRfid,
    printerBatteryLevel: state.printerBatteryLevel,
    helperInfo: state.helperInfo
  })));

  const [printers, setPrinters] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [showProjects, setShowProjects] = useState(true);
  const [showSavePresetModal, setShowSavePresetModal] = useState(false);
  const [showPresetPicker, setShowPresetPicker] = useState(false);
  const activePreset = useStore((state) => state.getActivePreset());

  const handleScan = useCallback(async (isManual = false) => {
    setIsScanning(true);
    try {
      const res = await apiFetch('/api/printers/scan');
      const data = await res.json();
      setPrinters(data.devices || []);

      if (data.devices && data.devices.length > 0 && !useStore.getState().selectedPrinter) {
        await setSelectedPrinter(data.devices[0].address, data.devices[0]);
      } else if (isManual && data.server_bluetooth_available === false) {
        alert('Server Bluetooth is not available in this environment.\n\nPlease use "Connect Browser Bluetooth" or the local Print Helper to connect directly from your device!');
      }
    } catch (e) {
      console.warn('Server Bluetooth scan failed:', e);
      if (isManual) {
        alert('Failed to scan for server printers. If running in a container, please connect directly from your device.');
      }
    }
    setIsScanning(false);
  }, [setSelectedPrinter]);

  const handleScanHelper = useCallback(async () => {
    setIsScanning(true);
    try {
      const devices = await scanViaBridge();
      setPrinters(devices || []);
      if (devices && devices.length > 0 && !useStore.getState().selectedPrinter) {
        await setSelectedPrinter(devices[0].address, devices[0]);
      }
    } catch (e) {
      console.error(e);
      alert(`Print Helper scan failed: ${e.message || e}`);
    }
    setIsScanning(false);
  }, [scanViaBridge, setSelectedPrinter]);

  useEffect(() => {
    let retryTimer = null;
    if (window.matchMedia('(max-width: 767px)').matches && !useStore.getState().isSidebarCollapsed) {
      useStore.getState().toggleSidebar();
    }
    useStore.getState().fetchProjects();
    useStore.getState().fetchSettings();
    useStore.getState().fetchAddresses();
    useStore.getState().fetchPresets();

    // If non-Chromium or helper mode, silently probe if helper is already running
    if (!webBluetoothSupported) {
      connectBridge().then((res) => {
        if (res && res.success) {
          handleScanHelper();
        }
      });
    }

    handleScan(false);

    return () => {
      if (retryTimer) clearInterval(retryTimer);
    };
  }, [handleScan, webBluetoothSupported, connectBridge, handleScanHelper]);

  const pageIndices = getPageIndices({ items, pageLayouts, currentPage });
  const pageCount = pageIndices.length;

  const handlePrintCollapsed = () => {
    toggleSidebar();
  };

  const handlePrintSingle = () => {
    printPages([pageIndices[0]]);
  };

  const handlePrintAll = () => {
    printPages(pageIndices);
  };

  const handlePrintSelected = () => {
    printPages(selectedPagesForPrint);
  };

  const SidebarButton = ({ icon: Icon, label, onClick, primary = false }) => (
    <button
      onClick={onClick}
      title={isSidebarCollapsed ? label : undefined}
      className={`w-full flex items-center ${isSidebarCollapsed ? 'justify-center' : 'justify-start'} gap-3 px-4 py-2.5 rounded-none transition-colors text-xs uppercase tracking-wider font-medium
        ${primary
          ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/40'
          : 'bg-transparent text-neutral-900 dark:text-white border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-900'}`}
    >
      <Icon size={16} className="shrink-0" />
      {!isSidebarCollapsed && <span className="truncate">{label}</span>}
    </button>
  );

  return (
    <div className={`${isSidebarCollapsed ? 'w-20' : 'w-72'} bg-white dark:bg-neutral-950 border-r border-neutral-200 dark:border-neutral-800 p-4 flex flex-col gap-6 z-10 overflow-y-auto overflow-x-hidden transition-all duration-300 shrink-0`}>
      <div className={`flex items-center ${isSidebarCollapsed ? 'justify-center' : 'justify-between'} mb-2`}>
        {!isSidebarCollapsed && (
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="/logo.webp"
              alt="OpenNiimStudio logo"
              className="w-9 h-9 object-contain shrink-0"
              draggable={false}
            />
            <h1 className="text-2xl font-serif tracking-tight text-neutral-900 dark:text-white truncate">OpenNiimStudio</h1>
          </div>
        )}
        <button type="button" onClick={toggleSidebar} aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} className="p-2 text-neutral-500 hover:text-neutral-900 dark:hover:text-white transition-colors flex-shrink-0">
          <Menu size={24} />
        </button>
      </div>

      {!isSidebarCollapsed && (
        <div className="flex gap-3 text-[10px] uppercase tracking-widest text-neutral-400 dark:text-neutral-500">
          <button onClick={() => setTheme('light')} className={`hover:text-neutral-900 dark:hover:text-white transition-colors ${theme === 'light' ? 'text-neutral-900 dark:text-white font-bold' : ''}`}>Light</button>
          <button onClick={() => setTheme('dark')} className={`hover:text-neutral-900 dark:hover:text-white transition-colors ${theme === 'dark' ? 'text-neutral-900 dark:text-white font-bold' : ''}`}>Dark</button>
          <button onClick={() => setTheme('auto')} className={`hover:text-neutral-900 dark:hover:text-white transition-colors ${theme === 'auto' ? 'text-neutral-900 dark:text-white font-bold' : ''}`}>Auto</button>
        </div>
      )}

      {!isSidebarCollapsed ? (
        <div className="space-y-3">
          <h2 className="text-[10px] font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-widest border-b border-neutral-100 dark:border-neutral-800 pb-2">Printers</h2>

          {/* Browser Detection & Compatibility Badge */}
          <div className="flex items-center justify-between text-[11px] px-2 py-1.5 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-none">
            <div className="flex items-center gap-1.5 truncate">
              <span className={`w-2 h-2 rounded-full shrink-0 ${webBluetoothSupported ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              <span className="font-semibold truncate text-neutral-800 dark:text-neutral-200">
                {browserCapability?.browser?.name || 'Browser'}
              </span>
            </div>
            <span className={`text-[9px] uppercase font-bold tracking-wider px-1 py-0.5 rounded-xs ${
              webBluetoothSupported
                ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400'
                : 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400'
            }`}>
              {webBluetoothSupported ? 'Direct BLE' : 'Helper Mode'}
            </span>
          </div>

          {/* Printer Connection Controls */}
          {webBluetoothSupported ? (
            /* Chromium Browsers: Native Web Bluetooth with Zero Install */
            webBluetoothSession ? (
              <div className="flex items-center justify-between p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-xs">
                <div className="flex items-center gap-2 truncate">
                  <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0 animate-pulse" />
                  <div className="flex flex-col truncate">
                    <span className="font-semibold truncate text-blue-700 dark:text-blue-300">
                      {webBluetoothSession.deviceName}
                    </span>
                    <span className="text-[10px] text-blue-500">Direct Web Bluetooth</span>
                  </div>
                </div>
                <button
                  onClick={disconnectWebBluetooth}
                  className="text-[10px] uppercase font-bold text-red-500 hover:text-red-700 transition-colors ml-2 shrink-0 px-1 py-0.5"
                  title="Disconnect Web Bluetooth"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                <SidebarButton icon={Bluetooth} label="Connect Browser Bluetooth" onClick={connectWebBluetooth} primary />
                <p className="text-[10px] text-neutral-400 dark:text-neutral-500 px-1">
                  Zero install: connects directly from {browserCapability?.browser?.name || 'your browser'}.
                </p>
              </div>
            )
          ) : (
            /* Non-Chromium (Firefox/Safari): Local Helper Companion */
            bridgeConnected ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between p-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-xs">
                  <div className="flex items-center gap-2 truncate">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
                    <div className="flex flex-col truncate">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="font-semibold truncate text-emerald-700 dark:text-emerald-300">
                          Print Helper Connected
                        </span>
                        <span className={`text-[9px] font-mono px-1 py-0.2 rounded font-bold shrink-0 ${
                          helperInfo?.buildType === 'binary' || helperInfo?.isFrozen
                            ? 'bg-emerald-200 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200'
                            : helperInfo?.buildType === 'python'
                            ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                            : 'bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300'
                        }`}>
                          {helperInfo?.buildType === 'binary' || helperInfo?.isFrozen
                            ? `v${helperInfo?.version || '0.3.0'} Binary`
                            : helperInfo?.buildType === 'python'
                            ? `v${helperInfo?.version || '0.3.0'} Python`
                            : 'Legacy Python'}
                        </span>
                      </div>
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400">Local Bluetooth Bridge</span>
                    </div>
                  </div>
                  <button
                    onClick={disconnectBridge}
                    className="text-[10px] uppercase font-bold text-neutral-400 hover:text-red-500 transition-colors ml-2 shrink-0"
                    title="Disconnect Helper"
                  >
                    Disconnect
                  </button>
                </div>
                <SidebarButton icon={Wifi} label={isScanning ? 'Scanning via Helper...' : 'Scan Local Printers'} onClick={handleScanHelper} primary />
              </div>
            ) : (
              <div className="space-y-1.5">
                <SidebarButton
                  icon={Radio}
                  label={bridgeChecking ? 'Connecting Helper...' : 'Launch Print Helper'}
                  onClick={async () => {
                    launchBridgeViaProtocol();
                    let count = 0;
                    const retryTimer = setInterval(async () => {
                      count++;
                      const res = await connectBridge();
                      if (res && res.success) {
                        clearInterval(retryTimer);
                        handleScanHelper();
                      } else if (count >= 6) {
                        clearInterval(retryTimer);
                      }
                    }, 1000);
                  }}
                  primary
                />
                <button
                  onClick={() => setShowHelperSetupModal(true)}
                  className="w-full text-center text-[10px] text-neutral-400 dark:text-neutral-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors flex items-center justify-center gap-1 py-0.5"
                >
                  <Settings2 size={11} /> First time? Setup Helper
                </button>
                <p className="text-[10px] text-neutral-400 dark:text-neutral-500 px-1 italic">
                  Tip: Use Chrome or Edge for zero-install direct printing.
                </p>
              </div>
            )
          )}

          {webBluetoothSupported && (
            <SidebarButton icon={Wifi} label={isScanning ? 'Scanning Server...' : 'Scan Server Printers'} onClick={() => handleScan(true)} />
          )}

          {isPrinting && webBluetoothProgress > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-blue-600 dark:text-blue-400 font-bold uppercase tracking-wider">
                <span>Sending to printer...</span>
                <span>{webBluetoothProgress}%</span>
              </div>
              <div className="w-full bg-neutral-200 dark:bg-neutral-800 h-1.5 rounded-full overflow-hidden">
                <div className="bg-blue-600 h-full transition-all duration-150" style={{ width: `${webBluetoothProgress}%` }} />
              </div>
            </div>
          )}

          {(printers.length > 0 || manualPrinters.length > 0) && (
            <PrinterDropdown
              printers={printers}
              manualPrinters={manualPrinters}
              selectedPrinter={selectedPrinter}
              onSelect={(mac, info) => {
                setSelectedPrinter(mac, info);
              }}
            />
          )}

          {/* Loaded Paper RFID detection card */}
          {selectedPrinter && (
            <div className="bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-2 text-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-bold text-neutral-800 dark:text-neutral-200 uppercase tracking-wider text-[10px]">
                  <Tag size={12} className="text-blue-500 shrink-0" />
                  <span>Loaded Roll (RFID)</span>
                </div>
                <button
                  type="button"
                  disabled={isReadingRfid}
                  onClick={() => readPrinterRfid()}
                  className="flex items-center gap-1 text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                  title="Re-read RFID chip on inserted label roll"
                >
                  <RefreshCw size={10} className={isReadingRfid ? 'animate-spin' : ''} />
                  <span>{isReadingRfid ? 'Reading...' : 'Re-read'}</span>
                </button>
              </div>

              {loadedPaperInfo?.tag_present === false ? (
                <div className="mt-1.5 space-y-0.5">
                  <div className="font-semibold text-neutral-800 dark:text-neutral-200 flex items-center gap-1.5 text-[11px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                    <span>Non-RFID Roll (Manual preset)</span>
                  </div>
                  <div className="text-[10px] text-neutral-500 dark:text-neutral-400">
                    Third-party label paper detected. Select dimensions in presets or canvas settings.
                  </div>
                </div>
              ) : loadedPaperInfo ? (
                <div className="mt-1.5 space-y-0.5">
                  <div className="font-semibold text-neutral-900 dark:text-white flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                    <span className="truncate">{loadedPaperInfo.preset_name || `${loadedPaperInfo.width_mm}x${loadedPaperInfo.height_mm}mm`}</span>
                  </div>
                  <div className="text-[10px] text-neutral-500 dark:text-neutral-400 flex items-center justify-between">
                    <span>Barcode: {loadedPaperInfo.barcode || 'Verified'}</span>
                    {typeof loadedPaperInfo.remaining_labels === 'number' && (
                      <span className="text-green-600 dark:text-green-400 font-bold">
                        {loadedPaperInfo.total_labels > 0
                          ? `${loadedPaperInfo.remaining_labels} / ${loadedPaperInfo.total_labels} left`
                          : `${loadedPaperInfo.remaining_labels} left`}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-1 text-[10px] text-neutral-400 dark:text-neutral-500 italic">
                  {isReadingRfid ? 'Reading RFID tag from printer...' : 'No RFID data yet. Click Re-read to detect paper.'}
                </div>
              )}

              {typeof printerBatteryLevel === 'number' && (
                <div className="mt-2 pt-1.5 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between text-[10px] text-neutral-500 dark:text-neutral-400">
                  <span className="font-semibold">Battery:</span>
                  <span className="font-bold text-neutral-700 dark:text-neutral-300">
                    {printerBatteryLevel}% (auto-refreshed 1m)
                  </span>
                </div>
              )}
            </div>
          )}

          {pageCount === 1 ? (
            <div className={`flex items-center w-full border ${isPrinting || !selectedPrinter ? 'opacity-50 cursor-not-allowed border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-900 text-neutral-500' : 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'} rounded-none transition-colors`}>
              <div className={`flex items-center border-r ${isPrinting || !selectedPrinter ? 'border-neutral-300 dark:border-neutral-700' : 'border-blue-200 dark:border-blue-800'}`}>
                <button disabled={isPrinting || !selectedPrinter} onClick={() => setPrintCopies(Math.max(1, printCopies - 1))} className="px-3 py-2.5 hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:pointer-events-none">-</button>
                <span className="text-xs font-bold w-6 text-center select-none">{printCopies}</span>
                <button disabled={isPrinting || !selectedPrinter} onClick={() => setPrintCopies(printCopies + 1)} className="px-3 py-2.5 hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:pointer-events-none">+</button>
              </div>
              <button disabled={isPrinting || !selectedPrinter} onClick={handlePrintSingle} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 hover:bg-black/5 dark:hover:bg-white/5 text-xs uppercase tracking-wider font-bold transition-colors disabled:pointer-events-none">
                <Printer size={16} /> {isPrinting ? 'Printing...' : 'Print'}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between px-1 mb-1">
                <span className="text-[10px] font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-widest">Copies per Label</span>
                <div className={`flex items-center border rounded-sm overflow-hidden ${isPrinting || !selectedPrinter ? 'border-neutral-300 dark:border-neutral-700 opacity-50' : 'border-neutral-300 dark:border-neutral-700'}`}>
                  <button disabled={isPrinting || !selectedPrinter} onClick={() => setPrintCopies(Math.max(1, printCopies - 1))} className="px-2 py-1 bg-neutral-100 dark:bg-neutral-900 hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors">-</button>
                  <span className="text-[10px] font-bold w-6 text-center select-none dark:text-white">{printCopies}</span>
                  <button disabled={isPrinting || !selectedPrinter} onClick={() => setPrintCopies(printCopies + 1)} className="px-2 py-1 bg-neutral-100 dark:bg-neutral-900 hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors">+</button>
                </div>
              </div>
              <button disabled={isPrinting || !selectedPrinter} onClick={handlePrintAll} className={`flex items-center justify-center gap-2 w-full border px-4 py-2.5 text-xs uppercase tracking-wider font-bold transition-colors ${isPrinting || !selectedPrinter ? 'opacity-50 cursor-not-allowed border-neutral-300 bg-neutral-100 text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900' : 'border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/40'}`}>
                <Printer size={16} /> Print All ({pageCount})
              </button>
              <button disabled={isPrinting || !selectedPrinter || selectedPagesForPrint.length === 0} onClick={handlePrintSelected} className={`flex items-center justify-center gap-2 w-full border px-4 py-2.5 text-xs uppercase tracking-wider font-bold transition-colors ${isPrinting || !selectedPrinter || selectedPagesForPrint.length === 0 ? 'opacity-50 cursor-not-allowed border-neutral-300 bg-transparent text-neutral-400 dark:border-neutral-800 dark:text-neutral-600' : 'border-blue-200 bg-transparent text-blue-600 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-900/20'}`}>
                <Printer size={16} /> Print Selected ({selectedPagesForPrint.length})
              </button>
            </div>
          )}
        </div>
      ) : (
        <SidebarButton icon={Printer} label="Print Options" onClick={handlePrintCollapsed} primary />
      )}

      {!isSidebarCollapsed ? (
        <div className="space-y-3">
          <h2 className="text-[10px] font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-widest border-b border-neutral-100 dark:border-neutral-800 pb-2">Canvas Presets</h2>
          <button
            onClick={() => setShowPresetPicker(true)}
            className="w-full flex items-center justify-between bg-neutral-50 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-none p-2 text-xs text-neutral-900 dark:text-white hover:border-blue-500 transition-colors mb-2"
          >
            <span className="truncate pr-2">
              {activePreset ? `${activePreset.name} (${activePreset.width_mm}x${activePreset.height_mm}mm)` : 'Custom Size (Unsaved)'}
            </span>
            <ChevronDown size={14} className="text-neutral-500 shrink-0" />
          </button>

          <button
            onClick={() => setShowSavePresetModal(true)}
            className="w-full text-[10px] uppercase font-bold text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 py-1.5 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
          >
            Save Current as Preset
          </button>
        </div>
      ) : (
        <SidebarButton icon={LayoutTemplate} label="Presets (Expand to view)" onClick={toggleSidebar} />
      )}

      {isSidebarCollapsed ? (
        <SidebarButton icon={Archive} label="Saved Projects (Expand to view)" onClick={toggleSidebar} />
      ) : (
        <div className="space-y-3">
          <button
            type="button"
            aria-expanded={showProjects}
            className="flex w-full items-center justify-between cursor-pointer border-b border-neutral-100 dark:border-neutral-800 pb-2 group"
            onClick={() => setShowProjects(!showProjects)}
          >
            <h2 className="text-[10px] font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-widest group-hover:text-neutral-900 dark:group-hover:text-white transition-colors">Saved Projects</h2>
            {showProjects ? (
              <ChevronDown size={14} className="text-neutral-400 group-hover:text-neutral-900 dark:group-hover:text-white transition-colors" />
            ) : (
              <ChevronRight size={14} className="text-neutral-400 group-hover:text-neutral-900 dark:group-hover:text-white transition-colors" />
            )}
          </button>

          {showProjects && (
            <ProjectTree />
          )}
        </div>
      )}

      {showSavePresetModal && (
        <SavePresetModal onClose={() => setShowSavePresetModal(false)} />
      )}
      {showPresetPicker && (
        <PresetPickerModal onClose={() => setShowPresetPicker(false)} />
      )}

      {/* Footer: Bottom Left Version Information */}
      <div className="mt-auto pt-4 border-t border-neutral-200 dark:border-neutral-800 flex flex-col gap-1 text-[11px] text-neutral-400 dark:text-neutral-500">
        {!isSidebarCollapsed ? (
          <>
            <div className="flex items-center justify-between">
              <span className="font-medium text-neutral-700 dark:text-neutral-300">OpenNiimStudio</span>
              <span className="font-mono text-[10px] bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 px-1.5 py-0.5 rounded border border-neutral-200 dark:border-neutral-700">
                v0.3.0
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-neutral-500">Print Helper</span>
              {bridgeConnected ? (
                <span className={`inline-flex items-center gap-1 font-mono text-[9px] px-1.5 py-0.5 rounded font-medium ${
                  helperInfo?.buildType === 'binary' || helperInfo?.isFrozen
                    ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800'
                    : helperInfo?.buildType === 'python'
                    ? 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400 border border-blue-300 dark:border-blue-800'
                    : 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-800'
                }`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                  {helperInfo?.buildType === 'binary' || helperInfo?.isFrozen
                    ? `v${helperInfo?.version || '0.3.0'} (Binary)`
                    : helperInfo?.buildType === 'python'
                    ? `v${helperInfo?.version || '0.3.0'} (Python)`
                    : 'Legacy Python'}
                </span>
              ) : (
                <span className="text-neutral-400 dark:text-neutral-600 italic">
                  Not running
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-1 text-[9px] font-mono text-center" title={`OpenNiimStudio v0.3.0\nHelper: ${bridgeConnected ? (helperInfo?.buildType === 'binary' ? 'Binary' : 'Python') : 'Inactive'}`}>
            <span>v0.3.0</span>
            <span className={`w-2 h-2 rounded-full ${bridgeConnected ? 'bg-emerald-500' : 'bg-neutral-300 dark:bg-neutral-700'}`} />
          </div>
        )}
      </div>
      <HelperSetupModal
        isOpen={showHelperSetupModal}
        onClose={() => setShowHelperSetupModal(false)}
        onConnected={() => {
          connectBridge();
          setShowHelperSetupModal(false);
        }}
      />
    </div>
  );
}
