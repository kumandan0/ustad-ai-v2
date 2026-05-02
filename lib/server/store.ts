import { promises as fs } from "fs";
import path from "path";

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

const DATA_DIR = path.join(process.cwd(), ".data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

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

async function ensureDirs() {
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
}

async function readDb(): Promise<DbShape> {
  await ensureDirs();

  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<DbShape>;
    return { ...clone(EMPTY_DB), ...parsed };
  } catch (error) {
    const isMissing = (error as NodeJS.ErrnoException)?.code === "ENOENT";
    if (!isMissing) {
      throw error;
    }

    await writeDb(clone(EMPTY_DB));
    return clone(EMPTY_DB);
  }
}

async function writeDb(db: DbShape) {
  await ensureDirs();
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf8");
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

    if (leftValue === rightValue) {
      return 0;
    }

    if (leftValue === undefined || leftValue === null) {
      return 1;
    }

    if (rightValue === undefined || rightValue === null) {
      return -1;
    }

    if (leftValue < rightValue) {
      return ascending ? -1 : 1;
    }

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

function safeRelativePath(filePath: string) {
  const normalized = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, "");
  if (!normalized || path.isAbsolute(normalized)) {
    throw new Error("Invalid file path.");
  }
  return normalized;
}

function resolveUploadPath(bucket: string, filePath: string) {
  const relativePath = safeRelativePath(filePath);
  const bucketDir = path.join(UPLOADS_DIR, bucket);
  const absolutePath = path.resolve(bucketDir, relativePath);

  if (absolutePath !== bucketDir && !absolutePath.startsWith(`${bucketDir}${path.sep}`)) {
    throw new Error("Invalid file path.");
  }

  return { bucketDir, absolutePath, relativePath };
}

function inferContentType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".mp3":
      return "audio/mpeg";
    case ".m4a":
      return "audio/mp4";
    case ".aac":
      return "audio/aac";
    case ".wav":
      return "audio/wav";
    case ".ogg":
      return "audio/ogg";
    case ".webm":
      return "audio/webm";
    case ".mp4":
      return "video/mp4";
    default:
      return "application/octet-stream";
  }
}

function buildPublicUrl(bucket: string, filePath: string, contentType?: string) {
  const params = new URLSearchParams({ bucket, path: filePath });
  if (contentType) {
    params.set("type", contentType);
  }
  return `/api/files?${params.toString()}`;
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
    if (!request.db) {
      throw new Error("Missing database payload.");
    }

    return withDbLock(async () => {
      const nextDb = clone({
        ...EMPTY_DB,
        ...request.db,
      }) as DbShape;
      await writeDb(nextDb);
      return clone(nextDb);
    });
  }

  if (!request.table || !isTableName(request.table)) {
    throw new Error("Unknown table.");
  }

  return withDbLock(async () => {
    const db = await readDb();
    const tableRows = db[request.table];
    let result: Row[] = [];

    if (request.action === "select") {
      result = tableRows.filter((row) => matches(row, request.filters));
    }

    if (request.action === "insert") {
      const insertedRows = normalizeInsertRows(request.payload ?? {}, tableRows);
      db[request.table] = [...tableRows, ...insertedRows];
      result = request.selectAfterMutation ? insertedRows : [];
      await writeDb(db);
    }

    if (request.action === "update") {
      const updatedRows: Row[] = [];
      db[request.table] = tableRows.map((row) => {
        if (!matches(row, request.filters)) {
          return row;
        }

        const updated = {
          ...row,
          ...clone((request.payload ?? {}) as Row),
        };
        updatedRows.push(updated);
        return updated;
      });
      result = request.selectAfterMutation ? updatedRows : [];
      await writeDb(db);
    }

    if (request.action === "delete") {
      const deletedRows = tableRows.filter((row) => matches(row, request.filters));
      db[request.table] = tableRows.filter((row) => !matches(row, request.filters));

      if (request.table === "courses") {
        cascadeDelete(db, deletedRows);
      }

      result = request.selectAfterMutation ? deletedRows : [];
      await writeDb(db);
    }

    if (request.orderColumn) {
      result = sortRows(result, request.orderColumn, request.ascending);
    }

    return request.returnSingle ? (result[0] ?? null) : clone(result);
  });
}

export async function storeUploadedFile(bucket: string, filePath: string, file: File) {
  const { absolutePath, relativePath } = resolveUploadPath(bucket, filePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });

  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(absolutePath, buffer);

  const contentType = file.type || inferContentType(relativePath);
  return {
    path: relativePath,
    publicUrl: buildPublicUrl(bucket, relativePath, contentType),
    contentType,
  };
}

export async function deleteStoredFile(bucket: string, filePath: string) {
  const { absolutePath } = resolveUploadPath(bucket, filePath);
  await fs.rm(absolutePath, { force: true });
}

export async function readStoredFile(bucket: string, filePath: string) {
  const { absolutePath, relativePath } = resolveUploadPath(bucket, filePath);
  const buffer = await fs.readFile(absolutePath);
  return {
    buffer,
    contentType: inferContentType(relativePath),
  };
}

export function getPublicFileUrl(bucket: string, filePath: string) {
  const relativePath = safeRelativePath(filePath);
  return buildPublicUrl(bucket, relativePath);
}
