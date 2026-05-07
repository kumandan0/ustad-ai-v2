import { NextRequest, NextResponse } from "next/server";
import { deleteStoredFile, readStoredFile, storeUploadedFile } from "@/lib/server/store";

export const runtime = "nodejs";

// Increase body size limit to 50MB for file uploads
export const maxDuration = 60;

export async function config() {
  return {
    api: {
      bodyParser: {
        sizeLimit: "50mb",
      },
    },
  };
}

function parseRangeHeader(rangeHeader: string | null, size: number) {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) {
    return null;
  }

  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : size - 1;

  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start < 0 || end >= size) {
    return null;
  }

  return { start, end };
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const bucket = url.searchParams.get("bucket");
    const filePath = url.searchParams.get("path");
    const type = url.searchParams.get("type") ?? undefined;

    if (!bucket || !filePath) {
      return NextResponse.json({ error: "Eksik dosya bilgisi." }, { status: 400 });
    }

    const file = await readStoredFile(bucket, filePath);
    const size = file.buffer.length;
    const range = parseRangeHeader(request.headers.get("range"), size);
    const contentType = type || file.contentType;

    if (range) {
      const chunk = file.buffer.subarray(range.start, range.end + 1);
      return new NextResponse(chunk, {
        status: 206,
        headers: {
          "Content-Type": contentType,
          "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunk.length),
          "Cache-Control": "no-store",
        },
      });
    }

    return new NextResponse(file.buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
        "Content-Length": String(size),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Dosya okunamadi.";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const bucket = String(formData.get("bucket") ?? "");
    const filePath = String(formData.get("path") ?? "");
    const file = formData.get("file");

    if (!bucket || !filePath || !(file instanceof File)) {
      return NextResponse.json({ error: "Eksik yukleme bilgisi." }, { status: 400 });
    }

    const data = await storeUploadedFile(bucket, filePath, file);
    return NextResponse.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Dosya yuklenemedi.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const bucket = url.searchParams.get("bucket");
    const filePath = url.searchParams.get("path");

    if (!bucket || !filePath) {
      return NextResponse.json({ error: "Eksik dosya bilgisi." }, { status: 400 });
    }

    await deleteStoredFile(bucket, filePath);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Dosya silinemedi.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

