import React from 'react';
import { useStore } from '../store';
import { calculateAutoFitItem } from '../utils/rendering';
import { getItemSectionBounds } from '../utils/canvasPages';
import {
  AlignLeft, AlignCenter, AlignRight,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  Bold, Italic, Maximize, BoxSelect, WrapText, ArrowRightToLine,
  Trash2, Layers
} from 'lucide-react';

const ToolbarButton = ({ icon: Icon, onClick, active, title, className = '' }) => (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    title={title}
    aria-label={title}
    className={`p-1.5 rounded transition-colors ${
      active
        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400'
        : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-900 dark:hover:text-white'
    } ${className}`}
  >
    <Icon size={16} strokeWidth={2.5} />
  </button>
);

const HoverMenuGroup = ({ currentIcon: Icon, title, children }) => (
  <div className="relative group flex items-center" onMouseDown={(e) => e.stopPropagation()}>
    <button
      type="button"
      className="p-1.5 text-neutral-600 dark:text-neutral-400 cursor-default group-hover:text-neutral-900 dark:group-hover:text-white transition-colors"
      title={title}
      aria-label={title}
      aria-haspopup="menu"
    >
      <Icon size={16} strokeWidth={2.5} />
    </button>
    <div className="absolute bottom-full left-1/2 z-50 hidden -translate-x-1/2 group-hover:block group-focus-within:block pb-2" role="menu">
      <div className="flex gap-1 rounded-lg border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
        {children}
      </div>
    </div>
  </div>
);

export default function FloatingToolbar({ item, zoomScale, canvasWidth, canvasHeight, workspacePad = 0 }) {
  const updateItem = useStore((state) => state.updateItem);
  const deleteItem = useStore((state) => state.deleteItem);
  const splitSections = useStore((state) => state.splitSections);

  if (!item || item.type === 'cut_line_indicator') return null;

  const isText = item.type === 'text';

  const handleFillCanvas = () => {
    const bounds = getItemSectionBounds(item, canvasWidth, canvasHeight, splitSections);
    let updated = {
      ...item,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height
    };

    if (isText) {
      updated.align = 'center';
      updated.verticalAlign = 'middle';
      updated.fit_to_width = true;
      updated.batch_scale_mode = 'individual';
      updated = calculateAutoFitItem(updated, useStore.getState().batchRecords, bounds.width, bounds.height);
    }

    updateItem(item.id, updated);
  };

  const handleFitBox = () => {
    if (!isText) return;

    let updated = { ...item, fit_to_width: !item.fit_to_width };
    if (updated.fit_to_width) {
      updated.batch_scale_mode = 'individual';
      const bounds = getItemSectionBounds(item, canvasWidth, canvasHeight, splitSections);
      updated = calculateAutoFitItem(updated, useStore.getState().batchRecords, bounds.width, bounds.height);
    }
    updateItem(item.id, updated);
  };

  const HAlignIcon = item.align === 'left' ? AlignLeft : item.align === 'right' ? AlignRight : AlignCenter;
  const VAlignIcon = item.verticalAlign === 'top' ? AlignStartVertical : item.verticalAlign === 'bottom' ? AlignEndVertical : AlignCenterVertical;

  const topPos = ((item.y + workspacePad) * zoomScale) - 48;
  const leftPos = (item.x + workspacePad) * zoomScale;

  return (
    <div
      className="absolute z-50 flex items-center gap-1 p-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-xl"
      style={{
        top: Math.max(-10, topPos),
        left: Math.max(0, leftPos),
        transform: 'translateY(-10px)'
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {isText && (
        <>
          <HoverMenuGroup currentIcon={HAlignIcon} title="Horizontal Alignment">
            <ToolbarButton icon={AlignLeft} active={item.align === 'left'} onClick={() => updateItem(item.id, { align: 'left' })} title="Align Left" />
            <ToolbarButton icon={AlignCenter} active={item.align === 'center' || !item.align} onClick={() => updateItem(item.id, { align: 'center' })} title="Align Center" />
            <ToolbarButton icon={AlignRight} active={item.align === 'right'} onClick={() => updateItem(item.id, { align: 'right' })} title="Align Right" />
          </HoverMenuGroup>

          <HoverMenuGroup currentIcon={VAlignIcon} title="Vertical Alignment">
            <ToolbarButton icon={AlignStartVertical} active={item.verticalAlign === 'top'} onClick={() => updateItem(item.id, { verticalAlign: 'top' })} title="Align Top" />
            <ToolbarButton icon={AlignCenterVertical} active={item.verticalAlign === 'middle' || !item.verticalAlign} onClick={() => updateItem(item.id, { verticalAlign: 'middle' })} title="Align Middle" />
            <ToolbarButton icon={AlignEndVertical} active={item.verticalAlign === 'bottom'} onClick={() => updateItem(item.id, { verticalAlign: 'bottom' })} title="Align Bottom" />
          </HoverMenuGroup>

          <div className="w-px h-5 bg-neutral-200 dark:bg-neutral-700 mx-1" />

          <ToolbarButton icon={Bold} active={item.weight >= 700} onClick={() => updateItem(item.id, { weight: item.weight >= 700 ? 400 : 700 })} title="Bold" />
          <ToolbarButton icon={Italic} active={item.italic} onClick={() => updateItem(item.id, { italic: !item.italic })} title="Italic" />
          <ToolbarButton
            icon={item.no_wrap ? ArrowRightToLine : WrapText}
            active={item.no_wrap}
            onClick={() => {
              const next = { ...item, no_wrap: !item.no_wrap };
              updateItem(
                item.id,
                next.fit_to_width
                  ? calculateAutoFitItem(next, useStore.getState().batchRecords, canvasWidth, canvasHeight)
                  : next
              );
            }}
            title={item.no_wrap ? 'Enable Word Wrap' : 'Force Single Line'}
          />

          <div className="w-px h-5 bg-neutral-200 dark:bg-neutral-700 mx-1" />

          <ToolbarButton icon={BoxSelect} active={item.fit_to_width} onClick={handleFitBox} title="Auto-Scale Font to Fit Box" />
          {item.fit_to_width && (
            <ToolbarButton
              icon={Layers}
              active={item.batch_scale_mode === 'individual' || (splitSections?.enabled && item.batch_scale_mode !== 'uniform')}
              onClick={() => {
                const currentIndividual = item.batch_scale_mode === 'individual' || (splitSections?.enabled && item.batch_scale_mode !== 'uniform');
                updateItem(item.id, { batch_scale_mode: currentIndividual ? 'uniform' : 'individual' });
              }}
              title={
                (item.batch_scale_mode === 'individual' || (splitSections?.enabled && item.batch_scale_mode !== 'uniform'))
                  ? "Scale Individually: Each page/record fits to its own text"
                  : "Scale Uniformly: Locked to largest text across pages"
              }
            />
          )}
        </>
      )}

      <ToolbarButton
        icon={Maximize}
        active={false}
        onClick={handleFillCanvas}
        title={splitSections?.enabled ? "Maximize to Fill Section" : "Maximize to Fill Entire Canvas"}
      />

      <div className="w-px h-5 bg-neutral-200 dark:bg-neutral-700 mx-1" />

      <ToolbarButton
        icon={Trash2}
        active={false}
        onClick={() => deleteItem(item.id)}
        title="Delete Item"
        className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/30"
      />
    </div>
  );
}
