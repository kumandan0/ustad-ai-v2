"use client";

type Primitive = string | number | boolean | null;
type Row = Record<string, any>;
type TableName =
  | "courses"
  | "weeks"
  | "flashcards"
  | "test_questions"
  | "open_ended_questions"
  | "materials"
  | "learning_goals";

type Filter = { column: string; value: Primitive };

type DbResponse<T> = Promise<{ data: T; error: Error | null }>;

type DbRequest = {
  action: "select" | "insert" | "update" | "delete";
  table: TableName;
  filters?: Filter[];
  payload?: Row | Row[];
  orderColumn?: string | null;
  ascending?: boolean;
  selectAfterMutation?: boolean;
  returnSingle?: boolean;
};

type LegacyDbShape = Record<TableName, Row[]>;

const LEGACY_DB_KEY = "ustad-ai-local-db";
const LEGACY_FILE_MAP_KEY = "ustad-ai-local-storage";
const LEGACY_FILE_DB_NAME = "ustad-ai-local-files";
const LEGACY_FILE_STORE_NAME = "files";
const LEGACY_MIGRATION_FLAG = "ustad-ai-legacy-migrated-v1";

const legacyObjectUrlCache = new Map<string, string>();

const EMPTY_LEGACY_DB: LegacyDbShape = {
  courses: [],
  weeks: [],
  flashcards: [],
  test_questions: [],
  open_ended_questions: [],
  materials: [],
  learning_goals: [],
};

const LEGACY_TEXT_FIXES: Record<string, string> = {
  "Insan Haklari Hukuku": "İnsan Hakları Hukuku",
  "AIHM, AYM bireysel basvuru ve BM mekanizmalari":
    "AİHM, AYM bireysel başvuru ve BM mekanizmaları",
  "Sen Insan Haklari Hukuku alaninda uzman bir Turk hukuk asistanisin. Ogrencilere Turkce olarak yardim ediyorsun. Yanitlarin acik, pedagojik ve pratik orneklerle desteklenmis olsun.":
    "Sen İnsan Hakları Hukuku alanında uzman bir Türk hukuk asistanısın. Öğrencilere Türkçe olarak yardım ediyorsun. Yanıtların açık, pedagojik ve pratik örneklerle desteklenmiş olsun.",
  "Dersin amacinin ve islenis stratejisinin anlatilmasi":
    "Dersin amacının ve işleniş stratejisinin anlatılması",
  "Genel olarak insan haklarina giris ve insan haklari felsefesi":
    "Genel olarak insan haklarına giriş ve insan hakları felsefesi",
  "Insan haklarinin ozellikleri ve haklarin siniflandirilmasi":
    "İnsan haklarının özellikleri ve hakların sınıflandırılması",
  "Insan haklari koruma mekanizmalari": "İnsan hakları koruma mekanizmaları",
  "BM insan haklari koruma mekanizmalari": "BM insan hakları koruma mekanizmaları",
  "Anayasa Mahkemesi bireysel basvuru": "Anayasa Mahkemesi bireysel başvuru",
  "Avrupa Insan Haklari Mahkemesinin yapisi ve isleyisi":
    "Avrupa İnsan Hakları Mahkemesinin yapısı ve işleyişi",
  "AIHM'ye bireysel basvuru ve sartlar": "AİHM'ye bireysel başvuru ve şartlar",
  "Genel tekrar ve odev dagitimi": "Genel tekrar ve ödev dağıtımı",
  "Avrupa Insan Haklari Sozlesmesindeki haklar":
    "Avrupa İnsan Hakları Sözleşmesindeki haklar",
  "Odev ve sunum": "Ödev ve sunum",
  "Final sinavi": "Final sınavı",
  "Temel kavramlari kavra": "Temel kavramları kavra",
  "Basvuru sartlarini ogren": "Başvuru şartlarını öğren",
  "Mekanizmalari analiz et": "Mekanizmaları analiz et",
};

function normalizeLegacyValue<T>(value: T): T {
  if (typeof value === "string") {
    return (LEGACY_TEXT_FIXES[value] ?? value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeLegacyValue(item)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        normalizeLegacyValue(item),
      ]),
    ) as T;
  }

  return value;
}

async function requestDb<T>(body: DbRequest): DbResponse<T> {
  try {
    const response = await fetch("/api/db", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      data?: T;
      error?: string;
    };

    if (!response.ok) {
      return {
        data: null as T,
        error: new Error(payload.error || `Request failed with status ${response.status}`),
      };
    }

    return { data: payload.data as T, error: null };
  } catch (error) {
    return {
      data: null as T,
      error: error instanceof Error ? error : new Error("Database request failed."),
    };
  }
}

async function requestJson<T>(url: string, body: Record<string, unknown>): DbResponse<T> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      data?: T;
      error?: string;
    };

    if (!response.ok) {
      return {
        data: null as T,
        error: new Error(payload.error || `Request failed with status ${response.status}`),
      };
    }

    return { data: payload.data as T, error: null };
  } catch (error) {
    return {
      data: null as T,
      error: error instanceof Error ? error : new Error("Request failed."),
    };
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeLegacyDb(raw: Partial<LegacyDbShape>): LegacyDbShape {
  return normalizeLegacyValue({
    ...clone(EMPTY_LEGACY_DB),
    ...raw,
  });
}

function readLegacyDbFromLocalStorage(): LegacyDbShape | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(LEGACY_DB_KEY);
  if (!raw) {
    return null;
  }

  try {
    return normalizeLegacyDb(JSON.parse(raw) as Partial<LegacyDbShape>);
  } catch {
    return null;
  }
}

function readLegacyFileMapFromLocalStorage(): Record<string, string> {
  if (typeof window === "undefined") {
    return {};
  }

  const raw = window.localStorage.getItem(LEGACY_FILE_MAP_KEY);
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function openLegacyFileDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !("indexedDB" in window)) {
      reject(new Error("IndexedDB is not available"));
      return;
    }

    const request = window.indexedDB.open(LEGACY_FILE_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LEGACY_FILE_STORE_NAME)) {
        db.createObjectStore(LEGACY_FILE_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readLegacyIndexedFile(key: string): Promise<Blob | null> {
  return openLegacyFileDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(LEGACY_FILE_STORE_NAME, "readonly");
        const store = transaction.objectStore(LEGACY_FILE_STORE_NAME);
        const request = store.get(key);

        request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
        request.onerror = () => reject(request.error);
      }),
  );
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob | null> {
  try {
    const response = await fetch(dataUrl);
    return await response.blob();
  } catch {
    return null;
  }
}

function parseLegacyFileUrl(url: string) {
  if (url.startsWith("idb://")) {
    const withoutScheme = url.slice("idb://".length);
    const slashIndex = withoutScheme.indexOf("/");
    if (slashIndex === -1) {
      return null;
    }

    const bucket = withoutScheme.slice(0, slashIndex);
    const filePath = decodeURIComponent(withoutScheme.slice(slashIndex + 1));
    return { bucket, filePath, key: `${bucket}:${filePath}` };
  }

  if (url.startsWith("data:")) {
    return { dataUrl: url };
  }

  return null;
}

async function readLegacyBlobFromUrl(url: string): Promise<Blob | null> {
  const parsed = parseLegacyFileUrl(url);
  if (!parsed) {
    return null;
  }

  if ("dataUrl" in parsed) {
    return dataUrlToBlob(parsed.dataUrl);
  }

  const map = readLegacyFileMapFromLocalStorage();
  const mappedDataUrl = map[parsed.key];
  if (mappedDataUrl) {
    const mappedBlob = await dataUrlToBlob(mappedDataUrl);
    if (mappedBlob) {
      return mappedBlob;
    }
  }

  return readLegacyIndexedFile(parsed.key);
}

function sanitizePathPart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "file";
}

function buildMigrationPath(material: Row, sourceUrl: string) {
  const parsed = parseLegacyFileUrl(sourceUrl);
  if (parsed && "bucket" in parsed) {
    return parsed.filePath;
  }

  const fileName = sanitizePathPart(String(material.file_name ?? `material-${material.id}`));
  return `materials/migrated/${material.course_id}/${material.week_index}/${material.id}-${fileName}`;
}

// YENİ: VERCEL LİMİTİNİ AŞIP DOĞRUDAN SUPABASE'E YÜKLEYEN FONKSİYON
async function uploadFile(bucket: string, filePath: string, file: Blob | File, fileName?: string) {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_