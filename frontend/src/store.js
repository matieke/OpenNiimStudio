import { create } from 'zustand';
import { calculateAutoFitItem } from './utils/rendering';
import { describePrintError } from './utils/apiErrors';
import { apiFetch, apiJson, isArrayPayload, isObjectPayload } from './utils/apiClient';
import { buildLabelTemplateMarkup } from './components/templateStyles';
import { getItemSectionBounds, normalizePageIndex } from './utils/canvasPages';
import {
  buildBatchMatrix,
  buildBatchSequence,
  getPrintJobCount,
  getRenderPixelCount,
  MAX_BATCH_RECORDS,
  MAX_PRINT_COPIES,
  MAX_PRINT_JOBS,
  MAX_RENDER_PIXELS
} from './utils/batchData';
import {
  loadClientSettings,
  saveClientSettings,
  loadClientProjects,
  saveClientProjects,
  loadClientCategories,
  saveClientCategories,
  loadClientPrinterProfile,
  saveClientPrinterProfile,
  loadClientRfidPresets,
  saveClientRfidPreset,
  exportAllClientData,
  importAllClientData,
  DEFAULT_SETTINGS
} from './utils/clientStorage';
import {
  isWebBluetoothSupported,
  connectWebBluetoothPrinter,
  disconnectWebBluetoothPrinter,
  printViaWebBluetooth,
  getWebBluetoothRfidInfo,
  getWebBluetoothBatteryLevel
} from './utils/webBluetoothClient';
import {
  checkBridgeStatus,
  launchBridgeViaProtocol,
  LocalBridgeClient
} from './utils/localBridgeClient';
import { getBluetoothCapability } from './utils/browserDetection';

const recalcAutoFit = (items, batchRecords, cw, ch, splitSections) => {
  let changed = false;

  const nextItems = items.map((item) => {
    if (item.fit_to_width) {
      const bounds = getItemSectionBounds(item, cw, ch, splitSections);
      const optimizedItem = calculateAutoFitItem(item, batchRecords, bounds.width, bounds.height);
      if (optimizedItem.size !== item.size) {
        changed = true;
        return optimizedItem;
      }
    }
    return item;
  });

  return changed ? nextItems : items;
};

const buildTemplateHtml = (templateId, params = {}, width = 384, height = 384) =>
  buildLabelTemplateMarkup({ template_id: templateId, params, width, height }, {});

const errorMessage = (error, fallback) => error?.message || fallback;

let printerProfileRequestId = 0;

const scaleItemForDpi = (item, scale) => {
  const scalableKeys = [
    'x', 'y', 'width', 'height', 'size', 'padding', 'border_thickness', 'strokeWidth',
    'icon_size', 'icon_x', 'icon_y', 'text_x', 'text_y'
  ];
  const nextItem = { ...item };
  scalableKeys.forEach((key) => {
    if (typeof nextItem[key] === 'number' && Number.isFinite(nextItem[key])) {
      nextItem[key] = nextItem[key] * scale;
    }
  });
  if (Array.isArray(item.children)) {
    nextItem.children = item.children.map((child) => scaleItemForDpi(child, scale));
  }
  return nextItem;
};

const normalizeCanvasState = (canvasState = {}) => {
  const items = Array.isArray(canvasState.items)
    ? canvasState.items.filter((item) => item && typeof item === 'object')
    : [];
  let pageLayouts = canvasState.pageLayouts;

  // Migration from old single-template/HTML structure
  if (!pageLayouts || pageLayouts.length === 0) {
    const activeTemplate = canvasState.activeTemplate || null;
    const htmlContent = canvasState.htmlContent || '';
    
    if (activeTemplate?.id) {
      pageLayouts = [{
        pageIndex: 0,
        activeTemplate,
        htmlContent: buildTemplateHtml(activeTemplate.id, activeTemplate.params || {}, canvasState.width || 384, canvasState.height || 384)
      }];
    } else {
      pageLayouts = [{ pageIndex: 0, htmlContent, activeTemplate: null }];
    }
  }

  const legacyTemplateItem = items.length === 1 && items[0]?.type === 'label_template' ? items[0] : null;
  if (legacyTemplateItem) {
    const templateId = legacyTemplateItem.template_id || 'title_subtitle';
    const params = legacyTemplateItem.params || {};
    return {
      ...canvasState,
      pageLayouts: [{
        pageIndex: 0,
        activeTemplate: { id: templateId, params },
        htmlContent: buildTemplateHtml(templateId, params, canvasState.width || 384, canvasState.height || 384)
      }],
      items: []
    };
  }

  return {
    ...canvasState,
    pageLayouts
  };
};

const buildCanvasDocumentPatch = (canvasState = {}, currentState = {}) => {
  const normalized = normalizeCanvasState(canvasState);
  const width = Math.min(20_000, Math.max(1, Number(normalized.width ?? currentState.canvasWidth) || 384));
  const height = Math.min(20_000, Math.max(1, Number(normalized.height ?? currentState.canvasHeight) || 384));
  const normalizedBatchRecords = Array.isArray(normalized.batchRecords)
    ? normalized.batchRecords.filter((record) => record && typeof record === 'object').slice(0, MAX_BATCH_RECORDS)
    : [];
  const batchRecords = normalizedBatchRecords.length ? normalizedBatchRecords : [{}];
  const rawPageLayouts = (Array.isArray(normalized.pageLayouts) && normalized.pageLayouts.length
    ? normalized.pageLayouts
    : [{ pageIndex: 0, htmlContent: '', activeTemplate: null }]
  ).filter((layout) => layout && typeof layout === 'object').map((layout) => {
    const pageIndex = normalizePageIndex(layout?.pageIndex);
    if (!layout?.activeTemplate?.id) {
      return {
        ...layout,
        pageIndex,
        htmlContent: typeof layout.htmlContent === 'string' ? layout.htmlContent : '',
        activeTemplate: null
      };
    }

    return {
      ...layout,
      pageIndex,
      htmlContent: buildTemplateHtml(
        layout.activeTemplate.id,
        layout.activeTemplate.params || {},
        width,
        height
      )
    };
  });
  const pageLayouts = [...new Map(rawPageLayouts.map((layout) => [layout.pageIndex, layout])).values()];
  if (pageLayouts.length === 0) pageLayouts.push({ pageIndex: 0, htmlContent: '', activeTemplate: null });
  const items = (normalized.items || []).map((item, index) => ({
    ...item,
    id: String(item.id ?? `recovered-${index}`),
    pageIndex: normalizePageIndex(item.pageIndex)
  }));
  const allowedBorders = new Set(['none', 'box', 'top', 'bottom', 'cut_line']);

  return {
    canvasWidth: width,
    canvasHeight: height,
    canvasBorder: allowedBorders.has(normalized.canvasBorder) ? normalized.canvasBorder : 'none',
    canvasBorderThickness: Math.max(1, Number(normalized.canvasBorderThickness) || 4),
    splitSections: {
      enabled: Boolean(normalized.splitSections?.enabled),
      rows: Math.min(6, Math.max(1, Number(normalized.splitSections?.rows) || 1)),
      cols: Math.min(6, Math.max(1, Number(normalized.splitSections?.cols) || 2)),
      printCutLines: normalized.splitSections?.printCutLines !== undefined ? Boolean(normalized.splitSections.printCutLines) : true,
      cutLineStyle: ['dashed', 'solid'].includes(normalized.splitSections?.cutLineStyle) ? normalized.splitSections.cutLineStyle : 'dashed',
      showGuides: normalized.splitSections?.showGuides !== undefined ? Boolean(normalized.splitSections.showGuides) : true,
    },
    splitMode: Boolean(normalized.splitMode),
    pageLayouts,
    isRotated: Boolean(normalized.isRotated),
    batchRecords,
    printCopies: Math.min(MAX_PRINT_COPIES, Math.max(1, Number(normalized.printCopies) || 1)),
    currentPage: normalizePageIndex(normalized.currentPage),
    items: recalcAutoFit(items, batchRecords, width, height),
    selectedId: null,
    selectedIds: [],
    selectedPagesForPrint: []
  };
};

const withHistory = (config) => {
  let historyTimeout;
  let storedPrevState = null;

  return (set, get, api) => {
    const historySet = (args, replace, options = {}) => {
      if (options.history === 'reset') {
        clearTimeout(historyTimeout);
        storedPrevState = null;
        set(args, replace);
        set({
          history: [],
          historyIndex: -1,
          canUndo: false,
          canRedo: false,
          _isUndoRedo: false
        });
        return;
      }

      if (options.history === 'skip') {
        set(args, replace);
        return;
      }

      if (!storedPrevState) {
        storedPrevState = get();
      }

      set(args, replace);
      const nextState = get();

      // If this change was triggered by undo/redo, strip the flag, reset the baseline, and exit.
      if (nextState._isUndoRedo) {
        set({ _isUndoRedo: false });
        storedPrevState = null;
        return;
      }

      clearTimeout(historyTimeout);
      historyTimeout = setTimeout(() => {
        const finalState = get();
        const relevantKeys = [
          'items',
          'canvasWidth',
          'canvasHeight',
          'isRotated',
          'splitMode',
          'canvasBorder',
          'canvasBorderThickness',
          'splitSections',
          'pageLayouts',
          'batchRecords'
        ];
        let changed = false;

        for (const key of relevantKeys) {
          if (storedPrevState[key] !== finalState[key]) {
            changed = true;
            break;
          }
        }

        if (changed) {
          const snap = {};
          for (const key of relevantKeys) {
            snap[key] = finalState[key];
          }

          const currentHistory = finalState.history || [];
          const currentIndex = finalState.historyIndex !== undefined ? finalState.historyIndex : -1;

          // Truncate future history if the user makes a new change after undoing
          let newHistory = currentHistory.slice(0, currentIndex + 1);

          // If this is the very first change, push the original baseline state first
          if (newHistory.length === 0) {
            const prevSnap = {};
            for (const key of relevantKeys) {
              prevSnap[key] = storedPrevState[key];
            }
            newHistory.push(prevSnap);
          }

          newHistory.push(snap);
          
          // Limit stack to 50 items to prevent memory bloat
          if (newHistory.length > 50) newHistory.shift();

          set({
            history: newHistory,
            historyIndex: newHistory.length - 1,
            canUndo: newHistory.length > 1,
            canRedo: false
          });
        }

        storedPrevState = null;
      }, 400);
    };

    return config(historySet, get, api);
  };
};

export const useStore = create(withHistory((set, get) => ({
  history: [],
  historyIndex: -1,
  canUndo: false,
  canRedo: false,
  
  undo: () => set((state) => {
    if (state.historyIndex > 0) {
      const newIndex = state.historyIndex - 1;
      const snap = state.history[newIndex];
      return {
        ...snap,
        historyIndex: newIndex,
        selectedId: null,
        selectedIds: [],
        _isUndoRedo: true,
        canUndo: newIndex > 0,
        canRedo: true
      };
    }
    return state;
  }),

  redo: () => set((state) => {
    if (state.history && state.historyIndex < state.history.length - 1) {
      const newIndex = state.historyIndex + 1;
      const snap = state.history[newIndex];
      return {
        ...snap,
        historyIndex: newIndex,
        selectedId: null,
        selectedIds: [],
        _isUndoRedo: true,
        canUndo: true,
        canRedo: newIndex < state.history.length - 1
      };
    }
    return state;
  }),
  items: [],
  selectedId: null,
  selectedIds: [],
  zoomScale: 1,
  canvasWidth: 320,
  canvasHeight: 96,
  canvasBorder: 'none',
  canvasBorderThickness: 4,
  splitSections: {
    enabled: false,
    rows: 1,
    cols: 2,
    printCutLines: true,
    cutLineStyle: 'dashed',
    showGuides: true
  },
  splitMode: false,
  isRotated: true,
  selectedPrinter: null,
  selectedPrinterInfo: null,
  webBluetoothSession: null,
  webBluetoothProgress: 0,
  printerBatteryLevel: null,
  batteryPollTimer: null,
  browserCapability: typeof window !== 'undefined' ? getBluetoothCapability() : null,
  webBluetoothSupported: typeof window !== 'undefined' && isWebBluetoothSupported(),
  bridgeClient: null,
  bridgeConnected: false,
  bridgeChecking: false,
  helperInfo: null,
  showHelperSetupModal: false,
  setShowHelperSetupModal: (val) => set({ showHelperSetupModal: val }),
  pageLayouts: [{ pageIndex: 0, htmlContent: '', activeTemplate: null }],
  loadedPaperInfo: null,
  isReadingRfid: false,
  setLoadedPaperInfo: (val) => set({ loadedPaperInfo: val }),
  showAiConfig: false,
  setShowAiConfig: (val) => set({ showAiConfig: val }),
  apiError: '',
  clearApiError: () => set({ apiError: '' }),

  setSplitSections: (val) => set((state) => {
    const nextSplit = typeof val === 'function' ? val(state.splitSections) : { ...state.splitSections, ...val };
    return {
      splitSections: nextSplit,
      items: recalcAutoFit(state.items, state.batchRecords, state.canvasWidth, state.canvasHeight, nextSplit)
    };
  }),

  replicateSection: (sourceIndex = 0) => set((state) => {
    const split = state.splitSections;
    if (!split?.enabled) return {};
    const rows = Math.min(6, Math.max(1, Number(split.rows) || 1));
    const cols = Math.min(6, Math.max(1, Number(split.cols) || 1));
    if (rows <= 1 && cols <= 1) return {};

    const cellW = state.canvasWidth / cols;
    const cellH = state.canvasHeight / rows;
    const srcRow = Math.floor(sourceIndex / cols);
    const srcCol = sourceIndex % cols;
    const srcMinX = srcCol * cellW;
    const srcMaxX = srcMinX + cellW;
    const srcMinY = srcRow * cellH;
    const srcMaxY = srcMinY + cellH;

    const pageItems = state.items.filter((it) => it.pageIndex === state.currentPage);
    const otherPageItems = state.items.filter((it) => it.pageIndex !== state.currentPage);

    const isInsideCell = (it, cMinX, cMaxX, cMinY, cMaxY) => {
      const itemW = it.width || 50;
      const itemH = it.height || 30;
      const cx = it.x + itemW / 2;
      const cy = it.y + itemH / 2;
      return cx >= cMinX && cx < cMaxX && cy >= cMinY && cy < cMaxY;
    };

    const sourceItems = pageItems.filter((it) => isInsideCell(it, srcMinX, srcMaxX, srcMinY, srcMaxY));
    if (sourceItems.length === 0) return {};

    const totalCells = rows * cols;
    const replicated = [];

    for (let idx = 0; idx < totalCells; idx++) {
      if (idx === sourceIndex) continue;
      const r = Math.floor(idx / cols);
      const c = idx % cols;
      const dx = (c - srcCol) * cellW;
      const dy = (r - srcRow) * cellH;

      for (const srcItem of sourceItems) {
        replicated.push({
          ...srcItem,
          id: `${srcItem.type}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
          x: Math.round(srcItem.x + dx),
          y: Math.round(srcItem.y + dy)
        });
      }
    }

    return {
      items: [...otherPageItems, ...sourceItems, ...replicated]
    };
  }),
  
  setHtmlContent: (val) => set((state) => {
    const layouts = [...state.pageLayouts];
    const idx = layouts.findIndex(l => l.pageIndex === state.currentPage);
    if (idx >= 0) layouts[idx] = { ...layouts[idx], htmlContent: val, activeTemplate: null };
    else layouts.push({ pageIndex: state.currentPage, htmlContent: val, activeTemplate: null });
    return { pageLayouts: layouts };
  }),
  
  setTemplateConfig: (id, params = {}) => set((state) => ({
    pageLayouts: [...state.pageLayouts.filter(l => l.pageIndex !== state.currentPage), {
      pageIndex: state.currentPage,
      activeTemplate: { id, params },
      htmlContent: buildTemplateHtml(id, params, state.canvasWidth, state.canvasHeight)
    }]
  })),
  
  updateTemplateParams: (newParams) => set((state) => {
    const layout = state.pageLayouts.find(l => l.pageIndex === state.currentPage);
    if (!layout || !layout.activeTemplate) return state;
    const params = { ...layout.activeTemplate.params, ...newParams };
    
    const layouts = [...state.pageLayouts];
    const idx = layouts.findIndex(l => l.pageIndex === state.currentPage);
    layouts[idx] = {
      ...layout,
      activeTemplate: { ...layout.activeTemplate, params },
      htmlContent: buildTemplateHtml(layout.activeTemplate.id, params, state.canvasWidth, state.canvasHeight)
    };
    return { pageLayouts: layouts };
  }),
  
  ejectTemplate: () => set((state) => {
    const layouts = [...state.pageLayouts];
    const idx = layouts.findIndex(l => l.pageIndex === state.currentPage);
    if (idx >= 0) layouts[idx] = { ...layouts[idx], activeTemplate: null };
    return { pageLayouts: layouts };
  }),
  getStageB64: async () => {
    if (typeof window !== 'undefined' && window.__getStageB64) {
      return await window.__getStageB64();
    }
    return null;
  },
  setZoomScale: (scale) => set({ zoomScale: Math.max(0.1, Math.min(5, scale)) }),
  manualPrinters: (() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem('openniim_manual_printers') || window.localStorage.getItem('catlabel_manual_printers');
      const saved = JSON.parse(raw || '[]');
      return Array.isArray(saved)
        ? saved.filter((printer) => printer && typeof printer === 'object' && typeof printer.address === 'string').slice(0, 100)
        : [];
    } catch (e) {
      console.error('Failed to load manual printers', e);
      return [];
    }
  })(),
  addManualPrinter: (printer) => set((state) => {
    const newManual = [...state.manualPrinters.filter((p) => p.address !== printer.address), printer];
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('openniim_manual_printers', JSON.stringify(newManual));
    }
    return { manualPrinters: newManual };
  }),
  removeManualPrinter: (address) => set((state) => {
    const newManual = state.manualPrinters.filter((p) => p.address !== address);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('openniim_manual_printers', JSON.stringify(newManual));
    }
    return { manualPrinters: newManual };
  }),
  connectWebBluetooth: async () => {
    try {
      const session = await connectWebBluetoothPrinter();
      const printerObj = {
        address: session.address,
        name: session.deviceName,
        model_id: session.model_id,
        vendor: session.vendor,
        transport: 'web_bluetooth',
        dpi: session.dpi,
        paired: true,
        width_mm: Math.round(session.dpi === 300 ? 50 : 48),
      };
      set((state) => {
        const newManual = [...state.manualPrinters.filter((p) => p.address !== session.address), printerObj];
        if (typeof window !== 'undefined') {
          try {
            window.localStorage.setItem('openniim_manual_printers', JSON.stringify(newManual));
          } catch (_e) {}
        }
        return {
          webBluetoothSession: session,
          manualPrinters: newManual,
          selectedPrinter: session.address,
          selectedPrinterInfo: printerObj,
          printerBatteryLevel: session.battery_level ?? state.printerBatteryLevel,
        };
      });
      await get().setSelectedPrinter(session.address, printerObj);
      return { success: true, session };
    } catch (e) {
      console.error('Web Bluetooth connection failed:', e);
      alert(`Could not connect via Web Bluetooth:\n\n${e.message || e}`);
      return { success: false, error: e };
    }
  },
  disconnectWebBluetooth: async () => {
    get().stopBatteryPolling();
    const session = get().webBluetoothSession;
    if (session) {
      await disconnectWebBluetoothPrinter(session.client);
      set({ webBluetoothSession: null, printerBatteryLevel: null });
    }
  },
  connectBridge: async () => {
    set({ bridgeChecking: true });
    try {
      const existing = get().bridgeClient;
      if (existing && existing.isConnected) {
        set({ bridgeConnected: true, bridgeChecking: false, helperInfo: existing.helperInfo || get().helperInfo });
        return { success: true };
      }

      const client = new LocalBridgeClient();
      client.onInfo = (info) => {
        set({ helperInfo: info });
      };
      client.onDisconnect = () => {
        set({ bridgeConnected: false, bridgeClient: null, helperInfo: null });
      };
      await client.connect();

      // Probe bridge status to get helperInfo if greeting already completed
      const status = await checkBridgeStatus(400);
      const helperInfo = client.helperInfo || status.helperInfo;

      set({ bridgeClient: client, bridgeConnected: true, bridgeChecking: false, helperInfo });
      return { success: true, helperInfo };
    } catch (e) {
      set({ bridgeConnected: false, bridgeChecking: false, helperInfo: null });
      return { success: false, error: e };
    }
  },
  disconnectBridge: () => {
    const client = get().bridgeClient;
    if (client) {
      client.disconnect();
    }
    set({ bridgeClient: null, bridgeConnected: false, helperInfo: null });
  },
  launchBridgeHelper: () => {
    launchBridgeViaProtocol();
    setTimeout(() => {
      get().connectBridge();
    }, 1500);
  },
  scanViaBridge: async () => {
    const client = get().bridgeClient;
    if (!client || !client.isConnected) {
      throw new Error('Helper bridge not connected');
    }
    return client.scanPrinters();
  },
  batchRecords: [{}],
  printCopies: 1,
  theme: 'auto',
  dither: true,
  setDither: (val) => set({ dither: val }),
  fonts: [],
  labelPresets: [],
  currentDpi: 203,
  printerProfile: { speed: 0, energy: 0, feed_lines: 50, paper_mode: null },
  currentPage: 0,
  
  setCurrentPage: (idx) => set({ currentPage: Math.max(0, Number(idx) || 0), selectedId: null, selectedIds: [] }),
  
  addPage: () => set((state) => {
    const maxPage = Math.max(
      state.currentPage,
      ...state.items.map((item) => Number(item.pageIndex ?? 0)),
      ...state.pageLayouts.map((l) => Number(l.pageIndex ?? 0))
    );
    return { 
      currentPage: maxPage + 1, 
      pageLayouts: [...state.pageLayouts, { pageIndex: maxPage + 1, htmlContent: '', activeTemplate: null }],
      selectedId: null, 
      selectedIds: [] 
    };
  }),
  
  deletePage: (pageIndex) => set((state) => {
    const targetPage = Math.max(0, Number(pageIndex) || 0);

    const newItems = state.items
      .filter((item) => Number(item.pageIndex ?? 0) !== targetPage)
      .map((item) => {
        const itemPage = Number(item.pageIndex ?? 0);
        return itemPage > targetPage ? { ...item, pageIndex: itemPage - 1 } : item;
      });
      
    const newLayouts = state.pageLayouts
      .filter(l => l.pageIndex !== targetPage)
      .map(l => l.pageIndex > targetPage ? { ...l, pageIndex: l.pageIndex - 1 } : l);
    
    if (newLayouts.length === 0) newLayouts.push({ pageIndex: 0, htmlContent: '', activeTemplate: null });

    const adjustedCurrentPage = state.currentPage > targetPage
      ? state.currentPage - 1
      : state.currentPage === targetPage
        ? Math.max(0, targetPage - 1)
        : state.currentPage;

    const newSelectedPages = state.selectedPagesForPrint
      .filter((p) => p !== targetPage)
      .map((p) => (p > targetPage ? p - 1 : p));

    return {
      items: newItems,
      pageLayouts: newLayouts,
      currentPage: adjustedCurrentPage,
      selectedId: null,
      selectedIds: [],
      selectedPagesForPrint: newSelectedPages
    };
  }),
  
  duplicatePage: (pageIndex) => set((state) => {
    const targetPage = Math.max(0, Number(pageIndex) || 0);

    const itemsToClone = state.items.filter((item) => Number(item.pageIndex ?? 0) === targetPage);
    const layoutToClone = state.pageLayouts.find(l => l.pageIndex === targetPage) || { htmlContent: '' };
    
    const maxPage = Math.max(
      state.currentPage,
      ...state.items.map((item) => Number(item.pageIndex ?? 0)),
      ...state.pageLayouts.map((l) => Number(l.pageIndex ?? 0))
    );
    const newPageIdx = maxPage + 1;

    const clones = itemsToClone.map((item) => ({
      ...item,
      id: Date.now().toString() + '-' + Math.random().toString(36).substring(2, 7),
      pageIndex: newPageIdx
    }));

    return {
      items: [...state.items, ...clones],
      pageLayouts: [...state.pageLayouts, { ...layoutToClone, pageIndex: newPageIdx }],
      currentPage: newPageIdx,
      selectedId: null,
      selectedIds: []
    };
  }),

  selectedPagesForPrint: [],
  isPreparingForPrint: false,
  pendingPrintJob: null,
  isPrinting: false,
  setIsPrinting: (val) => set({ isPrinting: val }),
  
  togglePageForPrint: (pageIndex) => set((state) => {
    const current = state.selectedPagesForPrint;
    if (current.includes(pageIndex)) {
      return { selectedPagesForPrint: current.filter((p) => p !== pageIndex) };
    }
    return { selectedPagesForPrint: [...current, pageIndex] };
  }),

  printPages: async (pageIndices) => {
    const state = get();

    if (state.isPreparingForPrint || state.isPrinting) {
      return;
    }

    if (!state.selectedPrinter) {
      alert("Please select a printer first!");
      return;
    }

    if (state.selectedPrinterInfo?.transport === 'offline') {
      alert("This is an offline/manual printer profile. Scan and select a connected printer before printing.");
      return;
    }

    const normalizedPageIndices = Array.from(
      new Set((pageIndices || []).map((pageIndex) => Math.max(0, Number(pageIndex) || 0)))
    ).sort((a, b) => a - b);
    if (normalizedPageIndices.length === 0) return;

    const printJobCount = getPrintJobCount({
      records: state.batchRecords?.length || 1,
      copies: state.printCopies || 1,
      pages: normalizedPageIndices.length
    });
    if (printJobCount > MAX_PRINT_JOBS) {
      alert(
        `This print request would create ${printJobCount.toLocaleString()} labels. `
        + `Reduce pages, records, or copies to ${MAX_PRINT_JOBS.toLocaleString()} jobs or fewer.`
      );
      return;
    }
    const renderPixels = getRenderPixelCount({
      width: state.canvasWidth,
      height: state.canvasHeight,
      jobs: printJobCount
    });
    if (renderPixels > MAX_RENDER_PIXELS) {
      alert(
        'This print request is too large to render safely in memory. '
        + 'Reduce the label dimensions, pages, records, or copies and try again.'
      );
      return;
    }

    let itemsToPrint = state.items;
    let finalBatchRecords = state.batchRecords || [{}];
    let finalPageIndices = normalizedPageIndices;

    itemsToPrint = state.items.filter((item) =>
      normalizedPageIndices.includes(Number(item.pageIndex ?? 0))
    );

    set({
      isPreparingForPrint: true,
      pendingPrintJob: {
        macAddress: state.selectedPrinter,
        splitMode: state.splitMode,
        pageIndices: finalPageIndices,
        copies: state.printCopies || 1,
        batchRecords: finalBatchRecords,
        dither: state.dither,
        canvasState: {
          width: state.canvasWidth,
          height: state.canvasHeight,
          isRotated: state.isRotated,
          canvasBorder: state.canvasBorder,
          canvasBorderThickness: state.canvasBorderThickness || 4,
          splitSections: state.splitSections,
          splitMode: state.splitMode,
          pageLayouts: state.pageLayouts,
          items: itemsToPrint
        }
      }
    });
  },

  onLocalRenderComplete: async (images, renderError = null) => {
    const state = get();
    const pendingPrintJob = state.pendingPrintJob;

    set({ isPreparingForPrint: false });

    if (!pendingPrintJob) {
      return;
    }

    if (renderError) {
      set({ pendingPrintJob: null });
      alert(`Failed to prepare labels for printing:\n\n${renderError.message || renderError}`);
      return;
    }

    if (!images || images.length === 0) {
      set({ pendingPrintJob: null });
      return;
    }

    set({ isPrinting: true, webBluetoothProgress: 0 });

    const physicalStickersUsed = (pendingPrintJob.copies || 1) * images.length;
    const registerPrintSuccess = () => {
      // 1. Immediate optimistic decrement on UI
      set((prev) => {
        if (!prev.loadedPaperInfo || typeof prev.loadedPaperInfo.remaining_labels !== 'number') {
          return {};
        }
        const currentRemaining = prev.loadedPaperInfo.remaining_labels;
        const currentUsed = prev.loadedPaperInfo.used_labels || 0;
        return {
          loadedPaperInfo: {
            ...prev.loadedPaperInfo,
            remaining_labels: Math.max(0, currentRemaining - physicalStickersUsed),
            used_labels: currentUsed + physicalStickersUsed,
          }
        };
      });
      // 2. Hardware RFID sync after paper feeding settles
      setTimeout(() => {
        get().readPrinterRfid().catch((err) => console.warn('Background RFID sync error:', err));
      }, 2000);
    };

    const isWebBle = Boolean(
      state.webBluetoothSession &&
      (state.selectedPrinter === state.webBluetoothSession.address ||
       state.selectedPrinterInfo?.transport === 'web_bluetooth')
    );

    if (isWebBle) {
      try {
        await printViaWebBluetooth(state.webBluetoothSession.client, images, {
          copies: pendingPrintJob.copies || 1,
          isRotated: pendingPrintJob.canvasState.isRotated || false,
          density: state.printerProfile?.energy || 3,
          onProgress: (p) => set({ webBluetoothProgress: p })
        });
        registerPrintSuccess();
      } catch (e) {
        console.error('Web Bluetooth print error:', e);
        alert(`Failed to print via Web Bluetooth:\n\n${e.message || e}`);
      } finally {
        set({ isPrinting: false, pendingPrintJob: null, webBluetoothProgress: 0 });
      }
      return;
    }

    if (state.bridgeConnected && state.bridgeClient) {
      try {
        await state.bridgeClient.printImages({
          mac_address: pendingPrintJob.macAddress,
          images,
          split_mode: pendingPrintJob.splitMode,
          dither: pendingPrintJob.dither
        }, (p) => {
          set({ webBluetoothProgress: p });
        });
        registerPrintSuccess();
      } catch (e) {
        console.error('Print Helper error:', e);
        alert(`Failed to print via local helper:\n\n${e.message || e}`);
      } finally {
        set({ isPrinting: false, pendingPrintJob: null, webBluetoothProgress: 0 });
      }
      return;
    }

    try {
      await apiFetch(`/api/print/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mac_address: pendingPrintJob.macAddress,
          images,
          split_mode: pendingPrintJob.splitMode,
          is_rotated: pendingPrintJob.canvasState.isRotated || false,
          dither: pendingPrintJob.dither
        })
      }, { timeoutMs: 120_000, fallback: 'Print failed' });
      registerPrintSuccess();
    } catch (e) {
      console.error(e);
      const message = await describePrintError(e);
      alert(`Failed to print:\n\n${message}`);
    } finally {
      set({ isPrinting: false, pendingPrintJob: null });
    }
  },

  isSidebarCollapsed: false,
  toggleSidebar: () => set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
  isPropertiesOpen: true,
  toggleProperties: () => set((state) => ({ isPropertiesOpen: !state.isPropertiesOpen })),
  
  addresses: [],
  settings: { paper_width_mm: 58.0, print_width_mm: 48.0, default_dpi: 203, speed: 0, energy: 0, feed_lines: 50, default_font: 'RobotoCondensed.ttf', intended_media_type: 'unknown' },
  settingsLoaded: false,
  
  // Refined DPI Math logic that safely falls back
  getPxToMm: (px) => {
    const dpi = get().currentDpi || get().settings?.default_dpi || 203;
    return (Number(px || 0) / (dpi / 25.4)).toFixed(1);
  },
  getMmToPx: (mm) => {
    const dpi = get().currentDpi || get().settings?.default_dpi || 203;
    return Math.round(Number(mm || 0) * (dpi / 25.4));
  },
  pxToMm: (px) => parseFloat(get().getPxToMm(px)),
  mmToPx: (mm) => get().getMmToPx(mm),
  getActivePreset: () => {
    const state = get();
    const { labelPresets, canvasWidth, canvasHeight, isRotated, getMmToPx, selectedPrinterInfo } = state;
    const vendor = (selectedPrinterInfo?.vendor || '').toLowerCase();

    const matches = labelPresets.filter((p) => {
      const presetWidthPx = getMmToPx(p.width_mm);
      const presetHeightPx = getMmToPx(p.height_mm);
      const directMatch = Math.abs(presetWidthPx - canvasWidth) <= 2 && Math.abs(presetHeightPx - canvasHeight) <= 2;
      const swappedMatch = Math.abs(presetWidthPx - canvasHeight) <= 2 && Math.abs(presetHeightPx - canvasWidth) <= 2;
      return p.is_rotated === isRotated && (directMatch || swappedMatch);
    });

    if (matches.length === 0) return null;

    if (vendor) {
      const vendorMatch = matches.find((p) => p.name.toLowerCase().includes(vendor));
      if (vendorMatch) return vendorMatch;
    }

    return matches[0];
  },

  // --- AI CHAT STATE ---
  aiMessages: [{ role: 'assistant', content: 'Hi! I am the OpenNiimStudio AI Assistant. Tell me what kind of label you want to design, and I will generate it for you!' }],
  aiInput: '',
  aiConvId: null,
  aiSessionUsage: { tokens: 0, promptTokens: 0, completionTokens: 0, cost: 0 },
  setAiInput: (input) => set({ aiInput: input }),
  setAiConvId: (id) => set({ aiConvId: id }),
  setAiMessages: (messagesOrUpdater) => set((state) => ({
    aiMessages: typeof messagesOrUpdater === 'function'
      ? messagesOrUpdater(state.aiMessages)
      : messagesOrUpdater
  })),
  setAiSessionUsage: (usageOrUpdater) => set((state) => ({
    aiSessionUsage: typeof usageOrUpdater === 'function'
      ? usageOrUpdater(state.aiSessionUsage)
      : usageOrUpdater
  })),
  aiMode: 'live',
  setAiMode: (val) => set({ aiMode: val }),
  aiExternalIntent: '',
  setAiExternalIntent: (val) => set({ aiExternalIntent: val }),
  aiExternalPrompt: '',
  setAiExternalPrompt: (val) => set({ aiExternalPrompt: val }),
  aiExternalResponse: '',
  setAiExternalResponse: (val) => set({ aiExternalResponse: val }),
  aiExternalError: '',
  setAiExternalError: (val) => set({ aiExternalError: val }),
  aiExternalNotice: '',
  setAiExternalNotice: (val) => set({ aiExternalNotice: val }),
  aiExternalResults: [],
  setAiExternalResults: (val) => set({ aiExternalResults: val }),
  resetAiChat: () => set({
    aiMessages: [{ role: 'assistant', content: 'Hi! I am the OpenNiimStudio AI Assistant. Tell me what kind of label you want to design, and I will generate it for you!' }],
    aiInput: '',
    aiConvId: null,
    aiSessionUsage: { tokens: 0, promptTokens: 0, completionTokens: 0, cost: 0 },
    aiExternalIntent: '',
    aiExternalPrompt: '',
    aiExternalResponse: '',
    aiExternalError: '',
    aiExternalNotice: '',
    aiExternalResults: []
  }),

  // --- HIERARCHICAL PROJECT MANAGEMENT ---
  projects: [],
  categories: [],
  currentProjectId: null,
  
  setCurrentProjectId: (id) => set({ currentProjectId: id }),

  setBatchRecords: (records) => set((state) => {
    const validRecords = Array.isArray(records) && records.length ? records : [{}];
    if (validRecords.length > MAX_BATCH_RECORDS) {
      return {
        batchGenerationError: `Batch data is limited to ${MAX_BATCH_RECORDS.toLocaleString()} records.`
      };
    }
    return {
      batchRecords: validRecords,
      batchGenerationError: '',
      items: recalcAutoFit(state.items, validRecords, state.canvasWidth, state.canvasHeight)
    };
  }),
  batchGenerationError: '',
  clearBatchGenerationError: () => set({ batchGenerationError: '' }),
  generateBatchMatrix: (matrixDef) => {
    try {
      get().setBatchRecords(buildBatchMatrix(matrixDef));
      return true;
    } catch (error) {
      set({ batchGenerationError: error.message });
      return false;
    }
  },
  generateBatchSequence: (seqDef) => {
    try {
      get().setBatchRecords(buildBatchSequence(seqDef));
      return true;
    } catch (error) {
      set({ batchGenerationError: error.message });
      return false;
    }
  },
  updateBatchRecord: (index, newRecord) => set((state) => {
    const newRecords = [...state.batchRecords];
    newRecords[index] = newRecord;
    return {
      batchRecords: newRecords,
      items: recalcAutoFit(state.items, newRecords, state.canvasWidth, state.canvasHeight)
    };
  }),
  addBatchRecord: (record = {}) => set((state) => {
    if (state.batchRecords.length >= MAX_BATCH_RECORDS) {
      return {
        batchGenerationError: `Batch data is limited to ${MAX_BATCH_RECORDS.toLocaleString()} records.`
      };
    }
    const newRecords = [...state.batchRecords, record];
    return {
      batchRecords: newRecords,
      batchGenerationError: '',
      items: recalcAutoFit(state.items, newRecords, state.canvasWidth, state.canvasHeight)
    };
  }),
  removeBatchRecord: (index) => set((state) => {
    const newRecords = state.batchRecords.filter((_, i) => i !== index);
    const validRecords = newRecords.length ? newRecords : [{}];
    return {
      batchRecords: validRecords,
      items: recalcAutoFit(state.items, validRecords, state.canvasWidth, state.canvasHeight)
    };
  }),
  setPrintCopies: (n) => set({
    printCopies: Math.min(MAX_PRINT_COPIES, Math.max(1, Number(n) || 1))
  }),

  fetchPresets: async () => {
    try {
      let data = await apiJson('/api/presets', {}, {
        validate: isArrayPayload,
        validationMessage: 'Preset data is malformed.'
      });

      const standard48 = data.find((p) => p.name.includes('Standard Square (48x48mm)'));
      const a6Shipping = data.find((p) => p.name.includes('A6 Shipping'));

      data = data.filter((p) => p !== standard48 && p !== a6Shipping);

      if (standard48) data.unshift(standard48);
      if (a6Shipping) data.push(a6Shipping);

      set({ labelPresets: data });
    } catch (e) {
      console.error("Failed to fetch presets", e);
      set({ apiError: errorMessage(e, 'Failed to load presets.') });
    }
  },

  fetchProjects: async () => {
    const clientProjects = loadClientProjects();
    const clientCategories = loadClientCategories();
    if (clientProjects !== null && clientCategories !== null) {
      set({ projects: clientProjects, categories: clientCategories });
      return;
    }

    try {
      const [projects, categories] = await Promise.all([
        apiJson('/api/projects', {}, { validate: isArrayPayload, validationMessage: 'Project data is malformed.' }),
        apiJson('/api/categories', {}, { validate: isArrayPayload, validationMessage: 'Category data is malformed.' })
      ]);
      const finalProjs = projects || [];
      const finalCats = categories || [];
      saveClientProjects(finalProjs);
      saveClientCategories(finalCats);
      set({ projects: finalProjs, categories: finalCats });
    } catch (e) {
      console.warn("Could not fetch server projects/categories, using local storage", e);
      const finalProjs = clientProjects || [];
      const finalCats = clientCategories || [];
      saveClientProjects(finalProjs);
      saveClientCategories(finalCats);
      set({ projects: finalProjs, categories: finalCats });
    }
  },

  createCategory: async (name, parentId = null) => {
    const newCat = { id: Date.now(), name, parent_id: parentId };
    const current = get().categories || [];
    const updated = [...current, newCat];
    saveClientCategories(updated);
    set({ categories: updated });

    try {
      await apiFetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parent_id: parentId })
      });
    } catch (_e) {}
  },

  updateCategory: async (id, name = undefined, parentId = undefined) => {
    const current = get().categories || [];
    const updated = current.map((c) => c.id === id ? {
      ...c,
      ...(name !== undefined ? { name } : {}),
      ...(parentId !== undefined ? { parent_id: parentId } : {})
    } : c);
    saveClientCategories(updated);
    set({ categories: updated });

    try {
      await apiFetch(`/api/categories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parent_id: parentId })
      });
    } catch (_e) {}
  },

  deleteCategory: async (id) => {
    if (!window.confirm("Delete this folder AND all its contents recursively?")) return;
    const currentCats = get().categories || [];
    const currentProjs = get().projects || [];

    const idsToDelete = new Set([id]);
    let added = true;
    while (added) {
      added = false;
      for (const cat of currentCats) {
        if (cat.parent_id && idsToDelete.has(cat.parent_id) && !idsToDelete.has(cat.id)) {
          idsToDelete.add(cat.id);
          added = true;
        }
      }
    }
    const remainingCats = currentCats.filter((c) => !idsToDelete.has(c.id));
    const remainingProjs = currentProjs.filter((p) => !idsToDelete.has(p.category_id));
    saveClientCategories(remainingCats);
    saveClientProjects(remainingProjs);
    set({ categories: remainingCats, projects: remainingProjs });

    try {
      await apiFetch(`/api/categories/${id}`, { method: 'DELETE' });
    } catch (_e) {}
  },

  saveProject: async (name, categoryId = null) => {
    const state = useStore.getState();
    const thickness = state.canvasBorderThickness || 4;
    const batchRecords = state.batchRecords || [{}];
    const printCopies = state.printCopies || 1;
    
    const canvasState = {
      width: state.canvasWidth, height: state.canvasHeight,
      isRotated: state.isRotated, canvasBorder: state.canvasBorder,
      canvasBorderThickness: thickness, splitSections: state.splitSections, splitMode: state.splitMode,
      pageLayouts: state.pageLayouts,
      items: state.items, currentPage: state.currentPage,
      batchRecords, printCopies
    };

    const newProject = {
      id: Date.now(),
      name,
      category_id: categoryId,
      canvas_state: canvasState,
      canvas_state_json: JSON.stringify(canvasState)
    };

    const currentProjs = get().projects || [];
    const updatedProjs = [...currentProjs, newProject];
    saveClientProjects(updatedProjs);
    set({ projects: updatedProjs, currentProjectId: newProject.id });

    try {
      const res = await apiFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          category_id: categoryId,
          canvas_state: canvasState
        })
      });
      const data = await res.json();
      if (isObjectPayload(data) && data.id !== undefined) {
        const synced = (get().projects || []).map((p) => p.id === newProject.id ? { ...p, id: data.id } : p);
        saveClientProjects(synced);
        set({ projects: synced, currentProjectId: data.id });
      }
    } catch (_e) {}
  },

  updateProject: async (id, newName = null, newCategoryId = undefined) => {
    const state = useStore.getState();
    const thickness = state.canvasBorderThickness || 4;
    const batchRecords = state.batchRecords || [{}];
    const printCopies = state.printCopies || 1;
    
    const canvasState = {
      width: state.canvasWidth, height: state.canvasHeight,
      isRotated: state.isRotated, canvasBorder: state.canvasBorder,
      canvasBorderThickness: thickness, splitSections: state.splitSections, splitMode: state.splitMode,
      pageLayouts: state.pageLayouts,
      items: state.items, currentPage: state.currentPage,
      batchRecords, printCopies
    };

    const currentProjs = get().projects || [];
    const updatedProjs = currentProjs.map((p) => {
      if (p.id !== id) return p;
      return {
        ...p,
        canvas_state: canvasState,
        canvas_state_json: JSON.stringify(canvasState),
        ...(newName ? { name: newName } : {}),
        ...(newCategoryId !== undefined ? { category_id: newCategoryId } : {})
      };
    });
    saveClientProjects(updatedProjs);
    set({ projects: updatedProjs });

    try {
      const payload = { canvas_state: canvasState };
      if (newName) payload.name = newName;
      if (newCategoryId !== undefined) payload.category_id = newCategoryId;
      await apiFetch(`/api/projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (_e) {}
  },

  deleteProject: async (id) => {
    if (!window.confirm("Are you sure you want to delete this project?")) return;
    const currentProjs = get().projects || [];
    const updatedProjs = currentProjs.filter((p) => p.id !== id);
    saveClientProjects(updatedProjs);
    set({
      projects: updatedProjs,
      ...(get().currentProjectId === id ? { currentProjectId: null } : {})
    });

    try {
      await apiFetch(`/api/projects/${id}`, { method: 'DELETE' });
    } catch (_e) {}
  },

  exportWorkspaceData: () => exportAllClientData(),
  importWorkspaceData: (jsonString) => {
    const res = importAllClientData(jsonString);
    if (res.success) {
      const projects = loadClientProjects() || [];
      const categories = loadClientCategories() || [];
      const settings = loadClientSettings() || DEFAULT_SETTINGS;
      set({ projects, categories, settings });
    }
    return res;
  },

  hydrateCanvasState: (canvasState, options = {}) => set(
    (state) => ({
      ...buildCanvasDocumentPatch(canvasState, state),
      ...(options.currentProjectId !== undefined
        ? { currentProjectId: options.currentProjectId }
        : {})
    }),
    false,
    { history: options.resetHistory ? 'reset' : 'record' }
  ),

  loadProject: (proj) => {
    get().hydrateCanvasState(proj.canvas_state || {}, {
      currentProjectId: proj.id,
      resetHistory: true
    });
  },

  savePreset: async (presetData) => {
    const { name, description, media_type } = presetData;
    const state = get();
    const widthMm = parseFloat(state.getPxToMm(state.canvasWidth));
    const heightMm = parseFloat(state.getPxToMm(state.canvasHeight));

    try {
      await apiFetch('/api/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: description || null,
          media_type: media_type || 'any',
          width_mm: widthMm,
          height_mm: heightMm,
          is_rotated: state.isRotated,
          split_mode: state.splitMode,
          border: state.canvasBorder
        })
      });
      await state.fetchPresets();
    } catch (e) {
      console.error("Failed to save preset", e);
      set({ apiError: errorMessage(e, 'Failed to save the preset.') });
    }
  },

  applyPreset: (preset) => set((state) => {
    let widthMm = preset.width_mm ?? preset.w ?? 40;
    let heightMm = preset.height_mm ?? preset.h ?? 12;
    let isRotated = preset.is_rotated ?? preset.rotated ?? true;

    // For pre-cut labels and rotated labels, landscape mode is standard:
    // width is the longer horizontal dimension, height is the shorter printhead dimension.
    if (isRotated || preset.media_type === 'pre-cut' || preset.name?.toLowerCase().includes('niimbot') || preset.name?.toLowerCase().includes('pre-cut')) {
      const longDim = Math.max(widthMm, heightMm);
      const shortDim = Math.min(widthMm, heightMm);
      widthMm = longDim;
      heightMm = shortDim;
      isRotated = true;
    }

    const splitMode = preset.split_mode ?? preset.splitMode ?? false;
    const nextCanvasWidth = state.getMmToPx(widthMm);
    const nextCanvasHeight = state.getMmToPx(heightMm);

    return {
      canvasWidth: nextCanvasWidth,
      canvasHeight: nextCanvasHeight,
      isRotated,
      splitMode,
      splitSections: preset.split_sections || preset.splitSections || state.splitSections,
      canvasBorder: preset.border || 'none',
      pageLayouts: state.pageLayouts.map(l => l.activeTemplate ? {
        ...l,
        htmlContent: buildTemplateHtml(l.activeTemplate.id, l.activeTemplate.params, nextCanvasWidth, nextCanvasHeight)
      } : l),
      items: recalcAutoFit(state.items, state.batchRecords, nextCanvasWidth, nextCanvasHeight)
    };
  }),
  
  fetchAddresses: async () => {
    try {
      const data = await apiJson('/api/addresses', {}, {
        validate: isArrayPayload,
        validationMessage: 'Address data is malformed.'
      });
      set({ addresses: data });
    } catch (e) {
      console.error("Failed to fetch addresses", e);
      set({ apiError: errorMessage(e, 'Failed to load addresses.') });
    }
  },

  saveAddress: async (addr) => {
    try {
      await apiFetch('/api/addresses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addr)
      });
      useStore.getState().fetchAddresses();
    } catch (e) {
      console.error("Failed to save address", e);
      set({ apiError: errorMessage(e, 'Failed to save the address.') });
    }
  },

  deleteAddress: async (id) => {
    try {
      await apiFetch(`/api/addresses/${id}`, { method: 'DELETE' });
      useStore.getState().fetchAddresses();
    } catch (e) {
      console.error("Failed to delete address", e);
      set({ apiError: errorMessage(e, 'Failed to delete the address.') });
    }
  },

  fetchSettings: async () => {
    const clientSettings = loadClientSettings();
    if (clientSettings) {
      set({ settings: clientSettings, settingsLoaded: true });
      return;
    }

    try {
      const data = await apiJson('/api/settings', {}, {
        validate: isObjectPayload,
        validationMessage: 'Settings data is malformed.'
      });
      saveClientSettings(data);
      set({ settings: data, settingsLoaded: true });
    } catch (e) {
      console.warn("Failed to fetch settings from server, using client defaults", e);
      saveClientSettings(DEFAULT_SETTINGS);
      set({ settings: DEFAULT_SETTINGS, settingsLoaded: true });
    }
  },

  fetchFonts: async () => {
    try {
      const data = await apiJson('/api/fonts', {}, {
        validate: isArrayPayload,
        validationMessage: 'Font data is malformed.'
      });
      set({ fonts: data });

      document.getElementById('catlabel-uploaded-fonts')?.remove();
      document.getElementById('openniim-uploaded-fonts')?.remove();
      const style = document.createElement('style');
      style.id = 'openniim-uploaded-fonts';
      let css = '';
      data.forEach(font => {
        if (!font || typeof font.name !== 'string' || typeof font.file_path !== 'string') return;
        const fontName = font.name.split('.')[0].replace(/[^\w -]/g, '').trim();
        const filePath = font.file_path.replace(/\\/g, '/').replace(/^\/+/, '');
        if (!fontName || filePath.includes('..') || /["'()\r\n]/.test(filePath)) return;
        css += `@font-face { font-family: '${fontName}'; src: url('/${encodeURI(filePath)}'); }\n`;
      });
      style.appendChild(document.createTextNode(css));
      document.head.appendChild(style);
    } catch (e) {
      console.error("Failed to fetch fonts", e);
      set({ apiError: errorMessage(e, 'Failed to load fonts.') });
    }
  },

  uploadFont: async (file) => {
    const formData = new FormData();
    formData.append("file", file);
    try {
      await apiFetch('/api/fonts', {
        method: 'POST',
        body: formData
      });
      await get().fetchFonts();
    } catch (e) {
      console.error("Failed to upload font", e);
      set({ apiError: errorMessage(e, 'Failed to upload the font file.') });
    }
  },

  setIsRotated: (val) => {
    const state = get();
    const nextRotation = Boolean(val);
    if (nextRotation === state.isRotated) return;
    state.setCanvasGeometry(state.canvasHeight, state.canvasWidth, nextRotation);
  },

  setCanvasBorder: (val) => set({ canvasBorder: val }),
  setCanvasBorderThickness: (val) => set({ canvasBorderThickness: val }),
  setSplitMode: (val) => set({ splitMode: val }),
  setTheme: (theme) => set({ theme }),
  setSettings: (settings) => set({ settings }),
  
  updateSettingsAPI: async (newSettings) => {
    const previous = get();
    const requestedDpi = Number(newSettings?.default_dpi);
    const currentDpi = previous.currentDpi || previous.settings?.default_dpi || 203;
    const shouldScaleForDpi = !previous.selectedPrinter
      && Number.isFinite(requestedDpi)
      && requestedDpi > 0
      && Math.abs(requestedDpi - currentDpi) > 0.001;

    saveClientSettings(newSettings);

    if (shouldScaleForDpi) {
      const scale = requestedDpi / currentDpi;
      const nextWidth = Math.max(1, Math.round(previous.canvasWidth * scale));
      const nextHeight = Math.max(1, Math.round(previous.canvasHeight * scale));
      set({
        settings: newSettings,
        currentDpi: requestedDpi,
        canvasWidth: nextWidth,
        canvasHeight: nextHeight,
        items: recalcAutoFit(previous.items.map((item) => scaleItemForDpi(item, scale)), previous.batchRecords, nextWidth, nextHeight),
        pageLayouts: previous.pageLayouts.map((layout) => layout.activeTemplate ? {
          ...layout,
          htmlContent: buildTemplateHtml(layout.activeTemplate.id, layout.activeTemplate.params, nextWidth, nextHeight)
        } : layout)
      });
    } else {
      set({ settings: newSettings });
    }

    try {
      await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings)
      });
    } catch (_e) {
      // Saved in client storage
    }
  },
  
  setSelectedPrinter: async (mac, info) => {
    const requestId = ++printerProfileRequestId;
    const currentState = get();
    let newW = currentState.canvasWidth;
    let newH = currentState.canvasHeight;
    let nextItems = currentState.items;
    let rot = currentState.isRotated;
    let border = currentState.canvasBorder;

    // Use the exact DPI passed by the hardware info payload
    const activeDpi = info?.dpi || 203;
    const calcMmToPx = (mm) => Math.round(mm * (activeDpi / 25.4));

    if (info) {
      const isNewPrinter = currentState.selectedPrinterInfo?.address !== mac;
      const isPreCutMedia = info.media_type === 'pre-cut';
      const previousDpi = currentState.currentDpi || currentState.settings?.default_dpi || 203;
      const dpiScale = activeDpi / previousDpi;

      if (Math.abs(dpiScale - 1) > 0.001) {
        newW = Math.max(1, Math.round(currentState.canvasWidth * dpiScale));
        newH = Math.max(1, Math.round(currentState.canvasHeight * dpiScale));
        nextItems = currentState.items.map((item) => scaleItemForDpi(item, dpiScale));
      }

      if (isNewPrinter) {
        if (isPreCutMedia) {
          const model = info.model_id ? info.model_id.toLowerCase() : '';

          if (model === 'd11' || model === 'd110' || model === 'd110_m' || model === 'd101') {
            newW = calcMmToPx(40);
            newH = calcMmToPx(15);
            rot = true;
          } else if (model === 'b1' || model === 'b21' || model === 'b18') {
            newW = calcMmToPx(50);
            newH = calcMmToPx(30);
            rot = true;
          } else {
            newW = info.width_px || calcMmToPx(48);
            newH = info.width_px || calcMmToPx(48);
            rot = false;
          }
          border = 'none';
        } else {
          const hardwareWidth = info.width_px || 384;
          const currentPrintHeadDimension = currentState.isRotated ? newH : newW;

          if (currentPrintHeadDimension <= hardwareWidth) {
            // Keep the current physical dimensions after the DPI conversion above.
          } else if (hardwareWidth === 384) {
            newW = hardwareWidth;
            newH = hardwareWidth;
            rot = false;
          } else if (hardwareWidth > 384) {
            newW = hardwareWidth;
            newH = Math.round(hardwareWidth * 1.5);
            rot = false;
          } else {
            newW = calcMmToPx(40);
            newH = hardwareWidth;
            rot = true;
            border = 'none';
          }
        }
      }
    }

    set({
      selectedPrinter: mac,
      selectedPrinterInfo: info,
      currentDpi: activeDpi,
      canvasWidth: newW,
      canvasHeight: newH,
      isRotated: rot,
      canvasBorder: border,
      items: recalcAutoFit(nextItems, currentState.batchRecords, newW, newH),
      pageLayouts: currentState.pageLayouts.map(l => l.activeTemplate ? {
        ...l,
        htmlContent: buildTemplateHtml(l.activeTemplate.id, l.activeTemplate.params, newW, newH)
      } : l)
    });

    if (!mac) {
      get().stopBatteryPolling();
      set({
        printerProfile: { speed: 0, energy: 0, feed_lines: 50, paper_mode: null },
        printerBatteryLevel: null
      });
      return;
    }

    const localProfile = loadClientPrinterProfile(mac);

    try {
      let profile = localProfile || {};
      if (info?.transport !== 'web_bluetooth') {
        try {
          const res = await apiFetch(`/api/printers/${mac}/profile`);
          const serverProfile = (await res.json()) || {};
          profile = { ...serverProfile, ...profile };
        } catch (_fetchErr) {}
      }
      if (requestId !== printerProfileRequestId || get().selectedPrinter !== mac) return;
      const caps = info?.capabilities || {};

      // =========================================================================
      // INTELLIGENT OFFLINE-TO-PHYSICAL PROFILE MIGRATION
      // =========================================================================
      if (info && info.transport !== 'offline') {
        const isVirginProfile =
          (profile?.speed ?? 0) <= 0 &&
          (profile?.energy ?? 0) <= 0 &&
          (profile?.feed_lines ?? 50) === 50;

        if (isVirginProfile) {
          const manualPrinters = (get().manualPrinters || []).filter(
            (printer) => printer && printer.address && printer.address !== mac
          );

          const infoModelId = String(info.model_id || '').trim().toLowerCase();
          const infoVendor = String(info.vendor || '').trim().toLowerCase();
          const infoProtocolFamily = String(info.protocol_family || '').trim().toLowerCase();
          const infoMediaType = String(info.media_type || '').trim().toLowerCase();

          let bestMatch = infoModelId
            ? manualPrinters.find(
                (printer) => String(printer.model_id || '').trim().toLowerCase() === infoModelId
              )
            : null;

          if (!bestMatch && infoVendor && infoProtocolFamily && infoMediaType) {
            bestMatch = manualPrinters.find((printer) =>
              String(printer.vendor || '').trim().toLowerCase() === infoVendor &&
              String(printer.protocol_family || '').trim().toLowerCase() === infoProtocolFamily &&
              String(printer.media_type || '').trim().toLowerCase() === infoMediaType
            );
          }

          if (bestMatch) {
            try {
              const manRes = await apiFetch(`/api/printers/${bestMatch.address}/profile`);
              const manProfile = (await manRes.json()) || {};
              if (requestId !== printerProfileRequestId || get().selectedPrinter !== mac) return;
              const migratedSpeed = Number(manProfile?.speed ?? 0);
              const migratedEnergy = Number(manProfile?.energy ?? 0);
              const migratedFeedLines = Number(manProfile?.feed_lines ?? 50);

              const migratedPaperMode = manProfile?.paper_mode || null;
              const hasCustomSettings =
                migratedSpeed > 0 ||
                migratedEnergy > 0 ||
                migratedFeedLines !== 50 ||
                !!migratedPaperMode;

              if (hasCustomSettings) {
                profile = {
                  ...profile,
                  speed: migratedSpeed > 0 ? migratedSpeed : profile?.speed,
                  energy: migratedEnergy > 0 ? migratedEnergy : profile?.energy,
                  feed_lines: migratedFeedLines !== 50 ? migratedFeedLines : profile?.feed_lines,
                  paper_mode: migratedPaperMode || profile?.paper_mode
                };

                await apiFetch(`/api/printers/${mac}/profile`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(profile)
                });

                console.log(
                  `[Profile Sync] Safely migrated settings from compatible offline profile (${bestMatch.name}) to physical device ${mac}.`
                );
              }
            } catch (mergeError) {
              console.error("Failed to migrate offline profile settings", mergeError);
            }
          }
        }
      }
      // =========================================================================

      const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

      const profileEnergy = Number(profile?.energy);
      const hasProfileEnergy = profile?.energy !== null && profile?.energy !== undefined && Number.isFinite(profileEnergy);
      const hasDensityOverride = hasProfileEnergy && profileEnergy > 0;
      const normalizedEnergy = caps.density?.available
        ? (caps.density.allow_auto && !hasDensityOverride
            ? 0
            : clamp(
                hasDensityOverride ? profileEnergy : (caps.density.default ?? caps.density.min ?? 1),
                caps.density.min ?? 1,
                caps.density.max ?? 8
              ))
        : (caps.energy?.available
            ? clamp(
                (profile?.energy > 0 ? profile.energy : caps.energy.default) || 5000,
                caps.energy.min || 1,
                caps.energy.max || 65535
              )
            : 0);

      const normalizedSpeed = caps.speed?.available
        ? clamp(
            profile?.speed > 0 ? profile.speed : (caps.speed.default || 0),
            caps.speed.min || 0,
            caps.speed.max || 100
          )
        : 0;

      const normalizedFeed = caps.feed?.available
        ? Math.max(0, profile?.feed_lines ?? (caps.feed.default || 50))
        : 0;
      const supportedPaperModes = Array.isArray(info?.supported_paper_modes) ? info.supported_paper_modes : [];
      const supportedPaperValues = supportedPaperModes.map((mode) => mode.value).filter(Boolean);
      const normalizedPaperMode = supportedPaperValues.length > 0
        ? (supportedPaperValues.includes(profile?.paper_mode) ? profile.paper_mode : supportedPaperValues[0])
        : null;

      if (requestId !== printerProfileRequestId || get().selectedPrinter !== mac) return;
      const finalProfile = {
        ...profile,
        speed: normalizedSpeed,
        energy: normalizedEnergy,
        feed_lines: normalizedFeed,
        paper_mode: normalizedPaperMode
      };
      saveClientPrinterProfile(mac, finalProfile);
      set({ printerProfile: finalProfile });

      // Automatically read RFID and select matching canvas preset for Niimbot printers
      const v = (info?.vendor || '').toLowerCase();
      const n = (info?.name || '').toLowerCase();
      if (v.includes('niimbot') || n.includes('d11') || n.includes('b21') || n.includes('b1') || n.includes('d101')) {
        get().readPrinterRfid(mac).catch((err) => console.warn('Background RFID read error:', err));
      }
    } catch (e) {
      console.error("Failed to fetch or merge printer profile", e);
      if (requestId === printerProfileRequestId && get().selectedPrinter === mac) {
        const fallbackProfile = localProfile || { speed: 0, energy: 0, feed_lines: 50, paper_mode: null };
        set({ printerProfile: fallbackProfile });
      }
    }
  },

  readPrinterRfid: async (targetMac = null) => {
    const state = get();
    const mac = targetMac || state.selectedPrinter;
    const info = state.selectedPrinterInfo;
    if (!mac || !info) return null;

    set({ isReadingRfid: true });
    try {
      let rfidData = null;

      // 1. Web Bluetooth
      if (info.transport === 'web_bluetooth' && state.webBluetoothSession?.client) {
        rfidData = await getWebBluetoothRfidInfo(state.webBluetoothSession.client);
      } else {
        // 2. Local Bridge Helper
        let bridge = state.bridgeClient;
        if (!bridge || !bridge.isConnected) {
          bridge = new LocalBridgeClient();
          await bridge.connect();
          set({ bridgeClient: bridge, bridgeConnected: true });
        }
        rfidData = await bridge.getRfidInfo(mac);
      }

      if (!rfidData || !rfidData.success || !rfidData.tag_present) {
        set({
          isReadingRfid: false,
          loadedPaperInfo: rfidData?.success && !rfidData.tag_present
            ? { tag_present: false, message: 'Non-RFID roll (Manual preset)' }
            : null
        });
        return null;
      }

      set({ loadedPaperInfo: rfidData, isReadingRfid: false });

      // Match against presets!
      const currentPresets = get().labelPresets || [];
      const { width_mm, height_mm } = rfidData;

      // Check saved user barcode association first
      const savedRfidMappings = loadClientRfidPresets();
      const userSavedPresetId = savedRfidMappings[rfidData.barcode] || savedRfidMappings[rfidData.uuid];

      let matchedPreset = null;
      if (userSavedPresetId) {
        matchedPreset = currentPresets.find(p => String(p.id) === String(userSavedPresetId) || p.name === userSavedPresetId);
      }

      if (!matchedPreset) {
        const longDim = Math.max(width_mm, height_mm);
        const shortDim = Math.min(width_mm, height_mm);

        // 1. Prioritize Niimbot pre-cut presets
        matchedPreset = currentPresets.find(p =>
          p.name.toLowerCase().includes('niimbot') &&
          Math.abs(Math.max(p.width_mm, p.height_mm) - longDim) <= 1 &&
          Math.abs(Math.min(p.width_mm, p.height_mm) - shortDim) <= 1
        );

        // 2. Fallback to any preset matching dimensions
        if (!matchedPreset) {
          matchedPreset = currentPresets.find(p =>
            Math.abs(Math.max(p.width_mm, p.height_mm) - longDim) <= 1 &&
            Math.abs(Math.min(p.width_mm, p.height_mm) - shortDim) <= 1
          );
        }
      }

      const finalPreset = matchedPreset ? {
        ...matchedPreset,
        width_mm: Math.max(matchedPreset.width_mm, matchedPreset.height_mm),
        height_mm: Math.min(matchedPreset.width_mm, matchedPreset.height_mm),
        is_rotated: true,
      } : {
        name: `Pre-cut: Niimbot ${Math.max(width_mm, height_mm)}x${Math.min(width_mm, height_mm)}mm`,
        width_mm: Math.max(width_mm, height_mm),
        height_mm: Math.min(width_mm, height_mm),
        is_rotated: true,
        media_type: 'pre-cut',
        split_mode: false,
        border: 'none',
      };

      get().applyPreset(finalPreset);
      console.log(`Auto-selected canvas preset '${finalPreset.name}' in landscape mode based on RFID tag.`);

      return rfidData;
    } catch (err) {
      console.warn('Could not read RFID from printer:', err);
      set({ isReadingRfid: false });
      return null;
    }
  },
  
  setItems: (items) => set((state) => ({
    items: recalcAutoFit(items, state.batchRecords, state.canvasWidth, state.canvasHeight),
    selectedId: null,
    selectedIds: [],
    selectedPagesForPrint: []
  })),
  clearCanvas: () => set({ 
    items: [], 
    selectedId: null, 
    selectedIds: [], 
    currentPage: 0, 
    selectedPagesForPrint: [], 
    currentProjectId: null, 
    pageLayouts: [{ pageIndex: 0, htmlContent: '', activeTemplate: null }]
    // We specifically omitted history wipes here so the user can Undo a canvas clear!
  }),
  
  addItem: (item) => set((state) => {
    const nextItem = item.pageIndex === undefined ? { ...item, pageIndex: state.currentPage } : item;
    return {
      items: [...state.items, nextItem],
      selectedId: nextItem.id,
      selectedIds: [nextItem.id],
      currentPage: normalizePageIndex(nextItem.pageIndex)
    };
  }),
  
  duplicateItem: (id, copies, gapMm) => set((state) => {
    const itemToClone = state.items.find(i => i.id === id);
    if (!itemToClone) return state;
    
    const newItems = [];
    const gapPx = get().getMmToPx(gapMm);
    const numLines = itemToClone.text ? String(itemToClone.text).split('\n').length : 1;
    const pad = itemToClone.padding !== undefined ? Number(itemToClone.padding) : 0;
    const actualLineHeight = itemToClone.lineHeight ?? (numLines > 1 ? 1.15 : 1);
    const approxHeight = itemToClone.height || (itemToClone.type === 'text' ? (itemToClone.size * actualLineHeight * numLines) + (pad * 2) : 50);
    
    let currentY = itemToClone.y;
    
    for (let i = 1; i <= copies; i++) {
      currentY += approxHeight + gapPx;
      newItems.push({
        ...itemToClone,
        id: Date.now().toString() + '-' + i + '-' + Math.random().toString(36).substring(2, 7),
        y: currentY
      });
    }
    return { items: [...state.items, ...newItems] };
  }),

  multiplyWorkspace: (copies) => set((state) => {
    const totalCopies = Math.max(1, Number(copies) || 1);

    const currentItems = state.items.filter((item) => Number(item.pageIndex ?? 0) === state.currentPage);
    const currentLayout = state.pageLayouts.find(l => l.pageIndex === state.currentPage) || { htmlContent: '' };

    const maxPage = Math.max(
      state.currentPage,
      ...state.items.map((item) => Number(item.pageIndex ?? 0)),
      ...state.pageLayouts.map((l) => Number(l.pageIndex ?? 0))
    );
    const newItems = [...state.items];
    const newLayouts = [...state.pageLayouts];

    for (let i = 1; i <= totalCopies; i++) {
      const targetPage = maxPage + i;
      const clones = currentItems.map((item) => ({
        ...item,
        id: Date.now().toString() + '-' + i + '-' + Math.random().toString(36).substring(2, 7),
        pageIndex: targetPage
      }));
      newItems.push(...clones);
      newLayouts.push({ ...currentLayout, pageIndex: targetPage });
    }

    return {
      items: newItems,
      pageLayouts: newLayouts,
      selectedId: null
    };
  }),

  updateItem: (id, newAttrs) => set((state) => {
    const newItems = state.items.map((item) => {
      if (item.id === id) {
        const updatedItem = { ...item, ...newAttrs };
        if (updatedItem.fit_to_width) {
          const bounds = getItemSectionBounds(updatedItem, state.canvasWidth, state.canvasHeight, state.splitSections);
          return calculateAutoFitItem(updatedItem, state.batchRecords, bounds.width, bounds.height);
        }
        return updatedItem;
      }
      return item;
    });

    return { items: newItems };
  }),
  
  selectItem: (id, multi = false) => set((state) => {
    if (!id) return { selectedId: null, selectedIds: [] };
    if (multi) {
      const newIds = state.selectedIds.includes(id)
        ? state.selectedIds.filter((itemId) => itemId !== id)
        : [...state.selectedIds, id];
      return {
        selectedIds: newIds,
        selectedId: newIds.length > 0 ? newIds[newIds.length - 1] : null
      };
    }
    return { selectedId: id, selectedIds: [id] };
  }),

  selectItems: (ids, multi = false) => set((state) => {
    if (!ids || ids.length === 0) return state;
    if (multi) {
      const newIds = [...new Set([...state.selectedIds, ...ids])];
      return {
        selectedIds: newIds,
        selectedId: newIds.length > 0 ? newIds[newIds.length - 1] : null
      };
    }
    return {
      selectedIds: ids,
      selectedId: ids.length > 0 ? ids[ids.length - 1] : null
    };
  }),

  moveItemZ: (dir) => set((state) => {
    if (!state.selectedId) return state;

    const items = [...state.items];
    const idx = items.findIndex((item) => item.id === state.selectedId);
    if (idx < 0) return state;

    const item = items[idx];
    const pageItems = items.filter((candidate) => candidate.pageIndex === item.pageIndex);
    const pageIdx = pageItems.findIndex((candidate) => candidate.id === item.id);

    if (dir === 'up' && pageIdx < pageItems.length - 1) {
      const targetId = pageItems[pageIdx + 1].id;
      const targetIdx = items.findIndex((candidate) => candidate.id === targetId);
      [items[idx], items[targetIdx]] = [items[targetIdx], items[idx]];
    } else if (dir === 'down' && pageIdx > 0) {
      const targetId = pageItems[pageIdx - 1].id;
      const targetIdx = items.findIndex((candidate) => candidate.id === targetId);
      [items[idx], items[targetIdx]] = [items[targetIdx], items[idx]];
    }

    return { items };
  }),

  groupSelected: () => set((state) => {
    if (state.selectedIds.length < 2) return state;

    const selectedItems = state.items.filter((item) => state.selectedIds.includes(item.id));
    if (selectedItems.length < 2) return state;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    selectedItems.forEach((item) => {
      const pad = item.padding !== undefined ? Number(item.padding) : 0;
      const numLines = item.text ? String(item.text).split('\n').length : 1;
      const actualLineHeight = item.lineHeight ?? (numLines > 1 ? 1.15 : 1);
      const approxHeight = item.height || (item.type === 'text' ? (item.size * actualLineHeight * numLines) + (pad * 2) : 50);
      const width = item.width || 100;

      if (item.x < minX) minX = item.x;
      if (item.y < minY) minY = item.y;
      if (item.x + width > maxX) maxX = item.x + width;
      if (item.y + approxHeight > maxY) maxY = item.y + approxHeight;
    });

    const children = selectedItems.map((item) => ({
      ...item,
      x: item.x - minX,
      y: item.y - minY
    }));

    const newGroup = {
      id: Date.now().toString(),
      type: 'group',
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      pageIndex: selectedItems[0].pageIndex,
      children
    };

    const newItems = state.items.filter((item) => !state.selectedIds.includes(item.id));
    newItems.push(newGroup);

    return {
      items: newItems,
      selectedIds: [newGroup.id],
      selectedId: newGroup.id
    };
  }),

  ungroupSelected: () => set((state) => {
    const group = state.items.find((item) => item.id === state.selectedId && item.type === 'group');
    if (!group) return state;

    const newItems = state.items.filter((item) => item.id !== group.id);
    const ungroupedIds = [];

    group.children.forEach((child) => {
      const newId = Date.now().toString() + Math.random().toString(36).substring(2, 7);
      ungroupedIds.push(newId);
      newItems.push({
        ...child,
        id: newId,
        x: child.x + group.x,
        y: child.y + group.y,
        pageIndex: group.pageIndex
      });
    });

    return {
      items: newItems,
      selectedIds: ungroupedIds,
      selectedId: ungroupedIds[0] || null
    };
  }),

  fitGroupToWidth: () => set((state) => {
    const group = state.items.find((item) => item.id === state.selectedId && item.type === 'group');
    if (!group || !group.width) return state;

    const scale = state.canvasWidth / group.width;

    const scaledChildren = group.children.map((child) => {
      const nextChild = {
        ...child,
        x: child.x * scale,
        y: child.y * scale
      };

      if (nextChild.width) nextChild.width *= scale;
      if (nextChild.height) nextChild.height *= scale;

      if (child.type === 'text') {
        nextChild.size = Math.round(child.size * scale);
        if (child.padding !== undefined) {
          nextChild.padding = Math.round(child.padding * scale);
        }
      }

      if (child.type === 'icon_text') {
        nextChild.size = Math.round(child.size * scale);
        nextChild.icon_size = Math.round(child.icon_size * scale);
        nextChild.icon_x = child.icon_x * scale;
        nextChild.icon_y = child.icon_y * scale;
        nextChild.text_x = child.text_x * scale;
        nextChild.text_y = child.text_y * scale;
      }

      if (child.border_thickness) {
        nextChild.border_thickness = Math.round(child.border_thickness * scale);
      }

      return nextChild;
    });

    const newGroup = {
      ...group,
      x: 0,
      width: state.canvasWidth,
      height: group.height * scale,
      children: scaledChildren
    };

    return {
      items: state.items.map((item) => item.id === group.id ? newGroup : item)
    };
  }),
  
  deleteItem: (id) => set((state) => {
    const newItems = state.items.filter((item) => item.id !== id);
    const newIds = state.selectedIds.filter((itemId) => itemId !== id);
    return {
      items: newItems,
      selectedIds: newIds,
      selectedId: newIds.length > 0 ? newIds[newIds.length - 1] : null
    };
  }),

  deleteSelectedItems: () => set((state) => {
    const newItems = state.items.filter((item) => !state.selectedIds.includes(item.id));
    return {
      items: newItems,
      selectedIds: [],
      selectedId: null
    };
  }),

  moveSelectedItems: (dx, dy) => set((state) => {
    if (state.selectedIds.length === 0) return state;
    const newItems = state.items.map(item => {
      if (state.selectedIds.includes(item.id)) {
        return { ...item, x: item.x + dx, y: item.y + dy };
      }
      return item;
    });
    return { items: newItems };
  }),
  
  setCanvasGeometry: (width, height, isRotated = get().isRotated) => set((state) => {
    const nextWidth = Math.min(20_000, Math.max(1, Number(width) || 1));
    const nextHeight = Math.min(20_000, Math.max(1, Number(height) || 1));
    return {
      canvasWidth: nextWidth,
      canvasHeight: nextHeight,
      isRotated: Boolean(isRotated),
      pageLayouts: state.pageLayouts.map(l => l.activeTemplate ? {
        ...l,
        htmlContent: buildTemplateHtml(l.activeTemplate.id, l.activeTemplate.params, nextWidth, nextHeight)
      } : l),
      items: recalcAutoFit(state.items, state.batchRecords, nextWidth, nextHeight)
    };
  }),
  setCanvasSize: (width, height) => get().setCanvasGeometry(width, height, get().isRotated),

  fetchPrinterBattery: async () => {
    const state = get();
    const printer = state.selectedPrinter;
    const info = state.selectedPrinterInfo;
    if (!printer) return null;

    try {
      let level = null;
      if (info?.transport === 'web_bluetooth' && state.webBluetoothSession?.client) {
        level = await getWebBluetoothBatteryLevel(state.webBluetoothSession.client);
      } else if (state.bridgeConnected && state.bridgeClient) {
        level = await state.bridgeClient.getBatteryLevel(printer);
      }

      if (typeof level === 'number' && !isNaN(level)) {
        const normalized = Math.max(0, Math.min(100, Math.round(level)));
        set({ printerBatteryLevel: normalized });
        return normalized;
      }
    } catch (err) {
      console.warn('Could not refresh printer battery level:', err);
    }
    return null;
  },

  startBatteryPolling: () => {
    // Periodic polling disabled to prevent continuous hardware beeping on physical printers
    get().stopBatteryPolling();
  },

  stopBatteryPolling: () => {
    const timer = get().batteryPollTimer;
    if (timer) {
      clearInterval(timer);
      set({ batteryPollTimer: null });
    }
  },
})));
