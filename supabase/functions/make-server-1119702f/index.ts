import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import * as kv from "./kv_store.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.49.8";
import { unzipSync } from "npm:fflate@0.8.2";
const app = new Hono();

app.use('*', logger(console.log));

app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

app.get("/make-server-1119702f/health", (c) => {
  return c.json({ status: "ok" });
});
app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

app.post("/make-server-1119702f/validate-api/football-data", async (c) => {
  try {
    const { apiKey } = await c.req.json();

    if (!apiKey) {
      return c.json({ valid: false, error: "API key não fornecida" }, 400);
    }

    console.log("🔍 Validando Football-Data API key via servidor...");

    const response = await fetch("https://api.football-data.org/v4/competitions", {
      method: "GET",
      headers: {
        "X-Auth-Token": apiKey,
      },
    });

    console.log("📡 Status:", response.status);

    if (response.ok) {
      const data = await response.json();
      return c.json({
        valid: true,
        message: "API key válida",
        competitionsCount: data.competitions?.length || 0,
      });
    } else {
      const errorText = await response.text();
      console.error("❌ Erro da API:", errorText);
      return c.json(
        {
          valid: false,
          error: `API retornou status ${response.status}`,
          details: errorText,
        },
        response.status,
      );
    }
  } catch (error) {
    console.error("❌ Erro ao validar API key:", error);
    return c.json(
      {
        valid: false,
        error: error.message || "Erro ao validar API key",
      },
      500,
    );
  }
});
app.post("/validate-api/football-data", async (c) => {
  try {
    const { apiKey } = await c.req.json();

    if (!apiKey) {
      return c.json({ valid: false, error: "API key não fornecida" }, 400);
    }

    console.log("🔍 Validando Football-Data API key via servidor...");

    const response = await fetch("https://api.football-data.org/v4/competitions", {
      method: "GET",
      headers: {
        "X-Auth-Token": apiKey,
      },
    });

    console.log("📡 Status:", response.status);

    if (response.ok) {
      const data = await response.json();
      return c.json({
        valid: true,
        message: "API key válida",
        competitionsCount: data.competitions?.length || 0,
      });
    } else {
      const errorText = await response.text();
      console.error("❌ Erro da API:", errorText);
      return c.json(
        {
          valid: false,
          error: `API retornou status ${response.status}`,
          details: errorText,
        },
        response.status,
      );
    }
  } catch (error) {
    console.error("❌ Erro ao validar API key:", error);
    return c.json(
      {
        valid: false,
        error: error.message || "Erro ao validar API key",
      },
      500,
    );
  }
});

app.post("/make-server-1119702f/validate-api/api-football", async (c) => {
  try {
    const { apiKey } = await c.req.json();

    if (!apiKey) {
      return c.json({ valid: false, error: "API key não fornecida" }, 400);
    }

    console.log("🔍 Validando API-Football key via servidor...");

    const response = await fetch("https://v3.football.api-sports.io/timezone", {
      method: "GET",
      headers: {
        "x-apisports-key": apiKey,
      },
    });

    console.log("📡 Status:", response.status);

    if (response.ok) {
      const data = await response.json();
      return c.json({
        valid: true,
        message: "API key válida",
        results: data.results || 0,
      });
    } else {
      const errorText = await response.text();
      console.error("❌ Erro da API:", errorText);
      return c.json(
        {
          valid: false,
          error: `API retornou status ${response.status}`,
          details: errorText,
        },
        response.status,
      );
    }
  } catch (error) {
    console.error("❌ Erro ao validar API key:", error);
    return c.json(
      {
        valid: false,
        error: error.message || "Erro ao validar API key",
      },
      500,
    );
  }
});
app.post("/validate-api/api-football", async (c) => {
  try {
    const { apiKey } = await c.req.json();

    if (!apiKey) {
      return c.json({ valid: false, error: "API key não fornecida" }, 400);
    }

    console.log("🔍 Validando API-Football key via servidor...");

    const response = await fetch("https://v3.football.api-sports.io/timezone", {
      method: "GET",
      headers: {
        "x-apisports-key": apiKey,
      },
    });

    console.log("📡 Status:", response.status);

    if (response.ok) {
      const data = await response.json();
      return c.json({
        valid: true,
        message: "API key válida",
        results: data.results || 0,
      });
    } else {
      const errorText = await response.text();
      console.error("❌ Erro da API:", errorText);
      return c.json(
        {
          valid: false,
          error: `API retornou status ${response.status}`,
          details: errorText,
        },
        response.status,
      );
    }
  } catch (error) {
    console.error("❌ Erro ao validar API key:", error);
    return c.json(
      {
        valid: false,
        error: error.message || "Erro ao validar API key",
      },
      500,
    );
  }
});

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

  const url = `https://www.kaggle.com/api/v1/datasets/download/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}?file_name=${encodeURIComponent(fileName)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: auth,
    },
    redirect: "follow",
  });

  if (!res.ok) {
    const errText = await res.text();
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
    const files = unzipSync(buf);
    const names = Object.keys(files);
    const preferred = names.find((n) => n.toLowerCase().endsWith(".csv") && n.toLowerCase().includes(fileName.toLowerCase()));
    const csv = preferred ?? names.find((n) => n.toLowerCase().endsWith(".csv")) ?? "";
    if (!csv) throw new Error("ZIP sem CSV");
    chosenName = csv;
    chosenBytes = files[csv];
  } catch (_e) {
    const text = new TextDecoder().decode(buf);
    if (!text.includes(",")) {
      throw new Error("Resposta não é CSV nem ZIP com CSV");
    }
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
    const errText = await res.text();
    throw new Error(`Kaggle error: ${res.status} ${errText}`.slice(0, 600));
  }

  const data = await res.json();
  const files = Array.isArray(data?.datasetFiles) ? data.datasetFiles : Array.isArray(data) ? data : [];
  return files
    .map((f: any) => ({
      name: String(f?.name ?? f?.fileName ?? f?.ref ?? "").trim(),
      size: Number.isFinite(Number(f?.size ?? f?.totalBytes)) ? Number(f?.size ?? f?.totalBytes) : undefined,
    }))
    .filter((f: any) => f?.name);
}

app.post("/make-server-1119702f/kaggle/download-csv", async (c) => {
  try {
    const body = await c.req.json();
    const { csvText, fileName } = await kaggleDownloadDatasetFile(body);
    return c.json({ ok: true, fileName, csvText });
  } catch (error) {
    return c.json({ ok: false, error: error?.message ?? "Erro ao baixar CSV do Kaggle" }, 400);
  }
});
app.post("/kaggle/download-csv", async (c) => {
  try {
    const body = await c.req.json();
    const { csvText, fileName } = await kaggleDownloadDatasetFile(body);
    return c.json({ ok: true, fileName, csvText });
  } catch (error) {
    return c.json({ ok: false, error: error?.message ?? "Erro ao baixar CSV do Kaggle" }, 400);
  }
});

app.post("/make-server-1119702f/kaggle/list-files", async (c) => {
  try {
    const body = await c.req.json();
    const files = await kaggleListDatasetFiles(body);
    return c.json({ ok: true, files });
  } catch (error) {
    return c.json({ ok: false, error: error?.message ?? "Erro ao listar arquivos do Kaggle" }, 400);
  }
});
app.post("/kaggle/list-files", async (c) => {
  try {
    const body = await c.req.json();
    const files = await kaggleListDatasetFiles(body);
    return c.json({ ok: true, files });
  } catch (error) {
    return c.json({ ok: false, error: error?.message ?? "Erro ao listar arquivos do Kaggle" }, 400);
  }
});

app.post("/make-server-1119702f/proxy/football-data", async (c) => {
  try {
    const { url, apiKey } = await c.req.json();

    if (!apiKey) {
      return c.json({ error: "API key não fornecida" }, 400);
    }

    if (!url || typeof url !== "string") {
      return c.json({ error: "URL não fornecida" }, 400);
    }

    const allowedPrefix = "https://api.football-data.org/v4/";
    if (!url.startsWith(allowedPrefix)) {
      return c.json({ error: "URL não permitida" }, 400);
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Auth-Token": apiKey,
      },
    });

    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");

    if (isJson) {
      const data = await response.json();
      if (!response.ok) {
        return c.json(
          {
            error: `API retornou status ${response.status}`,
            details: data,
          },
          response.status,
        );
      }
      return c.json(data);
    }

    const text = await response.text();
    if (!response.ok) {
      return c.json(
        {
          error: `API retornou status ${response.status}`,
          details: text,
        },
        response.status,
      );
    }

    return c.body(text, 200, {
      "Content-Type": contentType || "text/plain; charset=utf-8",
    });
  } catch (error) {
    console.error("❌ Erro no proxy Football-Data:", error);
    return c.json(
      { error: error.message || "Erro ao fazer proxy para Football-Data" },
      500,
    );
  }
});
app.post("/proxy/football-data", async (c) => {
  try {
    const { url, apiKey } = await c.req.json();

    if (!apiKey) {
      return c.json({ error: "API key não fornecida" }, 400);
    }

    if (!url || typeof url !== "string") {
      return c.json({ error: "URL não fornecida" }, 400);
    }

    const allowedPrefix = "https://api.football-data.org/v4/";
    if (!url.startsWith(allowedPrefix)) {
      return c.json({ error: "URL não permitida" }, 400);
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Auth-Token": apiKey,
      },
    });

    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");

    if (isJson) {
      const data = await response.json();
      if (!response.ok) {
        return c.json(
          {
            error: `API retornou status ${response.status}`,
            details: data,
          },
          response.status,
        );
      }
      return c.json(data);
    }

    const text = await response.text();
    if (!response.ok) {
      return c.json(
        {
          error: `API retornou status ${response.status}`,
          details: text,
        },
        response.status,
      );
    }

    return c.body(text, 200, {
      "Content-Type": contentType || "text/plain; charset=utf-8",
    });
  } catch (error) {
    console.error("❌ Erro no proxy Football-Data:", error);
    return c.json(
      { error: error.message || "Erro ao fazer proxy para Football-Data" },
      500,
    );
  }
});

app.post("/make-server-1119702f/proxy/api-football", async (c) => {
  try {
    const { url, apiKey } = await c.req.json();

    if (!apiKey) {
      return c.json({ error: "API key não fornecida" }, 400);
    }

    if (!url || typeof url !== "string") {
      return c.json({ error: "URL não fornecida" }, 400);
    }

    const allowedPrefix = "https://v3.football.api-sports.io/";
    if (!url.startsWith(allowedPrefix)) {
      return c.json({ error: "URL não permitida" }, 400);
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-apisports-key": apiKey,
      },
    });

    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");

    if (isJson) {
      const data = await response.json();
      if (!response.ok) {
        return c.json(
          {
            error: `API retornou status ${response.status}`,
            details: data,
          },
          response.status,
        );
      }
      return c.json(data);
    }

    const text = await response.text();
    if (!response.ok) {
      return c.json(
        {
          error: `API retornou status ${response.status}`,
          details: text,
        },
        response.status,
      );
    }

    return c.body(text, 200, {
      "Content-Type": contentType || "text/plain; charset=utf-8",
    });
  } catch (error) {
    console.error("❌ Erro no proxy API-Football:", error);
    return c.json(
      { error: error.message || "Erro ao fazer proxy para API-Football" },
      500,
    );
  }
});
app.post("/proxy/api-football", async (c) => {
  try {
    const { url, apiKey } = await c.req.json();

    if (!apiKey) {
      return c.json({ error: "API key não fornecida" }, 400);
    }

    if (!url || typeof url !== "string") {
      return c.json({ error: "URL não fornecida" }, 400);
    }

    const allowedPrefix = "https://v3.football.api-sports.io/";
    if (!url.startsWith(allowedPrefix)) {
      return c.json({ error: "URL não permitida" }, 400);
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-apisports-key": apiKey,
      },
    });

    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");

    if (isJson) {
      const data = await response.json();
      if (!response.ok) {
        return c.json(
          {
            error: `API retornou status ${response.status}`,
            details: data,
          },
          response.status,
        );
      }
      return c.json(data);
    }

    const text = await response.text();
    if (!response.ok) {
      return c.json(
        {
          error: `API retornou status ${response.status}`,
          details: text,
        },
        response.status,
      );
    }

    return c.body(text, 200, {
      "Content-Type": contentType || "text/plain; charset=utf-8",
    });
  } catch (error) {
    console.error("❌ Erro no proxy API-Football:", error);
    return c.json(
      { error: error.message || "Erro ao fazer proxy para API-Football" },
      500,
    );
  }
});

const deepseekProxy = async (c: any) => {
  try {
    const { url, apiKey, body } = await c.req.json();

    if (!apiKey) {
      return c.json({ error: "API key não fornecida" }, 400);
    }

    if (!url || typeof url !== "string") {
      return c.json({ error: "URL não fornecida" }, 400);
    }

    const allowedPrefix = "https://api.deepseek.com/v1/";
    if (!url.startsWith(allowedPrefix)) {
      return c.json({ error: "URL não permitida" }, 400);
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body ?? {}),
    });

    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");

    if (isJson) {
      const data = await response.json();
      if (!response.ok) {
        return c.json(
          {
            error: `API retornou status ${response.status}`,
            details: data,
          },
          response.status,
        );
      }
      return c.json(data);
    }

    const text = await response.text();
    if (!response.ok) {
      return c.json(
        {
          error: `API retornou status ${response.status}`,
          details: text,
        },
        response.status,
      );
    }

    return c.body(text, 200, {
      "Content-Type": contentType || "text/plain; charset=utf-8",
    });
  } catch (error) {
    console.error("❌ Erro no proxy DeepSeek:", error);
    return c.json(
      { error: error.message || "Erro ao fazer proxy para DeepSeek" },
      500,
    );
  }
};
app.post("/proxy/deepseek", deepseekProxy);
app.post("/make-server-1119702f/proxy/deepseek", deepseekProxy);

const openaiProxy = async (c: any) => {
  try {
    const { url, apiKey, body } = await c.req.json();

    if (!apiKey) {
      return c.json({ error: "API key não fornecida" }, 400);
    }

    if (!url || typeof url !== "string") {
      return c.json({ error: "URL não fornecida" }, 400);
    }

    const allowedPrefix = "https://api.openai.com/v1/";
    if (!url.startsWith(allowedPrefix)) {
      return c.json({ error: "URL não permitida" }, 400);
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body ?? {}),
    });

    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");

    if (isJson) {
      const data = await response.json();
      if (!response.ok) {
        return c.json(
          {
            error: `API retornou status ${response.status}`,
            details: data,
          },
          response.status,
        );
      }
      return c.json(data);
    }

    const text = await response.text();
    if (!response.ok) {
      return c.json(
        {
          error: `API retornou status ${response.status}`,
          details: text,
        },
        response.status,
      );
    }

    return c.body(text, 200, {
      "Content-Type": contentType || "text/plain; charset=utf-8",
    });
  } catch (error) {
    console.error("❌ Erro no proxy OpenAI:", error);
    return c.json(
      { error: error.message || "Erro ao fazer proxy para OpenAI" },
      500,
    );
  }
};
app.post("/proxy/openai", openaiProxy);
app.post("/make-server-1119702f/proxy/openai", openaiProxy);

const anthropicProxy = async (c: any) => {
  try {
    const { url, apiKey, body } = await c.req.json();

    if (!apiKey) {
      return c.json({ error: "API key não fornecida" }, 400);
    }

    if (!url || typeof url !== "string") {
      return c.json({ error: "URL não fornecida" }, 400);
    }

    const allowedPrefix = "https://api.anthropic.com/v1/";
    if (!url.startsWith(allowedPrefix)) {
      return c.json({ error: "URL não permitida" }, 400);
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body ?? {}),
    });

    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");

    if (isJson) {
      const data = await response.json();
      if (!response.ok) {
        return c.json(
          {
            error: `API retornou status ${response.status}`,
            details: data,
          },
          response.status,
        );
      }
      return c.json(data);
    }

    const text = await response.text();
    if (!response.ok) {
      return c.json(
        {
          error: `API retornou status ${response.status}`,
          details: text,
        },
        response.status,
      );
    }

    return c.body(text, 200, {
      "Content-Type": contentType || "text/plain; charset=utf-8",
    });
  } catch (error) {
    console.error("❌ Erro no proxy Anthropic:", error);
    return c.json(
      { error: error.message || "Erro ao fazer proxy para Anthropic" },
      500,
    );
  }
};
app.post("/proxy/anthropic", anthropicProxy);
app.post("/make-server-1119702f/proxy/anthropic", anthropicProxy);

const googleProxy = async (c: any) => {
  try {
    const { url, apiKey, body } = await c.req.json();

    if (!apiKey) {
      return c.json({ error: "API key não fornecida" }, 400);
    }

    if (!url || typeof url !== "string") {
      return c.json({ error: "URL não fornecida" }, 400);
    }

    const allowedPrefix = "https://generativelanguage.googleapis.com/";
    if (!url.startsWith(allowedPrefix)) {
      return c.json({ error: "URL não permitida" }, 400);
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body ?? {}),
    });

    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");

    if (isJson) {
      const data = await response.json();
      if (!response.ok) {
        return c.json(
          {
            error: `API retornou status ${response.status}`,
            details: data,
          },
          response.status,
        );
      }
      return c.json(data);
    }

    const text = await response.text();
    if (!response.ok) {
      return c.json(
        {
          error: `API retornou status ${response.status}`,
          details: text,
        },
        response.status,
      );
    }

    return c.body(text, 200, {
      "Content-Type": contentType || "text/plain; charset=utf-8",
    });
  } catch (error) {
    console.error("❌ Erro no proxy Google:", error);
    return c.json(
      { error: error.message || "Erro ao fazer proxy para Google" },
      500,
    );
  }
};
app.post("/proxy/google", googleProxy);
app.post("/make-server-1119702f/proxy/google", googleProxy);

const normalizeLeagueCountryKey = (country: unknown) => {
  const c = String(country ?? "").trim();
  if (!c) return "all";
  return c.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
};

const leaguesCacheKey = (country: unknown) => `api-football:leagues:${normalizeLeagueCountryKey(country)}`;

const validateLeaguesCachePayload = (payload: any) => {
  const fetchedAt = String(payload?.fetchedAt ?? "");
  if (!fetchedAt) return { ok: false, error: "fetchedAt é obrigatório" } as const;
  const t = new Date(fetchedAt).getTime();
  if (!Number.isFinite(t)) return { ok: false, error: "fetchedAt inválido" } as const;

  if (!Array.isArray(payload?.items)) return { ok: false, error: "items deve ser um array" } as const;
  if (payload.items.length > 10000) return { ok: false, error: "items muito grande" } as const;

  const approxSize = JSON.stringify(payload).length;
  if (approxSize > 2_000_000) return { ok: false, error: "payload muito grande" } as const;

  return { ok: true } as const;
};

const requireBearer = (c: any) => {
  const auth = String(c.req.header("authorization") ?? "");
  if (!auth.toLowerCase().startsWith("bearer ")) {
    return c.json({ ok: false, error: "Unauthorized" }, 401);
  }
  return null;
};

const KV_TABLE = "kv_store_1119702f";
const supabaseClient = () =>
  createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

const TRAINING_META_KEY = "iafutebol/meta_model_v1";

const validateMetaModelPayload = (model: any) => {
  if (!model || typeof model !== "object") return { ok: false, error: "model inválido" } as const;
  if (model.version !== 1) return { ok: false, error: "versão inválida" } as const;
  const approxSize = JSON.stringify(model).length;
  if (approxSize > 300_000) return { ok: false, error: "model muito grande" } as const;
  return { ok: true } as const;
};

const TRAINING_SAMPLES_PREFIX = "iafutebol/training_samples_v1/item/";

const validateTrainingSamplesPayload = (items: any) => {
  if (!Array.isArray(items)) return { ok: false, error: "items deve ser um array" } as const;
  if (items.length === 0) return { ok: false, error: "items vazio" } as const;
  if (items.length > 200) return { ok: false, error: "items grande demais" } as const;
  const approxSize = JSON.stringify(items).length;
  if (approxSize > 900_000) return { ok: false, error: "payload muito grande" } as const;
  for (const s of items) {
    const id = String(s?.id ?? "").trim();
    const utcDate = String(s?.utcDate ?? "").trim();
    const homeTeam = String(s?.homeTeam ?? "").trim();
    const awayTeam = String(s?.awayTeam ?? "").trim();
    if (!id || !utcDate || !homeTeam || !awayTeam) return { ok: false, error: "amostra inválida" } as const;
  }
  return { ok: true } as const;
};

const trainingSamplesUpsertHandler = async (c: any) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  try {
    const body = await c.req.json();
    const items = body?.items ?? null;
    const validation = validateTrainingSamplesPayload(items);
    if (!validation.ok) return c.json({ ok: false, error: validation.error }, 400);

    const keys = (items as any[]).map((s) => `${TRAINING_SAMPLES_PREFIX}${String(s.id)}`);
    const existing = await kv.mget(keys);
    let added = 0;
    for (let i = 0; i < existing.length; i++) if (existing[i] == null) added += 1;
    await kv.mset(keys, items);
    return c.json({ ok: true, added, upserted: (items as any[]).length });
  } catch (error) {
    console.error("❌ Erro ao salvar training samples:", error);
    return c.json({ ok: false, error: error.message || "Erro ao salvar training samples" }, 500);
  }
};

const trainingSamplesCountHandler = async (c: any) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  try {
    const supabase = supabaseClient();
    const { count, error } = await supabase
      .from(KV_TABLE)
      .select("key", { count: "exact", head: true })
      .like("key", `${TRAINING_SAMPLES_PREFIX}%`);
    if (error) throw new Error(error.message);
    return c.json({ ok: true, count: Number.isFinite(Number(count)) ? Number(count) : 0 });
  } catch (error) {
    console.error("❌ Erro ao contar training samples:", error);
    return c.json({ ok: false, error: error.message || "Erro ao contar training samples" }, 500);
  }
};

const trainingSamplesListHandler = async (c: any) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  try {
    const body = await c.req.json().catch(() => ({}));
    const limitRaw = Number(body?.limit);
    const offsetRaw = Number(body?.offset);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 200;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;

    const supabase = supabaseClient();
    const { data, error } = await supabase
      .from(KV_TABLE)
      .select("key,value")
      .like("key", `${TRAINING_SAMPLES_PREFIX}%`)
      .order("key", { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    const items = Array.isArray(data) ? data.map((r: any) => r?.value).filter((v: any) => v) : [];
    const nextOffset = items.length === limit ? offset + limit : null;
    return c.json({ ok: true, items, nextOffset });
  } catch (error) {
    console.error("❌ Erro ao listar training samples:", error);
    return c.json({ ok: false, error: error.message || "Erro ao listar training samples" }, 500);
  }
};

const trainingMetaGetHandler = async (c: any) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  try {
    const model = await kv.get(TRAINING_META_KEY);
    return c.json({ ok: true, model: model ?? null });
  } catch (error) {
    console.error("❌ Erro ao ler meta model:", error);
    return c.json({ ok: false, error: error.message || "Erro ao ler meta model" }, 500);
  }
};

const trainingMetaSetHandler = async (c: any) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  try {
    const body = await c.req.json();
    const model = body?.model ?? null;
    const validation = validateMetaModelPayload(model);
    if (!validation.ok) return c.json({ ok: false, error: validation.error }, 400);
    await kv.set(TRAINING_META_KEY, model);
    return c.json({ ok: true });
  } catch (error) {
    console.error("❌ Erro ao salvar meta model:", error);
    return c.json({ ok: false, error: error.message || "Erro ao salvar meta model" }, 500);
  }
};

const leaguesCacheGetHandler = async (c: any) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const key = leaguesCacheKey(body?.country);
    const value = await kv.get(key);
    return c.json({ ok: true, value: value ?? null });
  } catch (error) {
    console.error("❌ Erro ao ler cache de ligas:", error);
    return c.json({ ok: false, error: error.message || "Erro ao ler cache" }, 500);
  }
};

const leaguesCacheSetHandler = async (c: any) => {
  try {
    const body = await c.req.json();
    const key = leaguesCacheKey(body?.country);
    const payload = body?.payload;
    const validation = validateLeaguesCachePayload(payload);
    if (!validation.ok) return c.json({ ok: false, error: validation.error }, 400);

    await kv.set(key, payload);
    return c.json({ ok: true });
  } catch (error) {
    console.error("❌ Erro ao salvar cache de ligas:", error);
    return c.json({ ok: false, error: error.message || "Erro ao salvar cache" }, 500);
  }
};

app.post("/make-server-1119702f/cache/api-football/leagues/get", leaguesCacheGetHandler);
app.post("/cache/api-football/leagues/get", leaguesCacheGetHandler);
app.post("/make-server-1119702f/cache/api-football/leagues/set", leaguesCacheSetHandler);
app.post("/cache/api-football/leagues/set", leaguesCacheSetHandler);

app.post("/make-server-1119702f/training/meta/get", trainingMetaGetHandler);
app.post("/training/meta/get", trainingMetaGetHandler);
app.post("/make-server-1119702f/training/meta/set", trainingMetaSetHandler);
app.post("/training/meta/set", trainingMetaSetHandler);

app.post("/make-server-1119702f/training/samples/upsert", trainingSamplesUpsertHandler);
app.post("/training/samples/upsert", trainingSamplesUpsertHandler);
app.post("/make-server-1119702f/training/samples/count", trainingSamplesCountHandler);
app.post("/training/samples/count", trainingSamplesCountHandler);
app.post("/make-server-1119702f/training/samples/list", trainingSamplesListHandler);
app.post("/training/samples/list", trainingSamplesListHandler);

Deno.serve(app.fetch);
