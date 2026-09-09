import { describe, expect, test } from 'vitest';
import { getItemSectionBounds, getPageIndices, getPageItems, getPageLayout, normalizePageIndex } from './canvasPages';

describe('canvas page model', () => {
  test('normalizes invalid page indices and returns a sorted union', () => {
    expect(normalizePageIndex(-4)).toBe(0);
    expect(normalizePageIndex('3')).toBe(3);
    expect(getPageIndices({
      currentPage: 2,
      items: [{ pageIndex: 4 }, { pageIndex: 0 }],
      pageLayouts: [{ pageIndex: 3 }]
    })).toEqual([0, 2, 3, 4]);
  });

  test('never copies the last page items into an HTML-only page', () => {
    const items = [{ id: 'p0', pageIndex: 0 }];
    expect(getPageItems(items, 1)).toEqual([]);
    expect(getPageItems(items, 0)).toEqual(items);
  });

  test('uses legacy top-level HTML only for page zero', () => {
    const state = { htmlContent: '<b>legacy</b>', activeTemplate: { id: 'legacy' } };
    expect(getPageLayout(state, 0).htmlContent).toBe('<b>legacy</b>');
    expect(getPageLayout(state, 1).htmlContent).toBe('');
  });

  test('getItemSectionBounds accurately identifies section target bounds', () => {
    // Disabled splitSections: returns entire canvas
    expect(getItemSectionBounds({ x: 50, y: 50, width: 100, height: 40 }, 400, 200, { enabled: false }))
      .toEqual({ x: 0, y: 0, width: 400, height: 200, isSection: false });

    // 2x2 grid on 400x200 canvas -> each section is 200x100
    const split = { enabled: true, rows: 2, cols: 2 };

    // Item in Section 1 (top-left: col 0, row 0)
    expect(getItemSectionBounds({ x: 20, y: 20, width: 60, height: 30 }, 400, 200, split))
      .toEqual({ x: 0, y: 0, width: 200, height: 100, colIndex: 0, rowIndex: 0, isSection: true });

    // Item in Section 2 (top-right: col 1, row 0)
    expect(getItemSectionBounds({ x: 250, y: 20, width: 60, height: 30 }, 400, 200, split))
      .toEqual({ x: 200, y: 0, width: 200, height: 100, colIndex: 1, rowIndex: 0, isSection: true });

    // Item in Section 3 (bottom-left: col 0, row 1)
    expect(getItemSectionBounds({ x: 20, y: 130, width: 60, height: 30 }, 400, 200, split))
      .toEqual({ x: 0, y: 100, width: 200, height: 100, colIndex: 0, rowIndex: 1, isSection: true });

    // Item in Section 4 (bottom-right: col 1, row 1)
    expect(getItemSectionBounds({ x: 250, y: 130, width: 60, height: 30 }, 400, 200, split))
      .toEqual({ x: 200, y: 100, width: 200, height: 100, colIndex: 1, rowIndex: 1, isSection: true });

    // Item with canvasWidth (newly added default): detects row and defaults to column 0
    expect(getItemSectionBounds({ x: 0, y: 120, width: 400, height: 40 }, 400, 200, split))
      .toEqual({ x: 0, y: 100, width: 200, height: 100, colIndex: 0, rowIndex: 1, isSection: true });
  });
});
