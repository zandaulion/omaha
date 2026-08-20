/**
 * Pocket Omaha — the PWA server's binding of the shared stock engine.
 *
 * All the logic lives in `core/stock.js`. What belongs to this host, and only
 * to this host, is the choice of where records are kept: SQLite, via
 * `node:sqlite`. Android will make the same choice differently, against Room.
 *
 * Registered here rather than in an entry point because every path that
 * reaches a stock — the API, the alert sweep, the prompt dumper, the tests —
 * already comes through this module, and a store that is configured in only
 * three of the four places fails at the fourth.
 */

import { setStore } from '../core/store.js';
import { sqliteStore } from './store.js';

setStore(sqliteStore);

export { getStockData, searchStocks, __observeModel } from '../core/stock.js';
