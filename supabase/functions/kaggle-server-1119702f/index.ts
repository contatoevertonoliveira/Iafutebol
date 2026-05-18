const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-automation-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "600",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
    },
  });

const requireBearer = (req: Request) => {
  const auth = String(req.headers.get("authorization") ?? "");
  if (!auth.toLowerCase().startsWith("bearer ")) return json({ ok: false, error: "Unauthorized" }, 401);
  return null;
};

const readJson = async (req: Request) => {
  try {
    return await req.json();
  } catch {
    return {};
  }
};

const kaggleBasicAuth = (username: unknown, apiKey: unknown) => {
  const u = String(username ?? "").trim();
  const k = String(apiKey ?? "").trim();
  if (!u || !k) return null;
  const token = btoa(`${u}:${k}`);
  return `Basic ${token}`;
};

async function kaggleDownloadDatasetFile(params: {
  username: unknown;
  apiKey: unknown;
  dataset: unknown;
  fileName: unknown;
  maxBytes?: unknown;
}): Promise<{ csvText: string; fileName: string }> {
  const auth = kaggleBasicAuth(params.username, params.apiKey);
  if (!auth) throw new Error("Credenciais do Kaggle não fornecidas");

  const dataset = String(params.dataset ?? "").trim();
  const fileName = String(params.fileName ?? "").trim();
  if (!dataset || !dataset.includes("/")) throw new Error("Dataset inválido. Use owner/dataset-slug");
  if (!fileName) throw new Error("fileName não fornecido");

  const [owner, slug] = dataset.split("/", 2);
  if (!owner || !slug) throw new Error("Dataset inválido. Use owner/dataset-slug");

  const maxBytes =
    typeof params.maxBytes === "number"
      ? params.maxBytes
      : Number.isFinite(Number(params.maxBytes))
        ? Number(params.maxBytes)
        : 12 * 1024 * 1024;

  const url =
    `https://www.kaggle.com/api/v1/datasets/download/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}?file_name=${encodeURIComponent(fileName)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: auth },
    redirect: "follow",
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Kaggle error: ${res.status} ${errText}`.slice(0, 600));
  }

  const contentType = res.headers.get("content-type") || "";
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) {
    throw new Error(`Arquivo muito grande (${buf.byteLength} bytes). Aumente maxBytes ou use um CSV menor.`);
  }

  if (contentType.includes("text/csv") || contentType.includes("application/csv")) {
    return { csvText: new TextDecoder().decode(buf), fileName };
  }

  let chosenName = "";
  let chosenBytes: Uint8Array | null = null;
  try {
    const { unzipSync } = await import("https://esm.sh/fflate@0.8.2");
    const files = unzipSync(buf);
    const names = Object.keys(files);
    const preferred = names.find((n) =>
      n.toLowerCase().endsWith(".csv") && n.toLowerCase().includes(fileName.toLowerCase())
    );
    const csv = preferred ?? names.find((n) => n.toLowerCase().endsWith(".csv")) ?? "";
    if (!csv) throw new Error("ZIP sem CSV");
    chosenName = csv;
    chosenBytes = files[csv];
  } catch {
    const text = new TextDecoder().decode(buf);
    if (!text.includes(",")) throw new Error("Resposta não é CSV nem ZIP com CSV");
    return { csvText: text, fileName };
  }

  const csvText = new TextDecoder().decode(chosenBytes ?? new Uint8Array());
  return { csvText, fileName: chosenName || fileName };
}

async function kaggleListDatasetFiles(params: {
  username: unknown;
  apiKey: unknown;
  dataset: unknown;
}): Promise<Array<{ name: string; size?: number }>> {
  const auth = kaggleBasicAuth(params.username, params.apiKey);
  if (!auth) throw new Error("Credenciais do Kaggle não fornecidas");

  const dataset = String(params.dataset ?? "").trim();
  if (!dataset || !dataset.includes("/")) throw new Error("Dataset inválido. Use owner/dataset-slug");
  const [owner, slug] = dataset.split("/", 2);
  if (!owner || !slug) throw new Error("Dataset inválido. Use owner/dataset-slug");

  const url = `https://www.kaggle.com/api/v1/datasets/list/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}/files.json`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: auth },
    redirect: "follow",
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Kaggle error: ${res.status} ${errText}`.slice(0, 600));
  }

  const data = await res.json().catch(() => null);
  const files = Array.isArray((data as any)?.datasetFiles) ? (data as any).datasetFiles : Array.isArray(data) ? data : [];
  return files
    .map((f: any) => ({
      name: String(f?.name ?? f?.fileName ?? f?.ref ?? "").trim(),
      size: Number.isFinite(Number(f?.size ?? f?.totalBytes)) ? Number(f?.size ?? f?.totalBytes) : undefined,
    }))
    .filter((f: any) => f?.name);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("", { status: 204, headers: CORS_HEADERS });
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "GET" && (path === "/health" || path.endsWith("/health"))) return json({ status: "ok" });

  const authError = requireBearer(req);
  if (authError) return authError;

  if (req.method !== "POST") return json({ ok: false, error: "Not Found" }, 404);

  if (path.endsWith("/kaggle/download-csv") || path === "/kaggle/download-csv") {
    try {
      const body = await readJson(req);
      const { csvText, fileName } = await kaggleDownloadDatasetFile(body as any);
      return json({ ok: true, fileName, csvText });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ ok: false, error: message || "Erro ao baixar CSV do Kaggle" }, 400);
    }
  }

  if (path.endsWith("/kaggle/list-files") || path === "/kaggle/list-files") {
    try {
      const body = await readJson(req);
      const files = await kaggleListDatasetFiles(body as any);
      return json({ ok: true, files });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ ok: false, error: message || "Erro ao listar arquivos do Kaggle" }, 400);
    }
  }

  return json({ ok: false, error: "Not Found" }, 404);
});
