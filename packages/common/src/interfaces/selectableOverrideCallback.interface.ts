import { SlickGrid } from './slickGrid.interface';

/** Method that user can pass to override the default behavior or making every row a selectable row. */
export type SelectableOverrideCallback<T> = (
  /** Row position in the grid */
  row: number,

  /** Item data context object */
  dataContext: T,

  /** SlickGrid object */
  grid: SlickGrid
) => boolean;