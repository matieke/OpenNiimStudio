export const normalizePageIndex = (value) => Math.max(0, Number(value) || 0);

export const getPageIndices = (canvasState = {}, options = {}) => {
  const indices = new Set([0]);

  (Array.isArray(canvasState.items) ? canvasState.items : []).forEach((item) => {
    indices.add(normalizePageIndex(item?.pageIndex));
  });

  (Array.isArray(canvasState.pageLayouts) ? canvasState.pageLayouts : []).forEach((layout) => {
    indices.add(normalizePageIndex(layout?.pageIndex));
  });

  if (
    options.includeCurrent !== false
    && canvasState.currentPage !== undefined
    && canvasState.currentPage !== null
  ) {
    indices.add(normalizePageIndex(canvasState.currentPage));
  }

  return [...indices].sort((a, b) => a - b);
};

export const getPageItems = (items, pageIndex) => {
  const targetPage = normalizePageIndex(pageIndex);
  return (Array.isArray(items) ? items : []).filter(
    (item) => normalizePageIndex(item?.pageIndex) === targetPage
  );
};

export const getPageLayout = (canvasState = {}, pageIndex = 0) => {
  const targetPage = normalizePageIndex(pageIndex);
  const layouts = Array.isArray(canvasState.pageLayouts) ? canvasState.pageLayouts : [];
  const exactLayout = layouts.find(
    (layout) => normalizePageIndex(layout?.pageIndex) === targetPage
  );

  if (exactLayout) return exactLayout;

  // Legacy single-page projects and API payloads used top-level HTML/template fields.
  if (targetPage === 0) {
    return {
      pageIndex: 0,
      htmlContent: canvasState.htmlContent || '',
      activeTemplate: canvasState.activeTemplate || null
    };
  }

  return { pageIndex: targetPage, htmlContent: '', activeTemplate: null };
};

export const getItemSectionBounds = (item, canvasWidth, canvasHeight, splitSections) => {
  if (!splitSections?.enabled) {
    return { x: 0, y: 0, width: canvasWidth, height: canvasHeight, isSection: false };
  }
  const rows = Math.min(6, Math.max(1, Number(splitSections.rows) || 1));
  const cols = Math.min(6, Math.max(1, Number(splitSections.cols) || 1));
  if (rows <= 1 && cols <= 1) {
    return { x: 0, y: 0, width: canvasWidth, height: canvasHeight, isSection: false };
  }

  const cellW = canvasWidth / cols;
  const cellH = canvasHeight / rows;

  const itemW = item?.width || 100;
  const itemH = item?.height || 50;
  const itemX = item?.x ?? 0;
  const itemY = item?.y ?? 0;

  let colIdx;
  let rowIdx;

  if (itemW >= canvasWidth) {
    colIdx = Math.floor(itemX / cellW);
  } else {
    const cx = itemX + itemW / 2;
    colIdx = Math.floor(cx / cellW);
  }

  if (itemH >= canvasHeight) {
    rowIdx = Math.floor(itemY / cellH);
  } else {
    const cy = itemY + itemH / 2;
    rowIdx = Math.floor(cy / cellH);
  }

  colIdx = Math.max(0, Math.min(cols - 1, colIdx || 0));
  rowIdx = Math.max(0, Math.min(rows - 1, rowIdx || 0));

  const startX = Math.round(colIdx * cellW);
  const startY = Math.round(rowIdx * cellH);
  const endX = Math.round((colIdx + 1) * cellW);
  const endY = Math.round((rowIdx + 1) * cellH);

  return {
    x: startX,
    y: startY,
    width: endX - startX,
    height: endY - startY,
    colIndex: colIdx,
    rowIndex: rowIdx,
    isSection: true
  };
};

