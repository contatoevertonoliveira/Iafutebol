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
    allowHeaders: ["Content-Type", "Authorization", "apikey"],
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

const validateGoogleGeminiKey = async (c: any) => {
  try {
    const { apiKey, model } = await c.req.json();

    if (!apiKey) {
      return c.json({ valid: false, error: "API key não fornecida" }, 400);
    }

    const m = String(model ?? "").trim() || "gemma-4-26b-a4b-it";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(String(apiKey))}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Retorne exatamente: OK" }] }],
        generationConfig: { temperature: 0.0, maxOutputTokens: 8 },
      }),
    });

    if (response.ok) {
      return c.json({ valid: true, message: "API key válida", model: m });
    }

    const contentType = response.headers.get("content-type") || "";
    const details = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : await response.text().catch(() => "");

    return c.json(
      {
        valid: false,
        error: `API retornou status ${response.status}`,
        details,
        model: m,
      },
      response.status,
    );
  } catch (error) {
    console.error("❌ Erro ao validar API key (Google Gemini):", error);
    return c.json(
      {
        valid: false,
        error: error.message || "Erro ao validar API key",
      },
      500,
    );
  }
};

app.post("/make-server-1119702f/validate-api/google-gemini", validateGoogleGeminiKey);
app.post("/validate-api/google-gemini", validateGoogleGeminiKey);

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

    const requestUrl = (() => {
      try {
        const u = new URL(url);
        if (!u.searchParams.has("key")) u.searchParams.set("key", apiKey);
        return u.toString();
      } catch {
        return url;
      }
    })();

    const response = await fetch(requestUrl, {
      method: "POST",
      headers: {
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

const requireAutomationAdmin = (c: any) => {
  const enabled = String(Deno.env.get("BETFAIR_TRADING_ENABLED") ?? "").trim().toLowerCase() === "true";
  if (!enabled) return c.json({ ok: false, error: "Trading desabilitado" }, 403);
  const expected = String(Deno.env.get("AUTOMATION_ADMIN_TOKEN") ?? "").trim();
  if (!expected) return c.json({ ok: false, error: "Trading desabilitado" }, 403);
  const provided = String(c.req.header("x-automation-token") ?? "").trim();
  if (!provided || provided !== expected) return c.json({ ok: false, error: "Forbidden" }, 403);
  return null;
};

const BETFAIR_SESSION_KV_KEY = "betfair/session_v1";

const decodeEnvPem = (value: string) => String(value ?? "").replace(/\\n/g, "\n").trim();

const extractPemBlock = (pem: string, label: string) => {
  const begin = `-----BEGIN ${label}-----`;
  const end = `-----END ${label}-----`;
  const start = pem.indexOf(begin);
  if (start < 0) return null;
  const stop = pem.indexOf(end, start);
  if (stop < 0) return null;
  const inner = pem.slice(start + begin.length, stop).replace(/[\r\n\s]/g, "");
  return inner || null;
};

const pemSha256Hex = async (pem: string, label: string) => {
  const b64 = extractPemBlock(pem, label);
  if (!b64) return null;
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

const assertHeaderSafe = (name: string, value: string) => {
  if (!value) return;
  if (/[\r\n]/.test(value)) throw new Error(`Betfair: ${name} contém quebra de linha (valor inválido para header)`);
};

const getBetfairConfig = () => {
  const appKey = String(Deno.env.get("BETFAIR_APP_KEY") ?? "").trim();
  const username = String(Deno.env.get("BETFAIR_USERNAME") ?? "").trim();
  const password = String(Deno.env.get("BETFAIR_PASSWORD") ?? "").trim();
  const certRawV2 = String(Deno.env.get("BETFAIR_CERT_PEM_V2") ?? "");
  const certRawV1 = String(Deno.env.get("BETFAIR_CERT_PEM") ?? "");
  const certPem = decodeEnvPem(certRawV2 || certRawV1);
  const certSource = certRawV2 ? "BETFAIR_CERT_PEM_V2" : certRawV1 ? "BETFAIR_CERT_PEM" : null;

  const keyRawV2 = String(Deno.env.get("BETFAIR_KEY_PEM_V2") ?? "");
  const keyRawV1 = String(Deno.env.get("BETFAIR_KEY_PEM") ?? "");
  const keyRawAlias = String(Deno.env.get("BETFAIR_CERT_KEY") ?? "");
  const keyPem = decodeEnvPem(keyRawV2 || keyRawV1 || keyRawAlias);
  const keySource = keyRawV2 ? "BETFAIR_KEY_PEM_V2" : keyRawV1 ? "BETFAIR_KEY_PEM" : keyRawAlias ? "BETFAIR_CERT_KEY" : null;
  const jurisdiction = String(Deno.env.get("BETFAIR_JURISDICTION") ?? "com").trim().toLowerCase();
  const overrideSsoHost = String(Deno.env.get("BETFAIR_SSO_HOST") ?? "").trim();
  const overrideApiHost = String(Deno.env.get("BETFAIR_API_HOST") ?? "").trim();

  const normalizedJurisdiction =
    jurisdiction === "br" || jurisdiction === "bet.br" || jurisdiction === "betfair.bet.br" ? "bet.br" : jurisdiction;

  const ssoHost = overrideSsoHost ||
    (normalizedJurisdiction === "bet.br" ? "identitysso-cert.betfair.bet.br"
      : normalizedJurisdiction === "au" || normalizedJurisdiction === "com.au" ? "identitysso-cert.betfair.com.au"
      : normalizedJurisdiction === "it" ? "identitysso-cert.betfair.it"
      : normalizedJurisdiction === "es" ? "identitysso-cert.betfair.es"
      : normalizedJurisdiction === "ro" ? "identitysso-cert.betfair.ro"
      : "identitysso-cert.betfair.com");

  const apiHost = overrideApiHost || (normalizedJurisdiction === "bet.br" ? "api.betfair.bet.br" : "api.betfair.com");
  const rpcUrl = `https://${apiHost}/exchange/betting/json-rpc/v1`;

  assertHeaderSafe("BETFAIR_APP_KEY", appKey);
  assertHeaderSafe("BETFAIR_USERNAME", username);
  assertHeaderSafe("BETFAIR_PASSWORD", password);

  return { appKey, username, password, certPem, keyPem, certSource, keySource, ssoHost, apiHost, rpcUrl } as const;
};

const loadBetfairSession = async () => {
  const raw = await kv.get(BETFAIR_SESSION_KV_KEY);
  const token = String(raw?.sessionToken ?? "").trim();
  return token ? (raw as { sessionToken: string; fetchedAt: string }) : null;
};

const saveBetfairSession = async (sessionToken: string) => {
  await kv.set(BETFAIR_SESSION_KV_KEY, { sessionToken, fetchedAt: new Date().toISOString() });
};

const betfairCertLogin = async () => {
  const cfg = getBetfairConfig();
  if (!cfg.appKey || !cfg.username || !cfg.password) throw new Error("Betfair: credenciais ausentes (APP_KEY/USERNAME/PASSWORD)");
  if (!cfg.certPem || !cfg.keyPem) throw new Error("Betfair: certificado ausente (CERT_PEM/KEY_PEM)");

  const client = Deno.createHttpClient({
    cert: cfg.certPem,
    key: cfg.keyPem,
  } as any);

  const url = `https://${cfg.ssoHost}/api/certlogin`;
  const body = new URLSearchParams({
    username: cfg.username,
    password: cfg.password,
  }).toString();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-Application": cfg.appKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    client,
  });

  const text = await res.text().catch(() => "");
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new Error(`Betfair login falhou (HTTP ${res.status}): ${text.slice(0, 260)}`);
  }
  const status = String(data?.loginStatus ?? "").trim();
  const sessionToken = String(data?.sessionToken ?? "").trim();
  if (status !== "SUCCESS" || !sessionToken) {
    throw new Error(`Betfair login falhou: ${status || "UNKNOWN"}`);
  }
  await saveBetfairSession(sessionToken);
  return sessionToken;
};

const getBetfairSessionToken = async (opts?: { force?: boolean }) => {
  if (!opts?.force) {
    const cached = await loadBetfairSession();
    if (cached?.sessionToken) return cached.sessionToken;
  }
  return await betfairCertLogin();
};

const betfairJsonRpcRaw = async (params: { method: string; params: any; sessionToken: string }) => {
  const cfg = getBetfairConfig();
  if (!cfg.appKey) throw new Error("Betfair: APP_KEY ausente");
  const method = String(params.method ?? "").trim();

  const res = await fetch(cfg.rpcUrl, {
    method: "POST",
    headers: {
      "X-Application": cfg.appKey,
      "X-Authentication": params.sessionToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([{ jsonrpc: "2.0", id: 1, method, params: params.params ?? {} }]),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Betfair API falhou (HTTP ${res.status})`);
  const first = Array.isArray(data) ? data[0] : data;
  if (first?.error) {
    const msg = first?.error?.message ? String(first.error.message) : JSON.stringify(first.error);
    const codeRaw =
      String(first?.error?.data?.APINGException?.errorCode ?? first?.error?.data?.exceptionname ?? "").trim() ||
      String(first?.error?.data?.errorCode ?? "").trim();
    const code = codeRaw || msg;
    const isSessionInvalid = /INVALID_SESSION|NO_SESSION|SESSION.*INVALID/i.test(code);
    const err = new Error(`Betfair API error: ${msg}`.slice(0, 600)) as any;
    err.__betfairSessionInvalid = isSessionInvalid;
    throw err;
  }
  return first?.result ?? null;
};

const betfairJsonRpc = async (params: { method: string; params: any; sessionToken: string }) => {
  const method = String(params.method ?? "").trim();
  const allowed = new Set([
    "SportsAPING/v1.0/listEventTypes",
    "SportsAPING/v1.0/listCompetitions",
    "SportsAPING/v1.0/listEvents",
    "SportsAPING/v1.0/listMarketCatalogue",
    "SportsAPING/v1.0/listMarketBook",
    "SportsAPING/v1.0/listTimeRanges",
    "SportsAPING/v1.0/listCountries",
    "SportsAPING/v1.0/listVenues",
  ]);
  if (!allowed.has(method)) throw new Error("Betfair: método não permitido");
  return await betfairJsonRpcRaw({ ...params, method });
};

const betfairJsonRpcTrading = async (params: { method: string; params: any; sessionToken: string }) => {
  const method = String(params.method ?? "").trim();
  const allowed = new Set(["SportsAPING/v1.0/placeOrders"]);
  if (!allowed.has(method)) throw new Error("Betfair: método não permitido");
  return await betfairJsonRpcRaw({ ...params, method });
};

app.post("/make-server-1119702f/betfair/session", async (c) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  try {
    const token = await getBetfairSessionToken();
    const cached = await loadBetfairSession();
    const tokenPreview = token ? `${token.slice(0, 6)}…${token.slice(-4)}` : null;
    const debug = new URL(c.req.url).searchParams.get("debug") === "1";
    if (!debug) return c.json({ ok: true, hasSession: Boolean(token), tokenPreview, fetchedAt: cached?.fetchedAt ?? null });
    const cfg = getBetfairConfig();
    const certSha256 = await pemSha256Hex(cfg.certPem, "CERTIFICATE");
    const keyType = cfg.keyPem.includes("BEGIN RSA PRIVATE KEY") ? "RSA PRIVATE KEY"
      : cfg.keyPem.includes("BEGIN PRIVATE KEY") ? "PRIVATE KEY"
      : cfg.keyPem.includes("BEGIN ENCRYPTED PRIVATE KEY") ? "ENCRYPTED PRIVATE KEY"
      : "UNKNOWN";
    return c.json({
      ok: true,
      hasSession: Boolean(token),
      tokenPreview,
      fetchedAt: cached?.fetchedAt ?? null,
      debug: { ssoHost: cfg.ssoHost, apiHost: cfg.apiHost, certSha256, keyType, certSource: cfg.certSource, keySource: cfg.keySource },
    });
  } catch (error) {
    const debug = new URL(c.req.url).searchParams.get("debug") === "1";
    if (!debug) return c.json({ ok: false, error: error.message || "Erro ao criar sessão Betfair" }, 500);
    try {
      const cfg = getBetfairConfig();
      const certSha256 = await pemSha256Hex(cfg.certPem, "CERTIFICATE");
      const keyType = cfg.keyPem.includes("BEGIN RSA PRIVATE KEY") ? "RSA PRIVATE KEY"
        : cfg.keyPem.includes("BEGIN PRIVATE KEY") ? "PRIVATE KEY"
        : cfg.keyPem.includes("BEGIN ENCRYPTED PRIVATE KEY") ? "ENCRYPTED PRIVATE KEY"
        : "UNKNOWN";
      return c.json(
        { ok: false, error: error.message || "Erro ao criar sessão Betfair", debug: { ssoHost: cfg.ssoHost, apiHost: cfg.apiHost, certSha256, keyType, certSource: cfg.certSource, keySource: cfg.keySource } },
        500,
      );
    } catch {
      return c.json({ ok: false, error: error.message || "Erro ao criar sessão Betfair", debug: { failedToLoadEnv: true } }, 500);
    }
  }
});
app.post("/betfair/session", async (c) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  try {
    const token = await getBetfairSessionToken();
    const cached = await loadBetfairSession();
    const tokenPreview = token ? `${token.slice(0, 6)}…${token.slice(-4)}` : null;
    const debug = new URL(c.req.url).searchParams.get("debug") === "1";
    if (!debug) return c.json({ ok: true, hasSession: Boolean(token), tokenPreview, fetchedAt: cached?.fetchedAt ?? null });
    const cfg = getBetfairConfig();
    const certSha256 = await pemSha256Hex(cfg.certPem, "CERTIFICATE");
    const keyType = cfg.keyPem.includes("BEGIN RSA PRIVATE KEY") ? "RSA PRIVATE KEY"
      : cfg.keyPem.includes("BEGIN PRIVATE KEY") ? "PRIVATE KEY"
      : cfg.keyPem.includes("BEGIN ENCRYPTED PRIVATE KEY") ? "ENCRYPTED PRIVATE KEY"
      : "UNKNOWN";
    return c.json({
      ok: true,
      hasSession: Boolean(token),
      tokenPreview,
      fetchedAt: cached?.fetchedAt ?? null,
      debug: { ssoHost: cfg.ssoHost, apiHost: cfg.apiHost, certSha256, keyType, certSource: cfg.certSource, keySource: cfg.keySource },
    });
  } catch (error) {
    const debug = new URL(c.req.url).searchParams.get("debug") === "1";
    if (!debug) return c.json({ ok: false, error: error.message || "Erro ao criar sessão Betfair" }, 500);
    try {
      const cfg = getBetfairConfig();
      const certSha256 = await pemSha256Hex(cfg.certPem, "CERTIFICATE");
      const keyType = cfg.keyPem.includes("BEGIN RSA PRIVATE KEY") ? "RSA PRIVATE KEY"
        : cfg.keyPem.includes("BEGIN PRIVATE KEY") ? "PRIVATE KEY"
        : cfg.keyPem.includes("BEGIN ENCRYPTED PRIVATE KEY") ? "ENCRYPTED PRIVATE KEY"
        : "UNKNOWN";
      return c.json(
        { ok: false, error: error.message || "Erro ao criar sessão Betfair", debug: { ssoHost: cfg.ssoHost, apiHost: cfg.apiHost, certSha256, keyType, certSource: cfg.certSource, keySource: cfg.keySource } },
        500,
      );
    } catch {
      return c.json({ ok: false, error: error.message || "Erro ao criar sessão Betfair", debug: { failedToLoadEnv: true } }, 500);
    }
  }
});

app.post("/make-server-1119702f/betfair/rpc", async (c) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  try {
    const body = await c.req.json().catch(() => ({}));
    const method = String(body?.method ?? "").trim();
    const params = body?.params ?? {};
    const sessionToken = await getBetfairSessionToken();
    let result: any = null;
    try {
      result = await betfairJsonRpc({ method, params, sessionToken });
    } catch (e) {
      const invalid = Boolean((e as any)?.__betfairSessionInvalid);
      if (!invalid) throw e;
      const refreshed = await getBetfairSessionToken({ force: true });
      result = await betfairJsonRpc({ method, params, sessionToken: refreshed });
    }
    return c.json({ ok: true, result });
  } catch (error) {
    return c.json({ ok: false, error: error.message || "Erro ao chamar Betfair" }, 500);
  }
});
app.post("/betfair/rpc", async (c) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  try {
    const body = await c.req.json().catch(() => ({}));
    const method = String(body?.method ?? "").trim();
    const params = body?.params ?? {};
    const sessionToken = await getBetfairSessionToken();
    let result: any = null;
    try {
      result = await betfairJsonRpc({ method, params, sessionToken });
    } catch (e) {
      const invalid = Boolean((e as any)?.__betfairSessionInvalid);
      if (!invalid) throw e;
      const refreshed = await getBetfairSessionToken({ force: true });
      result = await betfairJsonRpc({ method, params, sessionToken: refreshed });
    }
    return c.json({ ok: true, result });
  } catch (error) {
    return c.json({ ok: false, error: error.message || "Erro ao chamar Betfair" }, 500);
  }
});

const validatePlaceOrdersPayload = (payload: any) => {
  const marketId = String(payload?.marketId ?? "").trim();
  if (!marketId) return { ok: false, error: "marketId obrigatório" } as const;
  if (!Array.isArray(payload?.instructions) || payload.instructions.length === 0) {
    return { ok: false, error: "instructions deve ser um array não vazio" } as const;
  }
  if (payload.instructions.length > 50) return { ok: false, error: "instructions grande demais" } as const;
  const customerRef = payload?.customerRef == null ? null : String(payload.customerRef);
  if (customerRef && customerRef.length > 32) return { ok: false, error: "customerRef grande demais" } as const;
  return { ok: true } as const;
};

app.post("/make-server-1119702f/betfair/placeOrders", async (c) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  const adminError = requireAutomationAdmin(c);
  if (adminError) return adminError;
  try {
    const body = await c.req.json().catch(() => ({}));
    const validation = validatePlaceOrdersPayload(body);
    if (!validation.ok) return c.json({ ok: false, error: validation.error }, 400);
    const sessionToken = await getBetfairSessionToken();
    const result = await betfairJsonRpcTrading({
      method: "SportsAPING/v1.0/placeOrders",
      params: {
        marketId: String(body.marketId),
        instructions: body.instructions,
        customerRef: body.customerRef ?? undefined,
        marketVersion: body.marketVersion ?? undefined,
        customerStrategyRef: body.customerStrategyRef ?? undefined,
        async: Boolean(body.async ?? false),
      },
      sessionToken,
    });
    return c.json({ ok: true, result });
  } catch (error) {
    return c.json({ ok: false, error: error.message || "Erro ao enviar placeOrders" }, 500);
  }
});

app.post("/betfair/placeOrders", async (c) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  const adminError = requireAutomationAdmin(c);
  if (adminError) return adminError;
  try {
    const body = await c.req.json().catch(() => ({}));
    const validation = validatePlaceOrdersPayload(body);
    if (!validation.ok) return c.json({ ok: false, error: validation.error }, 400);
    const sessionToken = await getBetfairSessionToken();
    const result = await betfairJsonRpcTrading({
      method: "SportsAPING/v1.0/placeOrders",
      params: {
        marketId: String(body.marketId),
        instructions: body.instructions,
        customerRef: body.customerRef ?? undefined,
        marketVersion: body.marketVersion ?? undefined,
        customerStrategyRef: body.customerStrategyRef ?? undefined,
        async: Boolean(body.async ?? false),
      },
      sessionToken,
    });
    return c.json({ ok: true, result });
  } catch (error) {
    return c.json({ ok: false, error: error.message || "Erro ao enviar placeOrders" }, 500);
  }
});

const BETFAIR_QUEUE_PREFIX = "betfair/automation_queue_v1/item/";

const normalizeName = (input: unknown) => {
  const s = String(input ?? "").trim().toLowerCase();
  if (!s) return "";
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const scoreEventName = (eventName: string, home: string, away: string) => {
  const e = normalizeName(eventName);
  const h = normalizeName(home);
  const a = normalizeName(away);
  if (!e || !h || !a) return 0;
  let score = 0;
  if (e.includes(h)) score += 6;
  if (e.includes(a)) score += 6;
  if (e.includes(" v ") || e.includes(" vs ") || e.includes(" x ")) score += 2;
  const hTokens = new Set(h.split(" ").filter(Boolean));
  const aTokens = new Set(a.split(" ").filter(Boolean));
  for (const t of hTokens) if (t.length >= 3 && e.includes(t)) score += 1;
  for (const t of aTokens) if (t.length >= 3 && e.includes(t)) score += 1;
  return score;
};

const pickBestEvent = (events: any[], homeTeam: string, awayTeam: string, kickoffIso: string | null) => {
  const kickoffMs = kickoffIso ? new Date(kickoffIso).getTime() : NaN;
  let best: { event: any; score: number } | null = null;
  for (const row of Array.isArray(events) ? events : []) {
    const ev = row?.event ?? row;
    const name = String(ev?.name ?? "").trim();
    const base = scoreEventName(name, homeTeam, awayTeam);
    if (base <= 0) continue;
    const openDate = String(ev?.openDate ?? "").trim();
    const openMs = openDate ? new Date(openDate).getTime() : NaN;
    let timeBonus = 0;
    if (Number.isFinite(kickoffMs) && Number.isFinite(openMs)) {
      const diffMin = Math.abs(kickoffMs - openMs) / 60000;
      timeBonus = Math.max(0, 6 - diffMin / 30);
    }
    const s = base + timeBonus;
    if (!best || s > best.score) best = { event: ev, score: s };
  }
  return best?.event ?? null;
};

const guessRunnerRole = (runnerName: string, homeTeam: string, awayTeam: string) => {
  const r = normalizeName(runnerName);
  if (!r) return null;
  if (r.includes("draw") || r.includes("empate")) return "draw";
  const h = normalizeName(homeTeam);
  const a = normalizeName(awayTeam);
  const hScore = h ? scoreEventName(`${runnerName} v ${awayTeam}`, homeTeam, awayTeam) : 0;
  const aScore = a ? scoreEventName(`${homeTeam} v ${runnerName}`, homeTeam, awayTeam) : 0;
  const rHasHome = h && (r.includes(h) || h.split(" ").some((t) => t.length >= 3 && r.includes(t)));
  const rHasAway = a && (r.includes(a) || a.split(" ").some((t) => t.length >= 3 && r.includes(t)));
  if (rHasHome && !rHasAway) return "home";
  if (rHasAway && !rHasHome) return "away";
  if (hScore > aScore) return "home";
  if (aScore > hScore) return "away";
  return null;
};

const splitEventTeams = (eventName: string) => {
  const raw = String(eventName ?? "").trim();
  if (!raw) return null;
  const normalized = raw.replace(/\s+/g, " ");
  const m = normalized.match(/^(.*?)\s+(?:v|vs|x)\s+(.*?)$/i);
  if (!m) return null;
  const home = String(m[1] ?? "").trim();
  const away = String(m[2] ?? "").trim();
  if (!home || !away) return null;
  return { home, away };
};

const withTimeout = async <T>(fn: (signal: AbortSignal) => Promise<T>, ms: number) => {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(t);
  }
};

const listBetfairSoccerMatchOddsRange = async (params: { fromIso: string; toIso: string; maxResults: number }) => {
  const fromIso = String(params.fromIso ?? "").trim();
  const toIso = String(params.toIso ?? "").trim();
  const maxResults = Math.max(1, Math.min(400, Number(params.maxResults ?? 200) || 200));
  if (!fromIso || !toIso) throw new Error("Betfair: período inválido");

  let sessionToken = await getBetfairSessionToken();
  const call = async (method: string, rpcParams: any) => {
    try {
      return await betfairJsonRpc({ method, params: rpcParams, sessionToken });
    } catch (e) {
      const invalid = Boolean((e as any)?.__betfairSessionInvalid);
      if (!invalid) throw e;
      sessionToken = await getBetfairSessionToken({ force: true });
      return await betfairJsonRpc({ method, params: rpcParams, sessionToken });
    }
  };

  const events = await withTimeout(
    () =>
      call("SportsAPING/v1.0/listEvents", {
        filter: { eventTypeIds: ["1"], marketStartTime: { from: fromIso, to: toIso } },
        sort: "FIRST_TO_START",
        maxResults,
      }),
    9000,
  );

  const eventIds = Array.from(
    new Set(
      (Array.isArray(events) ? events : [])
        .map((row: any) => String((row?.event ?? row)?.id ?? "").trim())
        .filter(Boolean),
    ),
  ).slice(0, maxResults);

  if (eventIds.length === 0) return [];

  const catalogues = await withTimeout(
    () =>
      call("SportsAPING/v1.0/listMarketCatalogue", {
        filter: { eventIds, marketTypeCodes: ["MATCH_ODDS"] },
        maxResults: String(Math.min(eventIds.length, maxResults)),
        sort: "FIRST_TO_START",
        marketProjection: ["EVENT", "COMPETITION", "RUNNER_DESCRIPTION", "MARKET_START_TIME"],
      }),
    12_000,
  );

  const markets = Array.isArray(catalogues) ? catalogues : [];
  const marketIds = markets
    .map((m: any) => String(m?.marketId ?? "").trim())
    .filter(Boolean)
    .slice(0, maxResults);

  if (marketIds.length === 0) return [];

  const booksByMarketId = new Map<string, any>();
  const chunkSize = 40;
  for (let i = 0; i < marketIds.length; i += chunkSize) {
    const chunk = marketIds.slice(i, i + chunkSize);
    const books = await withTimeout(
      () =>
        call("SportsAPING/v1.0/listMarketBook", {
          marketIds: chunk,
          priceProjection: { priceData: ["EX_BEST_OFFERS"], virtualise: true },
        }),
      12_000,
    );
    for (const b of Array.isArray(books) ? books : []) {
      const id = String(b?.marketId ?? "").trim();
      if (id) booksByMarketId.set(id, b);
    }
  }

  const nowMs = Date.now();
  const out: any[] = [];

  for (const mk of markets) {
    const marketId = String(mk?.marketId ?? "").trim();
    if (!marketId) continue;
    const event = mk?.event ?? null;
    const competition = mk?.competition ?? null;
    const eventId = String(event?.id ?? "").trim();
    const eventName = String(event?.name ?? "").trim();
    const teams = splitEventTeams(eventName);
    if (!teams) continue;

    const marketStartTime = String(mk?.marketStartTime ?? event?.openDate ?? "").trim();
    const kickoffMs = marketStartTime ? new Date(marketStartTime).getTime() : NaN;

    const runners = Array.isArray(mk?.runners) ? mk.runners : [];
    const selectionByRole: Record<string, number> = {};
    for (const r of runners) {
      const selectionId = Number(r?.selectionId);
      if (!Number.isFinite(selectionId)) continue;
      const role = guessRunnerRole(String(r?.runnerName ?? ""), teams.home, teams.away);
      if (!role) continue;
      if (selectionByRole[role] != null) continue;
      selectionByRole[role] = selectionId;
    }

    const book = booksByMarketId.get(marketId) ?? null;
    const totalMatched = Number(book?.totalMatched);
    const isInPlay = Boolean(book?.inplay);
    const marketStatus = String(book?.status ?? "").toUpperCase();

    const status =
      marketStatus === "CLOSED" ? "FINISHED" : isInPlay ? "IN_PLAY" : Number.isFinite(kickoffMs) && nowMs >= kickoffMs ? "IN_PLAY" : "SCHEDULED";

    const runnersBook = Array.isArray(book?.runners) ? book.runners : [];
    const pull = (selectionId: number) => {
      const rb = runnersBook.find((x: any) => Number(x?.selectionId) === selectionId);
      const ex = rb?.ex ?? {};
      const back0 = Array.isArray(ex?.availableToBack) ? ex.availableToBack[0] : null;
      const lay0 = Array.isArray(ex?.availableToLay) ? ex.availableToLay[0] : null;
      return {
        back: back0 ? Number(back0.price) : null,
        backSize: back0 ? Number(back0.size) : null,
        lay: lay0 ? Number(lay0.price) : null,
        laySize: lay0 ? Number(lay0.size) : null,
      };
    };

    const odds: any = {};
    if (Number.isFinite(selectionByRole.home)) odds.home = pull(selectionByRole.home);
    if (Number.isFinite(selectionByRole.draw)) odds.draw = pull(selectionByRole.draw);
    if (Number.isFinite(selectionByRole.away)) odds.away = pull(selectionByRole.away);

    const idNumber = Number(eventId);
    const id = Number.isFinite(idNumber) ? idNumber : Math.floor(9_000_000_000 + out.length);

    out.push({
      id,
      utcDate: marketStartTime || new Date().toISOString(),
      status,
      matchday: 0,
      homeTeam: {
        id: 0,
        name: teams.home,
        shortName: teams.home,
        tla: teams.home.substring(0, 3).toUpperCase(),
        crest: "",
      },
      awayTeam: {
        id: 0,
        name: teams.away,
        shortName: teams.away,
        tla: teams.away.substring(0, 3).toUpperCase(),
        crest: "",
      },
      score: {
        fullTime: { home: null, away: null },
      },
      competition: {
        id: 0,
        name: String(competition?.name ?? "").trim() || "Soccer",
        code: "",
        emblem: "",
        area: {
          name: String(event?.countryCode ?? "").trim() || "Unknown",
          code: String(event?.countryCode ?? "").trim() || "",
          flag: "",
        },
      },
      betfair: {
        eventId: eventId || null,
        eventName: eventName || null,
        marketId,
        marketStartTime: marketStartTime || null,
        runners: {
          homeSelectionId: Number.isFinite(selectionByRole.home) ? selectionByRole.home : null,
          drawSelectionId: Number.isFinite(selectionByRole.draw) ? selectionByRole.draw : null,
          awaySelectionId: Number.isFinite(selectionByRole.away) ? selectionByRole.away : null,
        },
        matchedVolume: Number.isFinite(totalMatched) ? totalMatched : null,
        odds,
        oddsFetchedAt: new Date().toISOString(),
      },
    });
  }

  return out;
};

const resolveBetfairMatchOdds = async (params: { homeTeam: string; awayTeam: string; utcDate: string | null }) => {
  const homeTeam = String(params.homeTeam ?? "").trim();
  const awayTeam = String(params.awayTeam ?? "").trim();
  const utcDate = params.utcDate ? String(params.utcDate) : null;
  if (!homeTeam || !awayTeam) throw new Error("Betfair: home/away ausentes");

  const kickoff = utcDate ? new Date(utcDate) : null;
  const kickoffMs = kickoff && Number.isFinite(kickoff.getTime()) ? kickoff.getTime() : NaN;
  const from = Number.isFinite(kickoffMs) ? new Date(kickoffMs - 3 * 60 * 60 * 1000).toISOString() : new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const to = Number.isFinite(kickoffMs) ? new Date(kickoffMs + 6 * 60 * 60 * 1000).toISOString() : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  let sessionToken = await getBetfairSessionToken();
  const call = async (method: string, rpcParams: any) => {
    try {
      return await betfairJsonRpc({ method, params: rpcParams, sessionToken });
    } catch (e) {
      const invalid = Boolean((e as any)?.__betfairSessionInvalid);
      if (!invalid) throw e;
      sessionToken = await getBetfairSessionToken({ force: true });
      return await betfairJsonRpc({ method, params: rpcParams, sessionToken });
    }
  };
  const eventQueries = [homeTeam, awayTeam, `${homeTeam} ${awayTeam}`].filter(Boolean);
  let events: any[] = [];
  for (const q of eventQueries) {
    const r = await withTimeout(
      () => call("SportsAPING/v1.0/listEvents", { filter: { eventTypeIds: ["1"], textQuery: q, marketStartTime: { from, to } } }),
      8000,
    );
    if (Array.isArray(r) && r.length > 0) {
      events = r;
      const bestEv = pickBestEvent(events, homeTeam, awayTeam, utcDate);
      if (bestEv) {
        events = [ { event: bestEv } ];
        break;
      }
    }
  }

  const best = pickBestEvent(events, homeTeam, awayTeam, utcDate);
  const eventId = String(best?.id ?? "").trim();
  if (!eventId) throw new Error("Betfair: eventId não encontrado");

  const catalogue = await withTimeout(
    () =>
      call("SportsAPING/v1.0/listMarketCatalogue", {
        filter: { eventIds: [eventId], marketTypeCodes: ["MATCH_ODDS"] },
        maxResults: 1,
        marketProjection: ["RUNNER_DESCRIPTION", "MARKET_START_TIME"],
      }),
    8000,
  );

  const mk = Array.isArray(catalogue) ? catalogue[0] : null;
  const marketId = String(mk?.marketId ?? "").trim();
  if (!marketId) throw new Error("Betfair: marketId (MATCH_ODDS) não encontrado");

  const runners = Array.isArray(mk?.runners) ? mk.runners : [];
  const selectionByRole: Record<string, number> = {};
  for (const r of runners) {
    const selectionId = Number(r?.selectionId);
    if (!Number.isFinite(selectionId)) continue;
    const role = guessRunnerRole(String(r?.runnerName ?? ""), homeTeam, awayTeam);
    if (!role) continue;
    if (selectionByRole[role] != null) continue;
    selectionByRole[role] = selectionId;
  }

  const marketBook = await withTimeout(
    () =>
      call("SportsAPING/v1.0/listMarketBook", {
        marketIds: [marketId],
        priceProjection: { priceData: ["EX_BEST_OFFERS"], virtualise: true },
      }),
    8000,
  );

  const book = Array.isArray(marketBook) ? marketBook[0] : null;
  const totalMatched = Number(book?.totalMatched);
  const runnersBook = Array.isArray(book?.runners) ? book.runners : [];
  const odds: any = {};
  const pull = (selectionId: number) => {
    const rb = runnersBook.find((x: any) => Number(x?.selectionId) === selectionId);
    const ex = rb?.ex ?? {};
    const back0 = Array.isArray(ex?.availableToBack) ? ex.availableToBack[0] : null;
    const lay0 = Array.isArray(ex?.availableToLay) ? ex.availableToLay[0] : null;
    return {
      back: back0 ? Number(back0.price) : null,
      backSize: back0 ? Number(back0.size) : null,
      lay: lay0 ? Number(lay0.price) : null,
      laySize: lay0 ? Number(lay0.size) : null,
    };
  };

  if (Number.isFinite(selectionByRole.home)) odds.home = pull(selectionByRole.home);
  if (Number.isFinite(selectionByRole.draw)) odds.draw = pull(selectionByRole.draw);
  if (Number.isFinite(selectionByRole.away)) odds.away = pull(selectionByRole.away);

  return {
    eventId,
    eventName: String(best?.name ?? "").trim() || null,
    marketId,
    marketStartTime: String(mk?.marketStartTime ?? "").trim() || null,
    runners: {
      homeSelectionId: Number.isFinite(selectionByRole.home) ? selectionByRole.home : null,
      drawSelectionId: Number.isFinite(selectionByRole.draw) ? selectionByRole.draw : null,
      awaySelectionId: Number.isFinite(selectionByRole.away) ? selectionByRole.away : null,
    },
    matchedVolume: Number.isFinite(totalMatched) ? totalMatched : null,
    odds,
    oddsFetchedAt: new Date().toISOString(),
  };
};

app.post("/make-server-1119702f/betfair/matches/list", async (c) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  try {
    const body = await c.req.json().catch(() => ({}));
    const dateFrom = String(body?.dateFrom ?? "").trim();
    const dateTo = String(body?.dateTo ?? "").trim();
    const maxResults = Number(body?.maxResults ?? body?.maxEvents ?? 200);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
      return c.json({ ok: false, error: "dateFrom/dateTo devem estar no formato YYYY-MM-DD" }, 400);
    }

    const fromIso = new Date(`${dateFrom}T00:00:00-03:00`).toISOString();
    const toIso = new Date(`${dateTo}T23:59:59-03:00`).toISOString();

    const matches = await listBetfairSoccerMatchOddsRange({ fromIso, toIso, maxResults: Number.isFinite(maxResults) ? maxResults : 200 });
    return c.json({ ok: true, matches });
  } catch (error) {
    return c.json({ ok: false, error: error.message || "Erro ao listar jogos (Betfair)" }, 500);
  }
});

app.post("/betfair/matches/list", async (c) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  try {
    const body = await c.req.json().catch(() => ({}));
    const dateFrom = String(body?.dateFrom ?? "").trim();
    const dateTo = String(body?.dateTo ?? "").trim();
    const maxResults = Number(body?.maxResults ?? body?.maxEvents ?? 200);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
      return c.json({ ok: false, error: "dateFrom/dateTo devem estar no formato YYYY-MM-DD" }, 400);
    }

    const fromIso = new Date(`${dateFrom}T00:00:00-03:00`).toISOString();
    const toIso = new Date(`${dateTo}T23:59:59-03:00`).toISOString();

    const matches = await listBetfairSoccerMatchOddsRange({ fromIso, toIso, maxResults: Number.isFinite(maxResults) ? maxResults : 200 });
    return c.json({ ok: true, matches });
  } catch (error) {
    return c.json({ ok: false, error: error.message || "Erro ao listar jogos (Betfair)" }, 500);
  }
});

const BETFAIR_RESOLVE_CACHE_PREFIX = "betfair/resolve_cache_v1/item/";

const toIsoHourBucket = (utcDate: string | null) => {
  const v = String(utcDate ?? "").trim();
  if (!v) return null;
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 13);
};

const parseCorrectScoreKey = (runnerName: unknown) => {
  const raw = String(runnerName ?? "").trim();
  if (!raw) return null;
  const n = raw.toLowerCase().replace(/\s+/g, " ").trim();

  const m = raw.match(/^(\d+)\s*[-x×]\s*(\d+)$/i) || raw.match(/^(\d+)\s*-\s*(\d+)$/i);
  if (m) return `${Number(m[1])}-${Number(m[2])}`;

  if (n.includes("any other") && n.includes("home") && n.includes("win")) return "AOHW";
  if (n.includes("any other") && n.includes("away") && n.includes("win")) return "AOAW";
  if (n.includes("any other") && n.includes("draw")) return "AOD";

  if (n.includes("qualquer") && n.includes("outro") && n.includes("casa")) return "AOHW";
  if (n.includes("qualquer") && n.includes("outro") && (n.includes("visitante") || n.includes("fora"))) return "AOAW";
  if (n.includes("qualquer") && n.includes("outro") && n.includes("empate")) return "AOD";

  return null;
};

const resolveBetfairCorrectScoreMarket = async (params: { eventId: string }) => {
  const eventId = String(params.eventId ?? "").trim();
  if (!eventId) throw new Error("Betfair: eventId ausente (correct score)");

  let sessionToken = await getBetfairSessionToken();
  const call = async (method: string, rpcParams: any) => {
    try {
      return await betfairJsonRpc({ method, params: rpcParams, sessionToken });
    } catch (e) {
      const invalid = Boolean((e as any)?.__betfairSessionInvalid);
      if (!invalid) throw e;
      sessionToken = await getBetfairSessionToken({ force: true });
      return await betfairJsonRpc({ method, params: rpcParams, sessionToken });
    }
  };

  const catalogue = await withTimeout(
    () =>
      call("SportsAPING/v1.0/listMarketCatalogue", {
        filter: { eventIds: [eventId], marketTypeCodes: ["CORRECT_SCORE"] },
        maxResults: 1,
        marketProjection: ["RUNNER_DESCRIPTION", "MARKET_START_TIME"],
      }),
    8000,
  );

  const mk = Array.isArray(catalogue) ? catalogue[0] : null;
  const marketId = String(mk?.marketId ?? "").trim();
  if (!marketId) throw new Error("Betfair: marketId (CORRECT_SCORE) não encontrado");

  const marketBook = await withTimeout(
    () =>
      call("SportsAPING/v1.0/listMarketBook", {
        marketIds: [marketId],
        priceProjection: { priceData: ["EX_BEST_OFFERS"], virtualise: true },
      }),
    8000,
  );

  const book = Array.isArray(marketBook) ? marketBook[0] : null;
  const totalMatched = Number(book?.totalMatched);
  const runnersBook = Array.isArray(book?.runners) ? book.runners : [];

  const prices: Record<string, any> = {};
  let sumImplied = 0;

  for (const rb of runnersBook) {
    const selectionId = Number(rb?.selectionId);
    if (!Number.isFinite(selectionId)) continue;

    const runnerName =
      (Array.isArray(mk?.runners) ? mk.runners : []).find((r: any) => Number(r?.selectionId) === selectionId)?.runnerName ??
      rb?.runnerName;
    const key = parseCorrectScoreKey(runnerName);
    if (!key) continue;

    const ex = rb?.ex ?? {};
    const back0 = Array.isArray(ex?.availableToBack) ? ex.availableToBack[0] : null;
    const lay0 = Array.isArray(ex?.availableToLay) ? ex.availableToLay[0] : null;
    const back = back0 ? Number(back0.price) : null;
    const lay = lay0 ? Number(lay0.price) : null;
    const backSize = back0 ? Number(back0.size) : null;
    const laySize = lay0 ? Number(lay0.size) : null;

    const implied = back && Number.isFinite(back) && back > 1.001 ? 1 / back : 0;
    if (implied > 0) sumImplied += implied;

    prices[key] = {
      selectionId,
      runnerName: String(runnerName ?? "").trim() || null,
      back: back && Number.isFinite(back) ? back : null,
      backSize: backSize && Number.isFinite(backSize) ? backSize : null,
      lay: lay && Number.isFinite(lay) ? lay : null,
      laySize: laySize && Number.isFinite(laySize) ? laySize : null,
      impliedProb: implied > 0 ? implied : null,
      prob: null as number | null,
    };
  }

  const safeSum = sumImplied > 0 ? sumImplied : 1;
  for (const k of Object.keys(prices)) {
    const implied = Number(prices[k]?.impliedProb);
    prices[k].prob = Number.isFinite(implied) && implied > 0 ? implied / safeSum : null;
  }

  const scoreEntries = Object.entries(prices)
    .filter(([k]) => /^\d+\-\d+$/.test(k))
    .map(([score, v]) => ({ score, ...v }))
    .sort((a, b) => (Number(b.prob) || 0) - (Number(a.prob) || 0))
    .slice(0, 20);

  const sumOutcome = (pred: (home: number, away: number) => boolean) => {
    let s = 0;
    for (const [k, v] of Object.entries(prices)) {
      const p = Number(v?.prob);
      if (!Number.isFinite(p) || p <= 0) continue;
      if (k === "AOHW" || k === "AOAW" || k === "AOD") continue;
      const m = /^(\d+)\-(\d+)$/.exec(k);
      if (!m) continue;
      const h = Number(m[1]);
      const a = Number(m[2]);
      if (!Number.isFinite(h) || !Number.isFinite(a)) continue;
      if (pred(h, a)) s += p;
    }
    return s;
  };

  const homeProb = sumOutcome((h, a) => h > a) + (Number(prices["AOHW"]?.prob) || 0);
  const awayProb = sumOutcome((h, a) => h < a) + (Number(prices["AOAW"]?.prob) || 0);
  const drawProb = sumOutcome((h, a) => h === a) + (Number(prices["AOD"]?.prob) || 0);

  const bttsYesProb = sumOutcome((h, a) => h > 0 && a > 0);
  const over25Prob = sumOutcome((h, a) => h + a > 2.5);

  const winner =
    homeProb >= awayProb && homeProb >= drawProb ? "home" : awayProb >= drawProb ? "away" : "draw";
  const winnerProb = winner === "home" ? homeProb : winner === "away" ? awayProb : drawProb;

  return {
    marketId,
    matchedVolume: Number.isFinite(totalMatched) ? totalMatched : null,
    prices,
    topScores: scoreEntries.map((s) => ({
      score: s.score,
      back: s.back ?? null,
      lay: s.lay ?? null,
      prob: typeof s.prob === "number" ? s.prob : null,
    })),
    summary: {
      winner,
      winnerProb: Number.isFinite(winnerProb) ? winnerProb : null,
      homeProb: Number.isFinite(homeProb) ? homeProb : null,
      drawProb: Number.isFinite(drawProb) ? drawProb : null,
      awayProb: Number.isFinite(awayProb) ? awayProb : null,
      bttsYesProb: Number.isFinite(bttsYesProb) ? bttsYesProb : null,
      over25Prob: Number.isFinite(over25Prob) ? over25Prob : null,
      overround: Number.isFinite(sumImplied) ? sumImplied : null,
    },
    oddsFetchedAt: new Date().toISOString(),
  };
};

app.post("/make-server-1119702f/betfair/match/resolve", async (c) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  try {
    const body = await c.req.json().catch(() => ({}));
    const homeTeam = String(body?.homeTeam ?? "").trim();
    const awayTeam = String(body?.awayTeam ?? "").trim();
    const utcDate = body?.utcDate == null ? null : String(body.utcDate);
    const force = Boolean(body?.force ?? false);
    const includeCorrectScore = Boolean(body?.includeCorrectScore ?? false);
    const minFreshSecondsRaw = Number(body?.minFreshSeconds ?? 600);
    const minFreshSeconds = Math.max(0, Math.min(86_400, Number.isFinite(minFreshSecondsRaw) ? minFreshSecondsRaw : 600));

    if (!homeTeam || !awayTeam) return c.json({ ok: false, error: "homeTeam/awayTeam obrigatórios" }, 400);

    const bucket = toIsoHourBucket(utcDate);
    const key = `${BETFAIR_RESOLVE_CACHE_PREFIX}${normalizeName(homeTeam)}__${normalizeName(awayTeam)}__${bucket ?? "na"}`;
    const cached = force ? null : await kv.get(key);
    const cachedAt = String(cached?.fetchedAt ?? cached?.betfair?.oddsFetchedAt ?? "").trim();
    if (cached && cached?.betfair && cachedAt) {
      const ageSec = (Date.now() - new Date(cachedAt).getTime()) / 1000;
      if (Number.isFinite(ageSec) && ageSec >= 0 && ageSec < minFreshSeconds) {
        return c.json({ ok: true, betfair: cached.betfair, cached: true, fetchedAt: cachedAt });
      }
    }

    const base = await resolveBetfairMatchOdds({ homeTeam, awayTeam, utcDate });
    const correctScore = includeCorrectScore ? await resolveBetfairCorrectScoreMarket({ eventId: base.eventId }) : null;
    const betfair = includeCorrectScore ? { ...base, correctScore } : base;
    const fetchedAt = String(betfair?.oddsFetchedAt ?? new Date().toISOString());
    await kv.set(key, { betfair, fetchedAt, homeTeam, awayTeam, bucket, updatedAt: new Date().toISOString() });
    return c.json({ ok: true, betfair, cached: false, fetchedAt });
  } catch (error) {
    return c.json({ ok: false, error: error.message || "Erro ao resolver jogo (Betfair)" }, 500);
  }
});

app.post("/betfair/match/resolve", async (c) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  try {
    const body = await c.req.json().catch(() => ({}));
    const homeTeam = String(body?.homeTeam ?? "").trim();
    const awayTeam = String(body?.awayTeam ?? "").trim();
    const utcDate = body?.utcDate == null ? null : String(body.utcDate);
    const force = Boolean(body?.force ?? false);
    const includeCorrectScore = Boolean(body?.includeCorrectScore ?? false);
    const minFreshSecondsRaw = Number(body?.minFreshSeconds ?? 600);
    const minFreshSeconds = Math.max(0, Math.min(86_400, Number.isFinite(minFreshSecondsRaw) ? minFreshSecondsRaw : 600));

    if (!homeTeam || !awayTeam) return c.json({ ok: false, error: "homeTeam/awayTeam obrigatórios" }, 400);

    const bucket = toIsoHourBucket(utcDate);
    const key = `${BETFAIR_RESOLVE_CACHE_PREFIX}${normalizeName(homeTeam)}__${normalizeName(awayTeam)}__${bucket ?? "na"}`;
    const cached = force ? null : await kv.get(key);
    const cachedAt = String(cached?.fetchedAt ?? cached?.betfair?.oddsFetchedAt ?? "").trim();
    if (cached && cached?.betfair && cachedAt) {
      const ageSec = (Date.now() - new Date(cachedAt).getTime()) / 1000;
      if (Number.isFinite(ageSec) && ageSec >= 0 && ageSec < minFreshSeconds) {
        return c.json({ ok: true, betfair: cached.betfair, cached: true, fetchedAt: cachedAt });
      }
    }

    const base = await resolveBetfairMatchOdds({ homeTeam, awayTeam, utcDate });
    const correctScore = includeCorrectScore ? await resolveBetfairCorrectScoreMarket({ eventId: base.eventId }) : null;
    const betfair = includeCorrectScore ? { ...base, correctScore } : base;
    const fetchedAt = String(betfair?.oddsFetchedAt ?? new Date().toISOString());
    await kv.set(key, { betfair, fetchedAt, homeTeam, awayTeam, bucket, updatedAt: new Date().toISOString() });
    return c.json({ ok: true, betfair, cached: false, fetchedAt });
  } catch (error) {
    return c.json({ ok: false, error: error.message || "Erro ao resolver jogo (Betfair)" }, 500);
  }
});

app.post("/make-server-1119702f/automation/betfair/queue/add", async (c) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  try {
    const body = await c.req.json();
    const matchId = String(body?.matchId ?? "").trim();
    if (!matchId) return c.json({ ok: false, error: "matchId obrigatório" }, 400);
    const key = `${BETFAIR_QUEUE_PREFIX}${matchId}`;
    const existing = (await kv.get(key)) ?? null;
    const now = new Date().toISOString();
    const payload: any = {
      matchId,
      source: String(body?.source ?? "").trim() || existing?.source || null,
      utcDate: String(body?.utcDate ?? "").trim() || existing?.utcDate || null,
      homeTeam: String(body?.homeTeam ?? "").trim() || existing?.homeTeam || null,
      awayTeam: String(body?.awayTeam ?? "").trim() || existing?.awayTeam || null,
      prediction: body?.prediction ?? existing?.prediction ?? null,
      createdAt: String(existing?.createdAt ?? now),
      updatedAt: now,
      status: String(existing?.status ?? "queued"),
      betfair: existing?.betfair ?? null,
      mappingStatus: existing?.mappingStatus ?? "pending",
      mappingError: existing?.mappingError ?? null,
    };

    const hasMarket = Boolean(payload?.betfair?.marketId);
    if (!hasMarket && payload.homeTeam && payload.awayTeam) {
      try {
        const mapped = await resolveBetfairMatchOdds({
          homeTeam: payload.homeTeam,
          awayTeam: payload.awayTeam,
          utcDate: payload.utcDate,
        });
        payload.betfair = mapped;
        try {
          const cs = await resolveBetfairCorrectScoreMarket({ eventId: String(mapped?.eventId ?? "") });
          if (payload.betfair && cs) payload.betfair.correctScore = cs;
        } catch {}
        payload.mappingStatus = "mapped";
        payload.mappingError = null;
        payload.mappedAt = new Date().toISOString();
      } catch (e) {
        payload.mappingStatus = "unmapped";
        payload.mappingError = e instanceof Error ? e.message : String(e);
      }
    }
    await kv.set(key, payload);
    return c.json({ ok: true, item: payload });
  } catch (error) {
    return c.json({ ok: false, error: error.message || "Erro ao enfileirar jogo" }, 500);
  }
});
app.post("/automation/betfair/queue/add", async (c) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  try {
    const body = await c.req.json();
    const matchId = String(body?.matchId ?? "").trim();
    if (!matchId) return c.json({ ok: false, error: "matchId obrigatório" }, 400);
    const key = `${BETFAIR_QUEUE_PREFIX}${matchId}`;
    const existing = (await kv.get(key)) ?? null;
    const now = new Date().toISOString();
    const payload: any = {
      matchId,
      source: String(body?.source ?? "").trim() || existing?.source || null,
      utcDate: String(body?.utcDate ?? "").trim() || existing?.utcDate || null,
      homeTeam: String(body?.homeTeam ?? "").trim() || existing?.homeTeam || null,
      awayTeam: String(body?.awayTeam ?? "").trim() || existing?.awayTeam || null,
      prediction: body?.prediction ?? existing?.prediction ?? null,
      createdAt: String(existing?.createdAt ?? now),
      updatedAt: now,
      status: String(existing?.status ?? "queued"),
      betfair: existing?.betfair ?? null,
      mappingStatus: existing?.mappingStatus ?? "pending",
      mappingError: existing?.mappingError ?? null,
    };

    const hasMarket = Boolean(payload?.betfair?.marketId);
    if (!hasMarket && payload.homeTeam && payload.awayTeam) {
      try {
        const mapped = await resolveBetfairMatchOdds({
          homeTeam: payload.homeTeam,
          awayTeam: payload.awayTeam,
          utcDate: payload.utcDate,
        });
        payload.betfair = mapped;
        try {
          const cs = await resolveBetfairCorrectScoreMarket({ eventId: String(mapped?.eventId ?? "") });
          if (payload.betfair && cs) payload.betfair.correctScore = cs;
        } catch {}
        payload.mappingStatus = "mapped";
        payload.mappingError = null;
        payload.mappedAt = new Date().toISOString();
      } catch (e) {
        payload.mappingStatus = "unmapped";
        payload.mappingError = e instanceof Error ? e.message : String(e);
      }
    }
    await kv.set(key, payload);
    return c.json({ ok: true, item: payload });
  } catch (error) {
    return c.json({ ok: false, error: error.message || "Erro ao enfileirar jogo" }, 500);
  }
});

app.post("/make-server-1119702f/automation/betfair/queue/list", async (c) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  try {
    const items = await kv.getByPrefix(BETFAIR_QUEUE_PREFIX);
    return c.json({ ok: true, items: Array.isArray(items) ? items : [] });
  } catch (error) {
    return c.json({ ok: false, error: error.message || "Erro ao listar fila" }, 500);
  }
});
app.post("/automation/betfair/queue/list", async (c) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  try {
    const items = await kv.getByPrefix(BETFAIR_QUEUE_PREFIX);
    return c.json({ ok: true, items: Array.isArray(items) ? items : [] });
  } catch (error) {
    return c.json({ ok: false, error: error.message || "Erro ao listar fila" }, 500);
  }
});

const betfairQueueRemoveHandler = async (c: any) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  try {
    const body = await c.req.json().catch(() => ({}));
    const matchId = String(body?.matchId ?? "").trim();
    if (!matchId) return c.json({ ok: false, error: "matchId obrigatório" }, 400);
    await kv.del(`${BETFAIR_QUEUE_PREFIX}${matchId}`);
    return c.json({ ok: true });
  } catch (error) {
    return c.json({ ok: false, error: error.message || "Erro ao remover item" }, 500);
  }
};

const betfairQueueUpdateHandler = async (c: any) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  try {
    const body = await c.req.json().catch(() => ({}));
    const matchId = String(body?.matchId ?? "").trim();
    if (!matchId) return c.json({ ok: false, error: "matchId obrigatório" }, 400);
    const patch = (body?.patch && typeof body.patch === "object") ? body.patch : {};
    const key = `${BETFAIR_QUEUE_PREFIX}${matchId}`;
    const current = (await kv.get(key)) ?? {};
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    await kv.set(key, next);
    return c.json({ ok: true, item: next });
  } catch (error) {
    return c.json({ ok: false, error: error.message || "Erro ao atualizar item" }, 500);
  }
};

app.post("/make-server-1119702f/automation/betfair/queue/remove", betfairQueueRemoveHandler);
app.post("/automation/betfair/queue/remove", betfairQueueRemoveHandler);
app.post("/make-server-1119702f/automation/betfair/queue/update", betfairQueueUpdateHandler);
app.post("/automation/betfair/queue/update", betfairQueueUpdateHandler);

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
