import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

// Creates the SQLite file if it doesn't exist
const sqlite = new Database('sqlite.db');

// Initialize Drizzle with your schema
export const db = drizzle(sqlite, { schema });