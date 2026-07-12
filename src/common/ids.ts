import { v7 as uuidv7 } from 'uuid';

/** UUID v7 primary keys (CLAUDE.md §4). Time-ordered → index-friendly. */
export const newId = (): string => uuidv7();
