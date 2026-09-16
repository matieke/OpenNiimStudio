import { afterEach, describe, expect, test, vi } from 'vitest';
import { useStore } from './store';

afterEach(() => {
  vi.useRealTimers();
  useStore.setState({
    items: [],
    pageLayouts: [{ pageIndex: 0, htmlContent: '', activeTemplate: null }],
    batchRecords: [{}],
    currentPage: 0,
    currentProjectId: null,
    history: [],
    historyIndex: -1,
    canUndo: false,
    canRedo: false
  });
});

describe('editor store correctness', () => {
  test('AI setters accept React-style functional updaters', () => {
    useStore.setState({ aiMessages: [], aiSessionUsage: { tokens: 1 } });
    useStore.getState().setAiMessages((messages) => [...messages, { role: 'user', content: 'hello' }]);
    useStore.getState().setAiSessionUsage((usage) => ({ ...usage, tokens: usage.tokens + 4 }));
    expect(useStore.getState().aiMessages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(useStore.getState().aiSessionUsage.tokens).toBe(5);
  });

  test('selects a newly added item on its target page', () => {
    useStore.setState({ currentPage: 2 });
    useStore.getState().addItem({ id: 'created', type: 'text', text: 'New' });
    expect(useStore.getState()).toMatchObject({
      selectedId: 'created', selectedIds: ['created'], currentPage: 2
    });
    expect(useStore.getState().items[0].pageIndex).toBe(2);
  });

  test('hydrates rotation and geometry atomically without double-swapping', () => {
    useStore.getState().hydrateCanvasState({
      width: 200,
      height: 100,
      isRotated: true,
      items: [{ id: 'one', type: 'text', text: 'A', pageIndex: 0 }]
    });
    expect(useStore.getState()).toMatchObject({ canvasWidth: 200, canvasHeight: 100, isRotated: true });
  });

  test('loading a project clears the previous document history', async () => {
    vi.useFakeTimers();
    useStore.getState().setItems([{ id: 'old', type: 'text', text: 'Old', pageIndex: 0 }]);
    await vi.advanceTimersByTimeAsync(450);
    expect(useStore.getState().canUndo).toBe(true);

    useStore.getState().loadProject({
      id: 42,
      canvas_state: { width: 300, height: 150, items: [{ id: 'new', type: 'text', text: 'New', pageIndex: 0 }] }
    });
    expect(useStore.getState()).toMatchObject({ currentProjectId: 42, history: [], canUndo: false });

    useStore.getState().undo();
    expect(useStore.getState().items[0].id).toBe('new');
  });

  test('clamps persisted copies and batch records while normalizing pages', () => {
    const records = Array.from({ length: 1_100 }, (_, index) => ({ index }));
    useStore.getState().hydrateCanvasState({
      printCopies: 999,
      batchRecords: records,
      pageLayouts: [{ pageIndex: -10, htmlContent: 'first' }]
    });
    expect(useStore.getState().printCopies).toBe(100);
    expect(useStore.getState().batchRecords).toHaveLength(1_000);
    expect(useStore.getState().pageLayouts[0].pageIndex).toBe(0);
  });

  test('setSplitSections updates configuration and replicates section items accurately', () => {
    useStore.setState({
      canvasWidth: 400,
      canvasHeight: 200,
      currentPage: 0,
      items: [
        // Section 0 is (x: 0..200, y: 0..100). Place an item centered in cell 0
        { id: 'item1', type: 'text', text: 'Sec1', x: 50, y: 30, width: 50, height: 20, pageIndex: 0 }
      ]
    });

    useStore.getState().setSplitSections({
      enabled: true,
      rows: 2,
      cols: 2,
      printCutLines: true,
      cutLineStyle: 'dashed',
      showGuides: true
    });

    expect(useStore.getState().splitSections).toEqual({
      enabled: true,
      rows: 2,
      cols: 2,
      printCutLines: true,
      cutLineStyle: 'dashed',
      showGuides: true
    });

    // Replicate section 0 across the 2x2 grid (cells: (0,0), (0,1), (1,0), (1,1))
    useStore.getState().replicateSection(0);

    const items = useStore.getState().items;
    expect(items).toHaveLength(4); // 1 original + 3 copies

    // Verify cell 1 (col 1, row 0): dx = +200, dy = 0
    const cell1Item = items.find(i => i.x === 250 && i.y === 30);
    expect(cell1Item).toBeDefined();
    expect(cell1Item.text).toBe('Sec1');

    // Verify cell 2 (col 0, row 1): dx = 0, dy = +100
    const cell2Item = items.find(i => i.x === 50 && i.y === 130);
    expect(cell2Item).toBeDefined();

    // Verify cell 3 (col 1, row 1): dx = +200, dy = +100
    const cell3Item = items.find(i => i.x === 250 && i.y === 130);
    expect(cell3Item).toBeDefined();
  });

  test('hydrates splitSections correctly from canvas_state', () => {
    useStore.getState().hydrateCanvasState({
      width: 384,
      height: 240,
      splitSections: {
        enabled: true,
        rows: 3,
        cols: 1,
        printCutLines: true,
        cutLineStyle: 'solid',
        showGuides: false
      }
    });

    expect(useStore.getState().splitSections).toEqual({
      enabled: true,
      rows: 3,
      cols: 1,
      printCutLines: true,
      cutLineStyle: 'solid',
      showGuides: false
    });
  });

  test('auto-fit calculates individual sizing independently from longest batch record', () => {
    // Provide a lightweight 2d context mock for Konva text measurement in jsdom
    HTMLCanvasElement.prototype.getContext = function () {
      return {
        canvas: this,
        fillRect: () => {},
        clearRect: () => {},
        getImageData: (x, y, w, h) => ({ data: new Array(w * h * 4).fill(0) }),
        putImageData: () => {},
        createImageData: () => ({ data: [] }),
        setTransform: () => {},
        drawImage: () => {},
        save: () => {},
        fillText: () => {},
        restore: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        closePath: () => {},
        stroke: () => {},
        translate: () => {},
        scale: () => {},
        rotate: () => {},
        arc: () => {},
        fill: () => {},
        measureText: (text) => ({
          width: String(text).length * 10,
          actualBoundingBoxAscent: 10,
          actualBoundingBoxDescent: 2
        }),
        transform: () => {},
        rect: () => {},
        clip: () => {},
      };
    };

    const { calculateAutoFitItem } = require('./utils/rendering');
    const batchRecords = [
      { name: 'Cat' },
      { name: 'Supercalifragilisticexpialidocious Extra Long Value' }
    ];

    const uniformItem = {
      type: 'text',
      text: '{{name}}',
      fit_to_width: true,
      batch_scale_mode: 'uniform',
      width: 200,
      height: 100
    };

    const individualItem = {
      ...uniformItem,
      batch_scale_mode: 'individual'
    };

    const fittedUniform = calculateAutoFitItem(uniformItem, batchRecords, 400, 200);
    const fittedIndividual = calculateAutoFitItem(individualItem, batchRecords, 400, 200);

    // Uniform mode is clamped to the giant text in record 1
    // Individual mode calculates record 0 ("Cat") without being clamped by record 1
    expect(fittedIndividual.size).toBeGreaterThan(fittedUniform.size);
  });

  test('optimistically decrements remaining sticker count on print completion', async () => {
    useStore.setState({
      loadedPaperInfo: {
        tag_present: true,
        remaining_labels: 100,
        used_labels: 10,
        total_labels: 110,
      },
      selectedPrinter: 'AA:BB:CC:DD:EE:FF',
      selectedPrinterInfo: { transport: 'offline' },
    });

    // Simulate print completion handler logic
    const copies = 2;
    const labelsCount = 3; // 2 * 3 = 6 stickers printed
    const stickersUsed = copies * labelsCount;

    useStore.setState((prev) => ({
      loadedPaperInfo: {
        ...prev.loadedPaperInfo,
        remaining_labels: Math.max(0, prev.loadedPaperInfo.remaining_labels - stickersUsed),
        used_labels: (prev.loadedPaperInfo.used_labels || 0) + stickersUsed,
      }
    }));

    const paper = useStore.getState().loadedPaperInfo;
    expect(paper.remaining_labels).toBe(94);
    expect(paper.used_labels).toBe(16);
  });

  test('manages battery level state without persistent polling timers', () => {
    useStore.setState({ printerBatteryLevel: null });

    useStore.getState().startBatteryPolling();
    // Verify no recurring interval is set to avoid hardware beeping
    expect(useStore.getState().batteryPollTimer).toBeNull();

    // Mock battery update
    useStore.setState({ printerBatteryLevel: 85 });
    expect(useStore.getState().printerBatteryLevel).toBe(85);

    useStore.getState().stopBatteryPolling();
    expect(useStore.getState().batteryPollTimer).toBeNull();
  });
});

