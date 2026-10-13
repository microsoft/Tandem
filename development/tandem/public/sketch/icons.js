// Controlled 24-unit primitives. Model data selects a name, never path markup.
export const ICON_PATHS = Object.freeze({
  mail: 'M3 5 H21 V19 H3 Z M3 6 L12 13 L21 6',
  folder: 'M3 7 V5 H10 L13 8 H21 V20 H3 Z',
  search: 'M16 10 A6 6 0 1 1 4 10 A6 6 0 1 1 16 10 M15 15 L21 21',
  user: 'M16 7 A4 4 0 1 1 8 7 A4 4 0 1 1 16 7 M4 21 C4 12 20 12 20 21',
  document: 'M5 3 H15 L20 8 V21 H5 Z M15 3 V8 H20 M8 12 H16 M8 16 H16',
  database: 'M3 6 C3 2 21 2 21 6 C21 10 3 10 3 6 V18 C3 22 21 22 21 18 V6 M3 12 C3 16 21 16 21 12',
  service: 'M4 4 H20 V10 H4 Z M4 14 H20 V20 H4 Z M7 7 H9 M7 17 H9',
  queue: 'M3 5 H16 V9 H3 Z M7 13 H20 V17 H7 Z M3 21 H16',
  check: 'M4 12 L9 17 L20 6',
  warning: 'M12 3 L22 21 H2 Z M12 9 V14 M12 17 V18',
});
export const ICON_NAMES = Object.freeze(Object.keys(ICON_PATHS));
