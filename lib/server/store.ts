import { Redis } from "@upstash/redis";
import { put } from "@vercel/blob";
import path from "path";

// Vercel'in verdiği KV şifrelerini yeni pakete zorla tanıtıyoruz
const kv = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "",
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "",
});

type Primitive = string | number | boolean | null;
type Row = Record<string, any>;

export type TableName =
  | "courses"
  | "weeks"
  | "flashcards"
  | "test_questions"
  | "open_ended_questions"
  | "materials"
  | "learning_goals";

export type Filter = { column: string; value: Primitive };

export type DbRequest = {
  action: "select" | "insert" | "update" | "delete" | "replace";
  table?: TableName;
  db?: DbShape;
  filters?: Filter[];
  payload?: Row | Row[];
  orderColumn?: string | null;
  ascending?: boolean;
  selectAfterMutation?: boolean;
  returnSingle?: boolean;
};

type DbShape = Record<TableName, Row[]>;

const EMPTY_DB: DbShape = {
  courses: [],
  weeks: [],
  flashcards: [],
  test_questions: [],
  open_ended_questions: [],
  materials: [],
  learning_goals: [],
};

let dbQueue: Promise<void> = Promise.resolve();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function withDbLock<T>(task: () => Promise<T>): Promise<T> {
  const previous = dbQueue;
  let release = () => {};
  dbQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}

async function readDb(): Promise<DbShape> {
  try {
    const parsed = await kv.get<Partial<DbShape>>("ustad_db_main");
    return { ...clone(EMPTY_DB), ...(parsed || {}) };
  } catch (error) {
    return clone(EMPTY_DB);
  }
}

async function writeDb(db: DbShape) {
  await kv.set("ustad_db_main", db);
}

function isTableName(table: string): table is TableName {
  return table in EMPTY_DB;
}

function nextId(rows: Row[]) {
  return Math.max(0, ...rows.map((row) => Number(row.id) || 0)) + 1;
}

function matches(row: Row, filters: Filter[] = []) {
  return filters.every((filter) => row[filter.column] === filter.value);
}

function sortRows(rows: Row[], column: string, ascending = true) {
  return [...rows].sort((left, right) => {
    const leftValue = left[column];
    const rightValue = right[column];

    if (leftValue === rightValue) return 0;
    if (leftValue === undefined || leftValue === null) return 1;
    if (rightValue === undefined || rightValue === null) return -1;
    if (leftValue < rightValue) return ascending ? -1 : 1;
    return ascending ? 1 : -1;
  });
}

function normalizeInsertRows(payload: Row | Row[], existingRows: Row[]) {
  const now = new Date().toISOString();
  const rows = Array.isArray(payload) ? payload : [payload];

  return rows.map((row, index) => ({
    ...clone(row),
    id: nextId(existingRows) + index,
    created_at: row.created_at ?? now,
  }));
}

function cascadeDelete(db: DbShape, deletedRows: Row[]) {
  const deletedIds = new Set(deletedRows.map((row) => row.id));
  db.weeks = db.weeks.filter((row) => !deletedIds.has(row.course_id));
  db.flashcards = db.flashcards.filter((row) => !deletedIds.has(row.course_id));
  db.test_questions = db.test_questions.filter((row) => !deletedIds.has(row.course_id));
  db.open_ended_questions = db.open_ended_questions.filter((row) => !deletedIds.has(row.course_id));
  db.materials = db.materials.filter((row) => !deletedIds.has(row.course_id));
  db.learning_goals = db.learning_goals.filter((row) => !deletedIds.has(row.course_id));
}

export async function queryTable(request: DbRequest) {
  if (request.action === "replace") {
    if (!request.db) throw new Error("Missing database payload.");
    return withDbLock(async () => {
      const nextDb = clone({ ...EMPTY_DB, ...request.db }) as DbShape;
      await writeDb(nextDb);
      return clone(nextDb);
    });
  }

  if (!request.table || !isTableName(request.table)) {
    throw new Error("Unknown table.");
  }

  return withDbLock(async () => {
    const db = await readDb();
    const tableRows = db[request.table!];
    let result: Row[] = [];

    if (request.action === "select") {
      result = tableRows.filter((row) => matches(row, request.filters));
    }

    if (request.action === "insert") {
      const insertedRows = normalizeInsertRows(request.payload ?? {}, tableRows);
      db[request.table!] = [...tableRows, ...insertedRows];
      result = request.selectAfterMutation ? insertedRows : [];
      await writeDb(db);
    }

    if (request.action === "update") {
      const updatedRows: Row[] = [];
      db[request.table!] = tableRows.map((row) => {
        if (!matches(row, request.filters)) return row;
        const updated = { ...row, ...clone((request.payload ?? {}) as Row) };
        updatedRows.push(updated);
        return updated;
      });
      result = request.selectAfterMutation ? updatedRows : [];
      await writeDb(db);
    }

    if (request.action === "delete") {
      const deletedRows = tableRows.filter((row) => matches(row, request.filters));
      db[request.table!] = tableRows.filter((row) => !matches(row, request.filters));
      if (request.table === "courses") cascadeDelete(db, deletedRows);
      result = request.selectAfterMutation ? deletedRows : [];
      await writeDb(db);
    }

    if (request.orderColumn) {
      result = sortRows(result, request.orderColumn, request.ascending);
    }

    return request.returnSingle ? (result[0] ?? null) : clone(result);
  });
}

function inferContentType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".pdf": return "application/pdf";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    default: return "application/octet-stream";
  }
}

export async function storeUploadedFile(bucket: string, filePath: string, file: File) {
  const blobPath = `${bucket}/${filePath}`;
  const blob = await put(blobPath, file, { access: 'public' });
  return {
    path: blobPath,
    publicUrl: blob.url,
    contentType: file.type || inferContentType(filePath),
  };
}

export async function deleteStoredFile(bucket: string, filePath: string) {
  // Vercel Blob otomatik yönetim sağlar
}

export async function readStoredFile(bucket: string, filePath: string) {
  return { buffer: Buffer.from(""), contentType: "application/octet-stream" };
}

export function getPublicFileUrl(bucket: string, filePath: string) {
  return `/api/files?bucket=${bucket}&path=${filePath}`;
}