export interface QuickEditOption {
  /** When enabled, start a quick edit as soon as the user types any printable character. */
  startOnPrintableKey?: boolean;

  /** When enabled, seed the opened editor with the first typed character. */
  seedWithTypedChar?: boolean;

  /** Allow the Enter key to trigger quick edit even before typing any other characters. */
  allowEnterToStart?: boolean;

  /** Ignore quick edit when Meta/Ctrl key combinations are pressed. */
  ignoreWithMetaKey?: boolean;

  /** List of eligible editor keys that support quick edit (for example: text, integer, float, number). */
  eligibleEditors?: string[];

  /** Move the caret to the end of the value after entering edit mode via double-click or quick edit. */
  moveCaretToEndOnDblClick?: boolean;
}
