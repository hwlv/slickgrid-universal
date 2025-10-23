import { queueMicrotaskOrSetTimeout } from '@slickgrid-universal/utils';
import { SlickEventData, SlickEventHandler } from '../core/slickCore.js';
import type { SlickGrid } from '../core/slickGrid.js';
import { Editors } from '../editors/editors.index.js';
import type {
  Column,
  Editor,
  EditorConstructor,
  GridOption,
  OnDblClickEventArgs,
  OnKeyDownEventArgs,
  OnSetOptionsEventArgs,
  QuickEditOption,
} from '../interfaces/index.js';

const NAVIGATION_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Tab',
  'Escape',
  'Esc',
  'F2',
]);

const NUMBER_FIRST_CHAR_REGEX = /^[0-9.-]$/;
const EDITOR_KEY_CACHE = new Map<EditorConstructor, string>();

type QuickEditSettings = {
  startOnPrintableKey: boolean;
  seedWithTypedChar: boolean;
  allowEnterToStart: boolean;
  ignoreWithMetaKey: boolean;
  eligibleEditors: string[];
  moveCaretToEndOnDblClick: boolean;
};

const DEFAULT_QUICK_EDIT_OPTIONS: QuickEditSettings = {
  startOnPrintableKey: true,
  seedWithTypedChar: true,
  allowEnterToStart: false,
  ignoreWithMetaKey: true,
  eligibleEditors: ['text', 'integer', 'float', 'number'],
  moveCaretToEndOnDblClick: true,
};

function resolveQuickEditOptions(option?: QuickEditOption): QuickEditSettings {
  const eligibleEditors = option?.eligibleEditors ?? DEFAULT_QUICK_EDIT_OPTIONS.eligibleEditors;
  const normalizedEligibleEditors = Array.from(new Set(eligibleEditors.map((key) => key.toLowerCase())));

  return {
    startOnPrintableKey: option?.startOnPrintableKey ?? DEFAULT_QUICK_EDIT_OPTIONS.startOnPrintableKey,
    seedWithTypedChar: option?.seedWithTypedChar ?? DEFAULT_QUICK_EDIT_OPTIONS.seedWithTypedChar,
    allowEnterToStart: option?.allowEnterToStart ?? DEFAULT_QUICK_EDIT_OPTIONS.allowEnterToStart,
    ignoreWithMetaKey: option?.ignoreWithMetaKey ?? DEFAULT_QUICK_EDIT_OPTIONS.ignoreWithMetaKey,
    eligibleEditors: normalizedEligibleEditors,
    moveCaretToEndOnDblClick: option?.moveCaretToEndOnDblClick ?? DEFAULT_QUICK_EDIT_OPTIONS.moveCaretToEndOnDblClick,
  };
}

export class QuickEditService {
  protected _grid?: SlickGrid;
  protected _gridOptions: GridOption = {};
  protected _quickEditSettings: QuickEditSettings = DEFAULT_QUICK_EDIT_OPTIONS;
  protected _eligibleEditorKeys: Set<string> = new Set(DEFAULT_QUICK_EDIT_OPTIONS.eligibleEditors);
  protected _eventHandler: SlickEventHandler;

  constructor() {
    this._eventHandler = new SlickEventHandler();
  }

  init(grid: SlickGrid): void {
    this._grid = grid;
    this._gridOptions = grid.getOptions?.() ?? {};
    this.refreshOptions();

    this._eventHandler.subscribe(grid.onKeyDown, (eventData, args) => this.handleKeyDown(eventData, args));
    this._eventHandler.subscribe(grid.onDblClick, (eventData, args) => this.handleDblClick(eventData, args));
    this._eventHandler.subscribe(grid.onSetOptions, (_event, args: OnSetOptionsEventArgs) => {
      this._gridOptions = args.optionsAfter;
      this.refreshOptions();
    });
    this._eventHandler.subscribe(grid.onBeforeDestroy, () => this.dispose());
  }

  dispose(): void {
    this._eventHandler.unsubscribeAll();
    this._grid = undefined;
  }

  protected handleKeyDown(eventData: SlickEventData<OnKeyDownEventArgs>, args: OnKeyDownEventArgs): void {
    const grid = this._grid;
    if (!grid || !this.isQuickEditEnabled() || !this._gridOptions.editable) {
      return;
    }

    if (!args || args.row === undefined || args.cell === undefined || !grid.canCellBeActive(args.row, args.cell)) {
      return;
    }

    if (grid.getCellEditor() || grid.getEditorLock()?.isActive()) {
      return;
    }

    const nativeEvent = eventData.getNativeEvent<KeyboardEvent>();
    if (!nativeEvent || nativeEvent.isComposing || nativeEvent.defaultPrevented || nativeEvent.repeat) {
      return;
    }

    if (nativeEvent.altKey) {
      return;
    }

    if ((nativeEvent.metaKey || nativeEvent.ctrlKey) && this._quickEditSettings.ignoreWithMetaKey) {
      return;
    }

    const key = nativeEvent.key;
    const isEnter = key === 'Enter';
    let seedChar: string | undefined;

    if (key === ' ' || key === 'Spacebar') {
      seedChar = ' ';
    } else if (key && key.length === 1 && key !== 'Dead') {
      seedChar = key;
    }

    if (seedChar !== undefined) {
      if (!this._quickEditSettings.startOnPrintableKey || NAVIGATION_KEYS.has(key)) {
        return;
      }
    } else if (!isEnter || !this._quickEditSettings.allowEnterToStart) {
      return;
    }

    const column = grid.getColumns()[args.cell];
    if (!column || !this.isColumnEligible(column)) {
      return;
    }

    if (seedChar !== undefined && this.isNumberColumn(column) && !NUMBER_FIRST_CHAR_REGEX.test(seedChar)) {
      return;
    }

    if (this.beginQuickEdit(args, column, nativeEvent, seedChar)) {
      eventData.stopImmediatePropagation();
      eventData.preventDefault();
    }
  }

  protected handleDblClick(_eventData: SlickEventData<OnDblClickEventArgs>, args: OnDblClickEventArgs): void {
    const grid = this._grid;
    if (!grid || !this.isQuickEditEnabled() || !this._quickEditSettings.moveCaretToEndOnDblClick) {
      return;
    }

    if (!args || args.row === undefined || args.cell === undefined) {
      return;
    }

    const column = grid.getColumns()[args.cell];
    if (!column || !this.isColumnEligible(column)) {
      return;
    }

    queueMicrotaskOrSetTimeout(() => {
      const editor = grid.getCellEditor();
      if (editor && this.isEditorEligible(editor)) {
        this.moveCaretToEnd(editor);
      }
    });
  }

  protected beginQuickEdit(
    args: OnKeyDownEventArgs,
    column: Column,
    nativeEvent: KeyboardEvent,
    seedChar?: string
  ): boolean {
    const grid = this._grid;
    if (!grid) {
      return false;
    }

    if (!grid.canCellBeActive(args.row, args.cell)) {
      return false;
    }

    const activeCell = grid.getActiveCell();
    if (!activeCell || activeCell.row !== args.row || activeCell.cell !== args.cell) {
      grid.setActiveCell(args.row, args.cell);
    }

    grid.editActiveCell(undefined, undefined, nativeEvent);

    // 透過微任務確保編輯器已經建立完畢，再注入首個字元並把游標移到結尾，營造 Excel 式的手感。
    queueMicrotaskOrSetTimeout(() => {
      const editor = grid.getCellEditor();
      if (!editor || !this.isEditorEligible(editor)) {
        return;
      }

      if (seedChar !== undefined && this._quickEditSettings.seedWithTypedChar) {
        editor.setValue?.(seedChar);
      }

      this.moveCaretToEnd(editor);
    });

    return true;
  }

  protected moveCaretToEnd(editor: Editor): void {
    const input = this.getEditorInputElement(editor);
    if (!input) {
      return;
    }

    input.focus();
    const length = input.value.length;

    if (typeof input.setSelectionRange === 'function') {
      input.setSelectionRange(length, length);
    } else {
      (input as any).selectionStart = length;
      (input as any).selectionEnd = length;
    }
  }

  protected getEditorInputElement(editor: Editor): HTMLInputElement | HTMLTextAreaElement | null {
    const element = (editor as any)?.editorDomElement as HTMLElement | undefined;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return element;
    }
    return null;
  }

  protected isColumnEligible(column: Column): boolean {
    const editorModel = column?.editor?.model as EditorConstructor | undefined;
    if (!editorModel) {
      return false;
    }

    const editorKey = this.resolveEditorKey(editorModel);
    if (editorKey && this._eligibleEditorKeys.has(editorKey)) {
      return true;
    }

    if (this._eligibleEditorKeys.has('number') && this.isNumberColumn(column, editorKey)) {
      return true;
    }

    return false;
  }

  protected isNumberColumn(column: Column, editorKey?: string): boolean {
    const loweredEditorKey = editorKey ?? '';
    if (['integer', 'float', 'number'].includes(loweredEditorKey)) {
      return true;
    }

    const columnType = (typeof column.type === 'string' ? column.type : '').toLowerCase();
    if (['integer', 'float', 'number'].includes(columnType)) {
      return true;
    }

    const editorType = (typeof column.editor?.type === 'string' ? column.editor?.type : '').toLowerCase();
    return ['integer', 'float', 'number'].includes(editorType);
  }

  protected resolveEditorKey(editorModel?: EditorConstructor): string | undefined {
    if (!editorModel) {
      return undefined;
    }

    let cached = EDITOR_KEY_CACHE.get(editorModel);
    if (cached) {
      return cached;
    }

    const foundEntry = Object.entries(Editors).find(([, ctor]) => ctor === editorModel);
    if (foundEntry) {
      cached = foundEntry[0].toLowerCase();
      EDITOR_KEY_CACHE.set(editorModel, cached);
      return cached;
    }

    if (editorModel.name) {
      cached = editorModel.name.toLowerCase();
      EDITOR_KEY_CACHE.set(editorModel, cached);
      return cached;
    }

    return undefined;
  }

  protected isEditorEligible(editor: Editor): boolean {
    return !!this.getEditorInputElement(editor);
  }

  protected isQuickEditEnabled(): boolean {
    return !!this._gridOptions?.enableQuickEdit;
  }

  protected refreshOptions(): void {
    this._quickEditSettings = resolveQuickEditOptions(this._gridOptions.quickEditOptions);
    this._eligibleEditorKeys = new Set(this._quickEditSettings.eligibleEditors);
  }
}
