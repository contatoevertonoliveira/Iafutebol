import { Hono } from "https://deno.land/x/hono@v4.3.11/mod.ts";
import * as kv from "./kv_store.ts";
let __bootError: unknown = null;
try {
const app = new Hono();

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-automation-token, x-client-info, prefer",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "Content-Length",
  "Access-Control-Max-Age": "600",
};

app.use("*", async (c, next) => {
  const startedAt = Date.now();
  await next();
  for (const [k, v] of Object.entries(CORS_HEADERS)) c.header(k, v);
  const ms = Date.now() - startedAt;
  try {
    console.log(`${c.req.method} ${c.req.path} -> ${c.res.status} (${ms}ms)`);
  } catch {
  }
});

app.options("*", (c) => {
  for (const [k, v] of Object.entries(CORS_HEADERS)) c.header(k, v);
  return c.text("", 204);
});

app.get("/health", (c) => {
  return c.json({ status: "ok" });
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
    const { unzipSync } = await import("https://esm.sh/fflate@0.8.2");
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

app.post("/kaggle/download-csv", async (c) => {
  try {
    const body = await c.req.json();
    const { csvText, fileName } = await kaggleDownloadDatasetFile(body);
    return c.json({ ok: true, fileName, csvText });
  } catch (error) {
    return c.json({ ok: false, error: error?.message ?? "Erro ao baixar CSV do Kaggle" }, 400);
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

const betfairJsonRpcRawWithUrl = async (params: { url: string; method: string; params: any; sessionToken: string }) => {
  const cfg = getBetfairConfig();
  if (!cfg.appKey) throw new Error("Betfair: APP_KEY ausente");
  const url = String(params.url ?? "").trim();
  if (!url) throw new Error("Betfair: url ausente");
  const method = String(params.method ?? "").trim();

  const res = await fetch(url, {
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

const betfairJsonRpcAccount = async (params: { method: string; params: any; sessionToken: string }) => {
  const method = String(params.method ?? "").trim();
  const allowed = new Set(["AccountAPING/v1.0/getAccountFunds"]);
  if (!allowed.has(method)) throw new Error("Betfair: método não permitido");
  const cfg = getBetfairConfig();
  const accountUrl = `https://${cfg.apiHost}/exchange/account/json-rpc/v1`;
  return await betfairJsonRpcRawWithUrl({ url: accountUrl, ...params, method });
};

const betfairJsonRpcTrading = async (params: { method: string; params: any; sessionToken: string }) => {
  const method = String(params.method ?? "").trim();
  const allowed = new Set([
    "SportsAPING/v1.0/placeOrders",
    "SportsAPING/v1.0/listCurrentOrders",
    "SportsAPING/v1.0/cancelOrders",
    "SportsAPING/v1.0/listMarketProfitAndLoss",
  ]);
  if (!allowed.has(method)) throw new Error("Betfair: método não permitido");
  return await betfairJsonRpcRaw({ ...params, method });
};

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

app.post("/automation/betfair/account/funds", betfairAccountFundsHandler);
app.post("/betfair/account/funds", betfairAccountFundsHandler);

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

async function betfairAccountFundsHandler(c: any) {
  const authError = requireBearer(c);
  if (authError) return authError;
  const adminError = requireAutomationAdmin(c);
  if (adminError) return adminError;
  try {
    const body = await c.req.json().catch(() => ({}));
    const wallet = String(body?.wallet ?? "").trim() || null;
    const sessionToken = await getBetfairSessionToken();
    let result: any = null;
    try {
      result = await betfairJsonRpcAccount({
        method: "AccountAPING/v1.0/getAccountFunds",
        params: wallet ? { wallet } : {},
        sessionToken,
      });
    } catch (e) {
      const invalid = Boolean((e as any)?.__betfairSessionInvalid);
      if (!invalid) throw e;
      const refreshed = await getBetfairSessionToken({ force: true });
      result = await betfairJsonRpcAccount({
        method: "AccountAPING/v1.0/getAccountFunds",
        params: wallet ? { wallet } : {},
        sessionToken: refreshed,
      });
    }

    const availableToBetBalance = Number(result?.availableToBetBalance);
    const exposure = Number(result?.exposure);
    const currencyCode = String(result?.currencyCode ?? "").trim() || null;

    return c.json({
      ok: true,
      funds: result ?? null,
      summary: {
        availableToBetBalance: Number.isFinite(availableToBetBalance) ? availableToBetBalance : null,
        exposure: Number.isFinite(exposure) ? exposure : null,
        currencyCode,
      },
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    return c.json({ ok: false, error: error.message || "Erro ao buscar banca (Betfair)" }, 500);
  }
}

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
  const stripTeamNoise = (value: string) => {
    const n = normalizeName(value);
    if (!n) return "";
    const stop = new Set(["fc", "cf", "sc", "ac", "cd", "de", "da", "do", "the", "club", "clube"]);
    return n
      .split(" ")
      .filter((t) => t && t.length >= 3 && !stop.has(t) && !/^\d+$/.test(t))
      .join(" ")
      .trim();
  };

  const qHome = stripTeamNoise(homeTeam);
  const qAway = stripTeamNoise(awayTeam);
  const eventQueries = Array.from(
    new Set(
      [
        homeTeam,
        awayTeam,
        `${homeTeam} ${awayTeam}`,
        qHome,
        qAway,
        `${qHome} ${qAway}`.trim(),
        `${(qHome.split(" ")[0] ?? "").trim()} ${(qAway.split(" ")[0] ?? "").trim()}`.trim(),
      ].map((x) => String(x ?? "").trim()).filter(Boolean),
    ),
  );
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
        priceProjection: {
          priceData: ["EX_BEST_OFFERS", "EX_TRADED"],
          exBestOffersOverrides: { bestPricesDepth: 10 },
          virtualise: true,
        },
      }),
    8000,
  );

  const book = Array.isArray(marketBook) ? marketBook[0] : null;
  const marketStatus = String(book?.status ?? "").trim() || null;
  const isClosed = String(marketStatus ?? "").toUpperCase() === "CLOSED";
  const inPlay = isClosed ? false : Boolean(book?.inplay ?? false);
  const totalMatched = Number(book?.totalMatched);
  const runnersBook = Array.isArray(book?.runners) ? book.runners : [];
  const odds: any = {};
  const pull = (selectionId: number) => {
    const rb = runnersBook.find((x: any) => Number(x?.selectionId) === selectionId);
    const ex = rb?.ex ?? {};
    const back0 = Array.isArray(ex?.availableToBack) ? ex.availableToBack[0] : null;
    const lay0 = Array.isArray(ex?.availableToLay) ? ex.availableToLay[0] : null;
    const ltp = Number(rb?.lastPriceTraded);
    return {
      back: back0 ? Number(back0.price) : Number.isFinite(ltp) ? ltp : null,
      backSize: back0 ? Number(back0.size) : null,
      lay: lay0 ? Number(lay0.price) : Number.isFinite(ltp) ? ltp : null,
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
    inPlay,
    marketStatus,
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

type CorrectScorePlanConfig = {
  minProfitPct: number;
  targetProfitPct: number;
  maxProfitPct: number;
  bankroll: number;
  maxSelections: number;
  maxGoals: number;
  includeAnyOther: boolean;
};

type CorrectScorePlanLeg = {
  key: string;
  selectionId: number | null;
  back: number | null;
  lay: number | null;
  impliedProb: number | null;
  stake: number | null;
};

type CorrectScorePlan = {
  ok: boolean;
  reason?: string | null;
  mode: "dutch_back" | "staged_back" | "ladder_volume" | "skip";
  marketId: string | null;
  favorite?: "home" | "away" | null;
  score?: { home: number; away: number } | null;
  scenario?: "base_0_0_to_2_2" | "favorite_losing_ht_1_2" | null;
  isFinished: boolean;
  isLive: boolean;
  achievableProfitPct: number | null;
  plannedProfitPct: number | null;
  legs: CorrectScorePlanLeg[];
  instructions: any[];
  createdAt: string;
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

const parseScoreKey = (key: string) => {
  const m = String(key ?? "").trim().match(/^(\d+)-(\d+)$/);
  if (!m) return null;
  const home = Number(m[1]);
  const away = Number(m[2]);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  return { home, away };
};

const pickPreLiveFavorite = (item: any) => {
  const p = item?.prediction && typeof item.prediction === "object" ? item.prediction : null;
  const pred = String(p?.winner?.prediction ?? "").trim();
  const conf = Number(p?.winner?.confidence);
  const favorite = pred === "home" || pred === "away" ? pred : null;
  const confidence = Number.isFinite(conf) ? conf : null;
  if (!favorite) return { favorite: null as ("home" | "away" | null), confidence };
  if (confidence != null && confidence < 55) return { favorite: null as ("home" | "away" | null), confidence };
  return { favorite: favorite as "home" | "away", confidence };
};

const extractCorrectScorePrice = (cs: any, key: string) => {
  const p = cs?.prices?.[key] ?? null;
  if (!p || typeof p !== "object") return null;
  const selectionId = Number(p?.selectionId);
  const back = Number(p?.back);
  const lay = Number(p?.lay);
  const impliedProb = Number(p?.impliedProb);
  return {
    selectionId: Number.isFinite(selectionId) ? selectionId : null,
    back: Number.isFinite(back) ? back : null,
    lay: Number.isFinite(lay) ? lay : null,
    impliedProb: Number.isFinite(impliedProb) ? impliedProb : null,
  };
};

const pickCoverageKeys = (item: any, cfg: CorrectScorePlanConfig) => {
  const scoreHome = Number(item?.scoreHome);
  const scoreAway = Number(item?.scoreAway);
  const score =
    Number.isFinite(scoreHome) && Number.isFinite(scoreAway) && scoreHome >= 0 && scoreAway >= 0
      ? { home: Math.floor(scoreHome), away: Math.floor(scoreAway) }
      : null;

  const { favorite } = pickPreLiveFavorite(item);
  const hasMarket = Boolean(item?.betfair?.marketId);
  const marketStatus = String(item?.betfair?.marketStatus ?? "").toUpperCase();
  const isFinished = hasMarket && marketStatus === "CLOSED";

  const isFirstHalf = (() => {
    const short = String(item?.live?.statusShort ?? "").toUpperCase();
    if (short === "HT" || short === "1H") return true;
    const elapsed = Number(item?.live?.elapsed);
    if (Number.isFinite(elapsed) && elapsed >= 35 && elapsed <= 55) return true;
    return false;
  })();

  const isFavoriteLosing1to2AtHT =
    Boolean(favorite) && Boolean(score) && isFirstHalf && !isFinished && (() => {
      const fav = favorite as "home" | "away";
      const favGoals = fav === "home" ? (score as any).home : (score as any).away;
      const oppGoals = fav === "home" ? (score as any).away : (score as any).home;
      const d = oppGoals - favGoals;
      return d === 1 || d === 2;
    })();

  if (isFavoriteLosing1to2AtHT && favorite && score) {
    const maxGoals = cfg.maxGoals;
    const fav = favorite;
    const set = new Set<string>();
    set.add(`${score.home}-${score.away}`);

    for (let h = score.home; h <= maxGoals; h += 1) {
      for (let a = score.away; a <= maxGoals; a += 1) {
        const margin = fav === "home" ? a - h : h - a;
        if (margin > 2) continue;
        set.add(`${h}-${a}`);
      }
    }

    const keys = Array.from(set).filter((k) => {
      const s = parseScoreKey(k);
      if (!s) return false;
      if (s.home > maxGoals || s.away > maxGoals) return false;
      return true;
    });
    return { keys, score, favorite, scenario: "favorite_losing_ht_1_2" as const };
  }

  const keys: string[] = [];
  for (let h = 0; h <= 2; h += 1) for (let a = 0; a <= 2; a += 1) keys.push(`${h}-${a}`);
  return { keys, score, favorite, scenario: "base_0_0_to_2_2" as const };
};

const buildDutchBackPlan = (legs: CorrectScorePlanLeg[], cfg: CorrectScorePlanConfig) => {
  const usable = legs
    .filter((l) => Number.isFinite(Number(l?.selectionId)) && Number(l.selectionId) > 0)
    .filter((l) => typeof l.back === "number" && Number.isFinite(l.back) && (l.back as number) > 1.01 && (l.back as number) <= 1000)
    .map((l) => ({ ...l, selectionId: Number(l.selectionId), back: l.back as number }));

  if (usable.length < 3) {
    return { ok: false, reason: "Poucas seleções com preço BACK disponível" as const, mode: "skip" as const, legs: [] as CorrectScorePlanLeg[], instructions: [] as any[], achievableProfitPct: null as number | null, plannedProfitPct: null as number | null };
  }

  usable.sort((a, b) => (Number(b.impliedProb ?? (1 / (b.back as number))) - Number(a.impliedProb ?? (1 / (a.back as number)))));
  const minStake = 2;
  const stakeBudget = Math.max(minStake, cfg.bankroll);
  let chosen = usable.slice(0, Math.max(3, Math.min(cfg.maxSelections, usable.length)));

  const calc = (arr: Array<{ back: number }>) => {
    const sumInv = arr.reduce((acc, l) => acc + (1 / l.back), 0);
    const achievableProfitPct = Number.isFinite(sumInv) && sumInv > 0 ? (1 / sumInv) - 1 : null;
    return { sumInv, achievableProfitPct };
  };

  const computeStakes = (arr: Array<{ back: number }>) => {
    const { sumInv, achievableProfitPct } = calc(arr);
    if (!(typeof achievableProfitPct === "number" && Number.isFinite(achievableProfitPct))) return { ok: false as const, sumInv, achievableProfitPct, stakes: [] as number[] };
    if (!(Number.isFinite(sumInv) && sumInv > 0 && sumInv < 1)) return { ok: false as const, sumInv, achievableProfitPct, stakes: [] as number[] };
    const T = stakeBudget / sumInv;
    const raw = arr.map((l) => T / l.back);
    const rounded = raw.map((v) => round2(v));
    return { ok: true as const, sumInv, achievableProfitPct, stakes: rounded };
  };

  while (chosen.length >= 3) {
    const { ok, achievableProfitPct, stakes } = computeStakes(chosen);
    if (!ok || achievableProfitPct == null) break;
    const minStakeIdx = stakes.reduce((idx, s, i) => (s < stakes[idx] ? i : idx), 0);
    if (stakes[minStakeIdx] >= minStake) break;
    chosen = chosen.filter((_, i) => i !== minStakeIdx);
  }

  const sumInv = chosen.reduce((acc, l) => acc + (1 / (l.back as number)), 0);
  const achievableProfitPct = Number.isFinite(sumInv) && sumInv > 0 ? (1 / sumInv) - 1 : null;
  if (achievableProfitPct == null) {
    return { ok: false, reason: "Falha ao calcular overround" as const, mode: "skip" as const, legs: [] as CorrectScorePlanLeg[], instructions: [] as any[], achievableProfitPct: null as number | null, plannedProfitPct: null as number | null };
  }

  if (!(Number.isFinite(sumInv) && sumInv > 0 && sumInv < 1)) {
    return { ok: false, reason: "Dá para dutchar, mas sem greenbook (overround alto)" as const, mode: "staged_back" as const, legs: chosen.map((l) => ({ ...l, stake: null })), instructions: [], achievableProfitPct, plannedProfitPct: null };
  }

  if (achievableProfitPct < cfg.minProfitPct) {
    return {
      ok: false,
      reason: `Não dá para garantir ${Math.round(cfg.minProfitPct * 100)}% com os preços atuais (achievable ${(achievableProfitPct * 100).toFixed(2)}%)`,
      mode: "staged_back" as const,
      legs: chosen.map((l) => ({ ...l, stake: null })),
      instructions: [],
      achievableProfitPct,
      plannedProfitPct: null,
    };
  }

  const plannedProfitPct = Math.min(cfg.maxProfitPct, Math.max(cfg.minProfitPct, Math.min(cfg.targetProfitPct, achievableProfitPct)));
  const T = stakeBudget / sumInv;
  const withStakes = chosen.map((l) => ({ ...l, stake: round2(T / (l.back as number)) }));
  const instructions = withStakes
    .filter((l) => l.selectionId && l.stake && l.stake >= minStake && l.back)
    .map((l) => ({
      selectionId: l.selectionId,
      side: "BACK",
      orderType: "LIMIT",
      limitOrder: {
        size: l.stake,
        price: l.back,
        persistenceType: "LAPSE",
      },
    }));

  return { ok: true, reason: null as string | null, mode: "dutch_back" as const, legs: withStakes, instructions, achievableProfitPct, plannedProfitPct };
};

const buildLadderVolumePlan = (item: any, cs: any, cfg: CorrectScorePlanConfig): CorrectScorePlan => {
  const createdAt = new Date().toISOString();
  const scoreHome = Number(item?.scoreHome);
  const scoreAway = Number(item?.scoreAway);
  const score =
    Number.isFinite(scoreHome) && Number.isFinite(scoreAway) && scoreHome >= 0 && scoreAway >= 0
      ? { home: Math.floor(scoreHome), away: Math.floor(scoreAway) }
      : { home: 0, away: 0 };

  const clampGoals = (v: number) => Math.max(0, Math.min(cfg.maxGoals, Math.floor(v)));
  const h = clampGoals(score.home);
  const a = clampGoals(score.away);

  const baseKeys = Array.from(new Set([`${h}-${a}`, `${clampGoals(h + 1)}-${a}`, `${h}-${clampGoals(a + 1)}`]));

  const read = (key: string) => {
    const p = cs?.prices?.[key] ?? null;
    if (!p || typeof p !== "object") return null;
    const selectionId = Number(p?.selectionId);
    const back = Number(p?.back);
    const lay = Number(p?.lay);
    const impliedProb = Number(p?.impliedProb);
    const backSize = Number(p?.backSize);
    const laySize = Number(p?.laySize);
    const tradedVolume = Number(p?.tradedVolume);
    return {
      selectionId: Number.isFinite(selectionId) ? selectionId : null,
      back: Number.isFinite(back) ? back : null,
      lay: Number.isFinite(lay) ? lay : null,
      impliedProb: Number.isFinite(impliedProb) ? impliedProb : (Number.isFinite(back) && back > 1.01 ? 1 / back : null),
      backSize: Number.isFinite(backSize) ? backSize : null,
      laySize: Number.isFinite(laySize) ? laySize : null,
      tradedVolume: Number.isFinite(tradedVolume) ? tradedVolume : null,
    };
  };

  const legs: CorrectScorePlanLeg[] = baseKeys.map((k) => {
    const p = read(k);
    return {
      key: k,
      selectionId: p?.selectionId ?? null,
      back: p?.back ?? null,
      lay: p?.lay ?? null,
      impliedProb: p?.impliedProb ?? null,
      stake: null,
    };
  });

  const usable = legs.filter((l) => l.selectionId && typeof l.back === "number" && Number.isFinite(l.back) && (l.back as number) > 1.01);
  if (usable.length === 0) {
    return { ok: false, reason: "Sem preços BACK disponíveis para placar atual/próximos", mode: "skip", marketId: String(cs?.marketId ?? "").trim() || null, score, scenario: "base_0_0_to_2_2", isFinished: false, isLive: Boolean(item?.betfair?.inPlay), achievableProfitPct: null, plannedProfitPct: null, legs, instructions: [], createdAt };
  }

  const weights = usable.map((l) => {
    const p = read(l.key);
    const wVol = Number(p?.tradedVolume);
    const wBack = Number(p?.backSize);
    const wProb = Number(l.impliedProb);
    const w = (Number.isFinite(wVol) ? wVol : 0) * 1.0 + (Number.isFinite(wBack) ? wBack : 0) * 0.2 + (Number.isFinite(wProb) ? wProb : 0) * 100.0;
    return { key: l.key, w: Number.isFinite(w) && w > 0 ? w : 1 };
  });
  const sumW = weights.reduce((acc, x) => acc + x.w, 0) || 1;

  const bankroll = Math.max(2, cfg.bankroll);
  const plannedProfitPct = cfg.targetProfitPct;
  const withStakes = legs.map((l) => {
    const w = weights.find((x) => x.key === l.key)?.w ?? 0;
    const stake = l.selectionId && l.back ? round2((bankroll * w) / sumW) : null;
    return { ...l, stake: stake != null && stake >= 2 ? stake : null };
  });

  const instructions = withStakes
    .filter((l) => l.selectionId && l.stake && l.stake >= 2 && l.back)
    .map((l) => ({
      selectionId: l.selectionId,
      side: "BACK",
      orderType: "LIMIT",
      limitOrder: {
        size: l.stake,
        price: l.back,
        persistenceType: "LAPSE",
      },
    }));

  return {
    ok: instructions.length > 0,
    reason: instructions.length > 0 ? null : "Stake mínima não atingida nas seleções",
    mode: "ladder_volume",
    marketId: String(cs?.marketId ?? "").trim() || null,
    favorite: pickPreLiveFavorite(item).favorite,
    score,
    scenario: "base_0_0_to_2_2",
    isFinished: false,
    isLive: Boolean(item?.betfair?.inPlay),
    achievableProfitPct: null,
    plannedProfitPct,
    legs: withStakes,
    instructions,
    createdAt,
  };
};

const planCorrectScoreForQueueItem = (item: any, override?: Partial<CorrectScorePlanConfig>): CorrectScorePlan => {
  const createdAt = new Date().toISOString();
  const hasMarket = Boolean(item?.betfair?.marketId);
  const marketStatus = String(item?.betfair?.marketStatus ?? "").toUpperCase();
  const isFinished = hasMarket && marketStatus === "CLOSED";
  const isLive = Boolean(item?.betfair?.inPlay) && !isFinished;

  const cs = item?.betfair?.correctScore ?? null;
  const marketId = String(cs?.marketId ?? "").trim() || null;
  if (!marketId) {
    return { ok: false, reason: "Market CORRECT_SCORE não resolvido ainda", mode: "skip", marketId: null, isFinished, isLive, achievableProfitPct: null, plannedProfitPct: null, legs: [], instructions: [], createdAt };
  }
  if (isFinished) {
    return { ok: true, reason: null, mode: "skip", marketId, isFinished, isLive: false, achievableProfitPct: null, plannedProfitPct: null, legs: [], instructions: [], createdAt };
  }

  const cfg: CorrectScorePlanConfig = {
    minProfitPct: clamp(Number(override?.minProfitPct ?? 0.03), 0.0, 0.2),
    targetProfitPct: clamp(Number(override?.targetProfitPct ?? 0.03), 0.0, 0.25),
    maxProfitPct: clamp(Number(override?.maxProfitPct ?? 0.05), 0.0, 0.5),
    bankroll: clamp(Number(override?.bankroll ?? 50), 2, 10_000),
    maxSelections: clamp(Number(override?.maxSelections ?? 10), 3, 25),
    maxGoals: clamp(Number(override?.maxGoals ?? 3), 2, 6),
    includeAnyOther: Boolean(override?.includeAnyOther ?? true),
  };

  const planType = String(item?.strategy?.correctScore?.planType ?? "").trim().toLowerCase();
  if (planType === "ladder_volume") {
    return buildLadderVolumePlan(item, cs, cfg);
  }

  const picked = pickCoverageKeys(item, cfg);
  const keys = cfg.includeAnyOther ? [...picked.keys, "AOHW", "AOD", "AOAW"] : picked.keys;

  const legs: CorrectScorePlanLeg[] = keys.map((k) => {
    const px = extractCorrectScorePrice(cs, k);
    return {
      key: k,
      selectionId: px?.selectionId ?? null,
      back: px?.back ?? null,
      lay: px?.lay ?? null,
      impliedProb: px?.impliedProb ?? (typeof px?.back === "number" && px.back > 1 ? 1 / px.back : null),
      stake: null,
    };
  });

  const dutch = buildDutchBackPlan(legs, cfg);
  return {
    ok: dutch.ok,
    reason: dutch.reason ?? null,
    mode: dutch.mode,
    marketId,
    favorite: picked.favorite,
    score: picked.score,
    scenario: picked.scenario,
    isFinished,
    isLive,
    achievableProfitPct: dutch.achievableProfitPct,
    plannedProfitPct: dutch.plannedProfitPct,
    legs: dutch.legs.length > 0 ? dutch.legs : legs,
    instructions: dutch.instructions,
    createdAt,
  };
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
    const traded = Array.isArray(ex?.tradedVolume) ? ex.tradedVolume : [];
    const back = back0 ? Number(back0.price) : null;
    const lay = lay0 ? Number(lay0.price) : null;
    const backSize = back0 ? Number(back0.size) : null;
    const laySize = lay0 ? Number(lay0.size) : null;
    const tradedVolume = traded.reduce((acc: number, t: any) => {
      const sz = Number(t?.size);
      return Number.isFinite(sz) ? acc + sz : acc;
    }, 0);

    const implied = back && Number.isFinite(back) && back > 1.001 ? 1 / back : 0;
    if (implied > 0) sumImplied += implied;

    prices[key] = {
      selectionId,
      runnerName: String(runnerName ?? "").trim() || null,
      back: back && Number.isFinite(back) ? back : null,
      backSize: backSize && Number.isFinite(backSize) ? backSize : null,
      lay: lay && Number.isFinite(lay) ? lay : null,
      laySize: laySize && Number.isFinite(laySize) ? laySize : null,
      tradedVolume: Number.isFinite(tradedVolume) ? tradedVolume : null,
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

const resolveBetfairOverUnderMarket = async (params: { eventId: string; line: number }) => {
  const eventId = String(params.eventId ?? "").trim();
  const lineRaw = Number(params.line);
  if (!eventId) throw new Error("Betfair: eventId ausente (over/under)");
  if (!Number.isFinite(lineRaw)) throw new Error("Betfair: linha inválida (over/under)");
  const line10 = Math.round(lineRaw * 10);
  if (!Number.isFinite(line10) || line10 < 5 || line10 > 105 || line10 % 10 !== 5) throw new Error("Betfair: linha inválida (over/under)");
  const line = line10 / 10;
  const marketTypeCode = `OVER_UNDER_${String(line10).padStart(2, "0")}`;

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
        filter: { eventIds: [eventId], marketTypeCodes: [marketTypeCode] },
        maxResults: 1,
        marketProjection: ["RUNNER_DESCRIPTION", "MARKET_START_TIME"],
      }),
    8000,
  );

  const mk = Array.isArray(catalogue) ? catalogue[0] : null;
  const marketId = String(mk?.marketId ?? "").trim();
  if (!marketId) throw new Error(`Betfair: marketId (${marketTypeCode}) não encontrado`);

  const marketBook = await withTimeout(
    () =>
      call("SportsAPING/v1.0/listMarketBook", {
        marketIds: [marketId],
        priceProjection: { priceData: ["EX_BEST_OFFERS", "EX_TRADED"], virtualise: true },
      }),
    8000,
  );

  const book = Array.isArray(marketBook) ? marketBook[0] : null;
  const runnersBook = Array.isArray(book?.runners) ? book.runners : [];
  const catalogueRunners = Array.isArray(mk?.runners) ? mk.runners : [];
  const totalMatchedRaw = Number(book?.totalMatched);
  const matchedVolume = Number.isFinite(totalMatchedRaw) ? round2(totalMatchedRaw) : null;
  const marketStatus = String(book?.status ?? "").trim() || null;
  const isClosed = String(marketStatus ?? "").toUpperCase() === "CLOSED";
  const inPlay = isClosed ? false : Boolean(book?.inplay ?? false);
  const publishTimeMs = Number(book?.publishTime);
  const publishTime = Number.isFinite(publishTimeMs) ? new Date(publishTimeMs).toISOString() : null;

  const byRole: any = { under: null as any, over: null as any };
  const best = (ex: any, key: "availableToBack" | "availableToLay") => {
    const a = Array.isArray(ex?.[key]) ? ex[key] : [];
    const p0 = a[0] ?? null;
    const price = p0 ? Number(p0.price) : null;
    const size = p0 ? Number(p0.size) : null;
    return { price: Number.isFinite(price) ? price : null, size: Number.isFinite(size) ? size : null };
  };
  const ladder = (ex: any, key: "availableToBack" | "availableToLay") => {
    const a = Array.isArray(ex?.[key]) ? ex[key] : [];
    return a
      .slice(0, 10)
      .map((x: any) => {
        const price = Number(x?.price);
        const size = Number(x?.size);
        return { price: Number.isFinite(price) ? price : null, size: Number.isFinite(size) ? size : null };
      })
      .filter((x: any) => typeof x.price === "number" && typeof x.size === "number" && x.price > 1.01 && x.size > 0);
  };
  const sumTraded = (ex: any) => {
    const tv = Array.isArray(ex?.tradedVolume) ? ex.tradedVolume : [];
    const total = tv.reduce((acc: number, t: any) => {
      const sz = Number(t?.size);
      return Number.isFinite(sz) ? acc + sz : acc;
    }, 0);
    return Number.isFinite(total) ? round2(total) : null;
  };

  for (const rb of runnersBook) {
    const selectionId = Number(rb?.selectionId);
    if (!Number.isFinite(selectionId)) continue;
    const runnerName =
      catalogueRunners.find((r: any) => Number(r?.selectionId) === selectionId)?.runnerName ??
      rb?.runnerName ??
      "";
    const n = String(runnerName).toLowerCase();
    const role = n.includes("under") ? "under" : n.includes("over") ? "over" : null;
    if (!role) continue;
    if (byRole[role]) continue;
    const ex = rb?.ex ?? {};
    const back0 = best(ex, "availableToBack");
    const lay0 = best(ex, "availableToLay");
    const backLadder = ladder(ex, "availableToBack");
    const layLadder = ladder(ex, "availableToLay");
    byRole[role] = {
      selectionId,
      runnerName: String(runnerName).trim() || null,
      back: back0.price,
      backSize: back0.size,
      lay: lay0.price,
      laySize: lay0.size,
      backLadder,
      layLadder,
      tradedVolume: sumTraded(ex),
    };
  }

  return {
    marketId,
    marketTypeCode,
    line,
    marketStartTime: String(mk?.marketStartTime ?? "").trim() || null,
    matchedVolume,
    inPlay,
    marketStatus,
    publishTime,
    runners: {
      underSelectionId: byRole.under?.selectionId ?? null,
      overSelectionId: byRole.over?.selectionId ?? null,
    },
    odds: { under: byRole.under, over: byRole.over },
    oddsFetchedAt: new Date().toISOString(),
  };
};

const betfairCorrectScorePlanHandler = async (c: any) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  try {
    const body = await c.req.json().catch(() => ({}));
    const matchId = String(body?.matchId ?? "").trim() || null;
    const maxRaw = Number(body?.max ?? 6);
    const max = Number.isFinite(maxRaw) ? Math.max(1, Math.min(30, Math.floor(maxRaw))) : 6;
    const persist = Boolean(body?.persist ?? true);
    const overrides = (body?.config && typeof body.config === "object") ? body.config : {};

    const items = await kv.getByPrefix(BETFAIR_QUEUE_PREFIX);
    const list = Array.isArray(items) ? items : [];
    const filtered = matchId ? list.filter((x: any) => String(x?.matchId ?? "") === matchId) : list.slice(0, max);

    const plans: any[] = [];
    const updates: Array<{ matchId: string; patch: any }> = [];

    for (const x of filtered) {
      const plan = planCorrectScoreForQueueItem(x, overrides);
      plans.push({ matchId: String(x?.matchId ?? ""), plan });
      if (persist) {
        updates.push({
          matchId: String(x?.matchId ?? ""),
          patch: { strategy: { ...(x?.strategy ?? {}), correctScore: { ...(x?.strategy?.correctScore ?? {}), lastPlan: plan, lastPlannedAt: new Date().toISOString() } } },
        });
      }
    }

    if (persist && updates.length > 0) {
      const byId = new Map<string, any>();
      for (const u of updates) byId.set(u.matchId, u.patch);
      const matchIds = Array.from(byId.keys());
      const keys = matchIds.map((id) => `${BETFAIR_QUEUE_PREFIX}${id}`);
      const existing = await kv.mget(keys);
      const nowIso = new Date().toISOString();
      const nextValues = existing.map((cur, i) => {
        const base = (cur && typeof cur === "object") ? cur : {};
        const patch = byId.get(matchIds[i]) ?? {};
        return { ...base, ...patch, updatedAt: nowIso };
      });
      await kv.mset(keys, nextValues);
    }

    return c.json({ ok: true, plans });
  } catch (error) {
    return c.json({ ok: false, error: error.message || "Erro ao planejar Correct Score" }, 500);
  }
};

const betfairCorrectScoreExecuteHandler = async (c: any) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  const adminError = requireAutomationAdmin(c);
  if (adminError) return adminError;
  try {
    const body = await c.req.json().catch(() => ({}));
    const matchId = String(body?.matchId ?? "").trim();
    if (!matchId) return c.json({ ok: false, error: "matchId obrigatório" }, 400);
    const dryRun = Boolean(body?.dryRun ?? true);
    const overrides = (body?.config && typeof body.config === "object") ? body.config : {};

    const key = `${BETFAIR_QUEUE_PREFIX}${matchId}`;
    const item = (await kv.get(key)) ?? null;
    if (!item) return c.json({ ok: false, error: "Item não encontrado na fila" }, 404);

    const plannedFromState = (item?.strategy?.correctScore?.lastPlan && typeof item.strategy.correctScore.lastPlan === "object")
      ? item.strategy.correctScore.lastPlan
      : null;
    const plannedAt = String(plannedFromState?.createdAt ?? item?.strategy?.correctScore?.lastPlannedAt ?? "").trim();
    const plannedAgeSec = plannedAt ? (Date.now() - new Date(plannedAt).getTime()) / 1000 : null;
    const stateMarketId = String(item?.betfair?.correctScore?.marketId ?? "").trim();
    const planFromStateOk =
      plannedFromState &&
      String(plannedFromState?.mode ?? "").trim() !== "skip" &&
      String(plannedFromState?.marketId ?? "").trim() === stateMarketId &&
      Array.isArray(plannedFromState?.instructions) &&
      plannedFromState.instructions.length > 0 &&
      (plannedAgeSec == null ? false : (Number.isFinite(plannedAgeSec) && plannedAgeSec >= 0 && plannedAgeSec <= 180));

    const plan = planFromStateOk ? plannedFromState : planCorrectScoreForQueueItem(item, overrides);
    if (!plan.marketId) return c.json({ ok: false, error: plan.reason ?? "Sem marketId" }, 400);
    if (plan.isFinished) return c.json({ ok: false, error: "Jogo já finalizado (Betfair)" }, 400);

    const scoreHome = Number(item?.scoreHome);
    const scoreAway = Number(item?.scoreAway);
    const totalGoals =
      Number.isFinite(scoreHome) && Number.isFinite(scoreAway) ? Math.max(0, Math.floor(scoreHome) + Math.floor(scoreAway)) : null;

    const sessionToken = await getBetfairSessionToken();
    const listExisting = await betfairJsonRpcTrading({
      method: "SportsAPING/v1.0/listCurrentOrders",
      params: { marketIds: [String(plan.marketId)] },
      sessionToken,
    });
    const existingOrders = Array.isArray(listExisting?.currentOrders) ? listExisting.currentOrders : [];
    const openOrdersCount = existingOrders.filter((o: any) => Number(o?.sizeRemaining ?? 0) > 0).length;
    const matchedBetsCount = existingOrders.filter((o: any) => Number(o?.sizeMatched ?? 0) > 0).length;
    const hasExistingPosition = openOrdersCount > 0 || matchedBetsCount > 0;

    if (hasExistingPosition) {
      if (dryRun) {
        return c.json({
          ok: true,
          dryRun: true,
          plan,
          placed: false,
          adoptedExisting: true,
          openOrdersCount,
          matchedBetsCount,
          reason: "Já existem ordens/execuções no mercado (posição manual detectada)",
        });
      }

      const nextStrategy = {
        ...(item?.strategy ?? {}),
        correctScore: {
          ...(item?.strategy?.correctScore ?? {}),
          lastPlan: plan,
          lastPlannedAt: plan.createdAt,
          lastExecutionAt: new Date().toISOString(),
          lastExecution: { adoptedExisting: true, openOrdersCount, matchedBetsCount },
          adoptedExistingAt: new Date().toISOString(),
          adoptedExisting: { openOrdersCount, matchedBetsCount, marketId: plan.marketId },
          lastGoals: totalGoals,
        },
      };
      await kv.set(key, { ...item, strategy: nextStrategy, updatedAt: new Date().toISOString() });

      return c.json({
        ok: true,
        dryRun: false,
        plan,
        placed: false,
        adoptedExisting: true,
        openOrdersCount,
        matchedBetsCount,
        reason: "Já existem ordens/execuções no mercado (posição manual detectada)",
      });
    }

    const instructions = Array.isArray(plan.instructions) ? plan.instructions : [];
    if (instructions.length === 0) return c.json({ ok: true, dryRun, plan, placed: false, reason: plan.reason ?? "Sem instruções" });

    if (dryRun) return c.json({ ok: true, dryRun: true, plan, placed: false });

    const result = await betfairJsonRpcTrading({
      method: "SportsAPING/v1.0/placeOrders",
      params: {
        marketId: String(plan.marketId),
        instructions,
        customerRef: `CS_${matchId}_${Date.now()}`.slice(0, 32),
        async: false,
      },
      sessionToken,
    });

    const nextStrategy = {
      ...(item?.strategy ?? {}),
      correctScore: {
        ...(item?.strategy?.correctScore ?? {}),
        lastPlan: plan,
        lastPlannedAt: plan.createdAt,
        lastExecutionAt: new Date().toISOString(),
        lastExecution: result,
        lastGoals: totalGoals,
      },
    };
    await kv.set(key, { ...item, strategy: nextStrategy, updatedAt: new Date().toISOString() });

    return c.json({ ok: true, dryRun: false, plan, placed: true, result });
  } catch (error) {
    return c.json({ ok: false, error: error.message || "Erro ao executar Correct Score" }, 500);
  }
};

const betfairCorrectScoreRebalanceHandler = async (c: any) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  const adminError = requireAutomationAdmin(c);
  if (adminError) return adminError;
  try {
    const body = await c.req.json().catch(() => ({}));
    const matchId = String(body?.matchId ?? "").trim();
    if (!matchId) return c.json({ ok: false, error: "matchId obrigatório" }, 400);

    const cfg = (body?.config && typeof body.config === "object") ? body.config : {};
    const dryRun = Boolean(body?.dryRun ?? false);
    const force = Boolean(cfg?.force ?? false);
    const cancelOpenOrders = Boolean(cfg?.cancelOpenOrders ?? true);
    const targetMinGreenAbsRaw = Number(cfg?.targetMinGreenAbs ?? 0);
    const targetMinGreenAbs = Number.isFinite(targetMinGreenAbsRaw) ? round2(clamp(targetMinGreenAbsRaw, -5000, 5000)) : 0;
    const maxInstructionsRaw = Number(cfg?.maxInstructions ?? 3);
    const maxInstructions = Number.isFinite(maxInstructionsRaw) ? clamp(Math.floor(maxInstructionsRaw), 0, 10) : 3;
    const maxStakePerInstructionRaw = Number(cfg?.maxStakePerInstruction ?? 50);
    const maxStakePerInstruction = Number.isFinite(maxStakePerInstructionRaw) ? round2(clamp(maxStakePerInstructionRaw, 2, 2000)) : 50;

    const key = `${BETFAIR_QUEUE_PREFIX}${matchId}`;
    const item = (await kv.get(key)) ?? null;
    if (!item) return c.json({ ok: false, error: "Item não encontrado na fila" }, 404);

    const marketId = String(item?.betfair?.correctScore?.marketId ?? "").trim();
    if (!marketId) return c.json({ ok: true, matchId, marketId: null, skipped: true, reason: "Sem mercado Correct Score" });

    const marketStatus = String(item?.betfair?.marketStatus ?? "").toUpperCase();
    if (marketStatus === "CLOSED") {
      return c.json({ ok: true, matchId, marketId, skipped: true, reason: "Mercado já está CLOSED" });
    }

    const scoreHome = Number(item?.scoreHome);
    const scoreAway = Number(item?.scoreAway);
    const totalGoals =
      Number.isFinite(scoreHome) && Number.isFinite(scoreAway) ? Math.max(0, Math.floor(scoreHome) + Math.floor(scoreAway)) : null;
    const prevGoalsRaw = Number(item?.strategy?.correctScore?.lastGoals);
    const prevGoals = Number.isFinite(prevGoalsRaw) ? prevGoalsRaw : null;
    const goalChanged = totalGoals != null && (prevGoals == null || totalGoals !== prevGoals);
    if (!force && !goalChanged) {
      return c.json({ ok: true, matchId, marketId, skipped: true, reason: "Sem mudança de gol (rebalance não necessário)", totalGoals, prevGoals });
    }

    const sessionToken = await getBetfairSessionToken();
    const listOrders = await betfairJsonRpcTrading({
      method: "SportsAPING/v1.0/listCurrentOrders",
      params: { marketIds: [marketId] },
      sessionToken,
    });
    const currentOrders = Array.isArray(listOrders?.currentOrders) ? listOrders.currentOrders : [];
    const openBetIds = currentOrders
      .filter((o: any) => Number(o?.sizeRemaining ?? 0) > 0 && String(o?.betId ?? "").trim())
      .map((o: any) => String(o.betId));
    const matchedCount = currentOrders.filter((o: any) => Number(o?.sizeMatched ?? 0) > 0).length;
    const hasMatched = matchedCount > 0;

    let cancelResult: any = null;
    if (cancelOpenOrders && openBetIds.length > 0) {
      cancelResult = await betfairJsonRpcTrading({
        method: "SportsAPING/v1.0/cancelOrders",
        params: { marketId, instructions: openBetIds.map((betId: string) => ({ betId })) },
        sessionToken,
      });
    }

    if (!hasMatched) {
      const nextStrategy = {
        ...(item?.strategy ?? {}),
        correctScore: {
          ...(item?.strategy?.correctScore ?? {}),
          lastGoals: totalGoals,
          lastRebalanceAt: new Date().toISOString(),
          lastRebalance: {
            ok: true,
            skipped: true,
            reason: "Sem posição executada (nada para redistribuir)",
            openOrdersCancelled: openBetIds.length,
            cancelResult,
          },
        },
      };
      await kv.set(key, { ...item, strategy: nextStrategy, updatedAt: new Date().toISOString() });
      return c.json({ ok: true, matchId, marketId, skipped: true, reason: "Sem posição executada", cancelledOpenOrdersCount: openBetIds.length });
    }

    const pnlRes = await betfairJsonRpcTrading({
      method: "SportsAPING/v1.0/listMarketProfitAndLoss",
      params: { marketIds: [marketId], includeSettledBets: false, includeBspBets: false, netOfCommission: true },
      sessionToken,
    });
    const marketPnl = Array.isArray(pnlRes) ? pnlRes[0] : null;
    const pnlList = Array.isArray(marketPnl?.profitAndLosses)
      ? marketPnl.profitAndLosses
      : Array.isArray(marketPnl?.profitAndLoss)
        ? marketPnl.profitAndLoss
        : [];

    const ifWinBySel = new Map<number, number>();
    for (const p of pnlList) {
      const sid = Number(p?.selectionId);
      const ifWin = Number(p?.ifWin);
      if (!Number.isFinite(sid) || sid <= 0) continue;
      ifWinBySel.set(sid, Number.isFinite(ifWin) ? round2(ifWin) : 0);
    }

    const valuesBefore = Array.from(ifWinBySel.values());
    const minBefore = valuesBefore.length ? valuesBefore.reduce((m: number, v: number) => (v < m ? v : m), valuesBefore[0]) : null;
    const maxBefore = valuesBefore.length ? valuesBefore.reduce((m: number, v: number) => (v > m ? v : m), valuesBefore[0]) : null;

    const bookRes = await betfairJsonRpc({
      method: "SportsAPING/v1.0/listMarketBook",
      params: {
        marketIds: [marketId],
        priceProjection: { priceData: ["EX_BEST_OFFERS"], virtualise: true },
      },
      sessionToken,
    });
    const book = Array.isArray(bookRes) ? bookRes[0] : null;
    const runnersBook = Array.isArray(book?.runners) ? book.runners : [];
    const layBySel = new Map<number, { price: number; size: number | null }>();
    for (const rb of runnersBook) {
      const sid = Number(rb?.selectionId);
      if (!Number.isFinite(sid) || sid <= 0) continue;
      const lay0 = Array.isArray(rb?.ex?.availableToLay) ? rb.ex.availableToLay[0] : null;
      const price = lay0 ? Number(lay0.price) : null;
      const size = lay0 ? Number(lay0.size) : null;
      if (price && Number.isFinite(price) && price > 1.01) {
        layBySel.set(sid, { price, size: Number.isFinite(size) ? size : null });
      }
    }

    const minStake = 2;
    const instructions: any[] = [];
    const getMin = () => {
      const vals = Array.from(ifWinBySel.values());
      return vals.length ? vals.reduce((m: number, v: number) => (v < m ? v : m), vals[0]) : null;
    };

    while (instructions.length < maxInstructions) {
      const minIfWin = getMin();
      if (!(typeof minIfWin === "number" && Number.isFinite(minIfWin))) break;
      if (minIfWin >= targetMinGreenAbs) break;
      const need = targetMinGreenAbs - minIfWin;

      const candidates = Array.from(ifWinBySel.entries())
        .map(([sid, ifWin]) => {
          const lay = layBySel.get(sid) ?? null;
          if (!lay) return null;
          const p = lay.price;
          const denom = p - 1;
          if (!(Number.isFinite(p) && p > 1.01 && Number.isFinite(denom) && denom > 0)) return null;
          const upper = (ifWin - targetMinGreenAbs) / denom;
          const sizeCap = lay.size != null && Number.isFinite(lay.size) ? lay.size : null;
          const maxByLiquidity = sizeCap != null ? Math.max(0, sizeCap) : null;
          const maxSize = Math.min(maxStakePerInstruction, maxByLiquidity != null ? maxByLiquidity : maxStakePerInstruction);
          return { sid, ifWin, p, upper: Number.isFinite(upper) ? upper : 0, maxSize };
        })
        .filter((x: any) => x && x.upper >= minStake && x.maxSize >= minStake && x.ifWin > targetMinGreenAbs + 1);

      if (candidates.length === 0) break;
      candidates.sort((a: any, b: any) => b.upper - a.upper);
      const best = candidates[0];
      const sNeed = Math.max(minStake, round2(need));
      const sUpper = round2(Math.min(best.upper, best.maxSize));
      if (sNeed > sUpper) break;
      const size = round2(clamp(sNeed, minStake, sUpper));
      const price = best.p;

      instructions.push({
        selectionId: best.sid,
        side: "LAY",
        orderType: "LIMIT",
        limitOrder: { size, price, persistenceType: "LAPSE" },
      });

      const liability = round2(size * (price - 1));
      for (const [sid, ifWin] of ifWinBySel.entries()) {
        if (sid === best.sid) ifWinBySel.set(sid, round2(ifWin - liability));
        else ifWinBySel.set(sid, round2(ifWin + size));
      }
    }

    const valuesAfter = Array.from(ifWinBySel.values());
    const minAfter = valuesAfter.length ? valuesAfter.reduce((m: number, v: number) => (v < m ? v : m), valuesAfter[0]) : null;
    const maxAfter = valuesAfter.length ? valuesAfter.reduce((m: number, v: number) => (v > m ? v : m), valuesAfter[0]) : null;

    if (instructions.length === 0) {
      const nextStrategy = {
        ...(item?.strategy ?? {}),
        correctScore: {
          ...(item?.strategy?.correctScore ?? {}),
          lastGoals: totalGoals,
          lastRebalanceAt: new Date().toISOString(),
          lastRebalance: {
            ok: true,
            skipped: true,
            reason: "Sem instruções viáveis para redistribuir",
            minBefore,
            minAfter: minBefore,
            maxBefore,
            maxAfter: maxBefore,
            targetMinGreenAbs,
            cancelledOpenOrdersCount: openBetIds.length,
            cancelResult,
          },
        },
      };
      await kv.set(key, { ...item, strategy: nextStrategy, updatedAt: new Date().toISOString() });
      return c.json({ ok: true, matchId, marketId, skipped: true, reason: "Sem instruções viáveis", minBefore, minAfter: minBefore });
    }

    if (dryRun) {
      return c.json({ ok: true, matchId, marketId, dryRun: true, instructions, minBefore, minAfter, maxBefore, maxAfter, targetMinGreenAbs });
    }

    const placeResult = await betfairJsonRpcTrading({
      method: "SportsAPING/v1.0/placeOrders",
      params: { marketId, instructions, customerRef: `CS_REB_${matchId}_${Date.now()}`.slice(0, 32), async: false },
      sessionToken,
    });

    const nextStrategy = {
      ...(item?.strategy ?? {}),
      correctScore: {
        ...(item?.strategy?.correctScore ?? {}),
        lastGoals: totalGoals,
        lastRebalanceAt: new Date().toISOString(),
        lastRebalance: {
          ok: true,
          skipped: false,
          reason: null,
          instructions,
          placeResult,
          minBefore,
          minAfter,
          maxBefore,
          maxAfter,
          targetMinGreenAbs,
          cancelledOpenOrdersCount: openBetIds.length,
          cancelResult,
        },
      },
    };
    await kv.set(key, { ...item, strategy: nextStrategy, updatedAt: new Date().toISOString() });
    return c.json({ ok: true, matchId, marketId, dryRun: false, placed: true, instructionsCount: instructions.length, minBefore, minAfter, placeResult });
  } catch (error) {
    return c.json({ ok: false, error: error.message || "Erro ao rebalancear Correct Score" }, 500);
  }
};

const betfairCorrectScoreOpenOrdersSummaryHandler = async (c: any) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  const adminError = requireAutomationAdmin(c);
  if (adminError) return adminError;
  try {
    const body = await c.req.json().catch(() => ({}));
    const matchId = String(body?.matchId ?? "").trim();
    if (!matchId) return c.json({ ok: false, error: "matchId obrigatório" }, 400);

    const key = `${BETFAIR_QUEUE_PREFIX}${matchId}`;
    const item = (await kv.get(key)) ?? null;
    if (!item) return c.json({ ok: false, error: "Item não encontrado na fila" }, 404);

    const marketId = String(item?.betfair?.correctScore?.marketId ?? "").trim();
    if (!marketId) {
      return c.json({
        ok: true,
        matchId,
        marketId: null,
        hasOpenOrders: false,
        hasMatchedBets: false,
        openOrdersCount: 0,
        matchedBetsCount: 0,
        orders: [],
      });
    }

    const sessionToken = await getBetfairSessionToken();
    const result = await betfairJsonRpcTrading({
      method: "SportsAPING/v1.0/listCurrentOrders",
      params: { marketIds: [marketId] },
      sessionToken,
    });

    const ordersRaw = Array.isArray(result?.currentOrders) ? result.currentOrders : [];
    const orders = ordersRaw.map((o: any) => {
      const betId = String(o?.betId ?? "").trim() || null;
      const selectionId = Number(o?.selectionId);
      const side = String(o?.side ?? "").trim() || null;
      const status = String(o?.status ?? "").trim() || null;
      const priceSize = o?.priceSize ?? null;
      const price = Number(priceSize?.price);
      const size = Number(priceSize?.size);
      const sizeMatched = Number(o?.sizeMatched);
      const sizeRemaining = Number(o?.sizeRemaining);
      const averagePriceMatched = Number(o?.averagePriceMatched);
      return {
        betId,
        selectionId: Number.isFinite(selectionId) ? selectionId : null,
        side,
        status,
        price: Number.isFinite(price) ? price : null,
        size: Number.isFinite(size) ? size : null,
        sizeMatched: Number.isFinite(sizeMatched) ? sizeMatched : null,
        sizeRemaining: Number.isFinite(sizeRemaining) ? sizeRemaining : null,
        averagePriceMatched: Number.isFinite(averagePriceMatched) ? averagePriceMatched : null,
      };
    });

    const openOrdersCount = orders.filter((o: any) => Number(o?.sizeRemaining ?? 0) > 0).length;
    const matchedBetsCount = orders.filter((o: any) => Number(o?.sizeMatched ?? 0) > 0).length;
    const hasOpenOrders = openOrdersCount > 0;
    const hasMatchedBets = matchedBetsCount > 0;
    return c.json({ ok: true, matchId, marketId, hasOpenOrders, hasMatchedBets, openOrdersCount, matchedBetsCount, orders });
  } catch (error) {
    return c.json({ ok: false, error: error.message || "Erro ao buscar ordens abertas" }, 500);
  }
};

const betfairCorrectScoreCancelOpenOrdersHandler = async (c: any) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  const adminError = requireAutomationAdmin(c);
  if (adminError) return adminError;
  try {
    const body = await c.req.json().catch(() => ({}));
    const matchId = String(body?.matchId ?? "").trim();
    if (!matchId) return c.json({ ok: false, error: "matchId obrigatório" }, 400);

    const key = `${BETFAIR_QUEUE_PREFIX}${matchId}`;
    const item = (await kv.get(key)) ?? null;
    if (!item) return c.json({ ok: false, error: "Item não encontrado na fila" }, 404);

    const marketId = String(item?.betfair?.correctScore?.marketId ?? "").trim();
    if (!marketId) return c.json({ ok: true, matchId, marketId: null, cancelled: false, cancelledCount: 0, message: "Sem mercado Correct Score" });

    const marketStatus = String(item?.betfair?.marketStatus ?? "").toUpperCase();
    if (marketStatus === "CLOSED") {
      return c.json({ ok: true, matchId, marketId, cancelled: false, cancelledCount: 0, message: "Mercado já está CLOSED" });
    }

    const sessionToken = await getBetfairSessionToken();
    const listResult = await betfairJsonRpcTrading({
      method: "SportsAPING/v1.0/listCurrentOrders",
      params: { marketIds: [marketId] },
      sessionToken,
    });

    const currentOrders = Array.isArray(listResult?.currentOrders) ? listResult.currentOrders : [];
    const toCancel = currentOrders
      .filter((o: any) => Number(o?.sizeRemaining ?? 0) > 0 && String(o?.betId ?? "").trim())
      .map((o: any) => String(o.betId));

    let cancelResult: any = null;
    if (toCancel.length > 0) {
      cancelResult = await betfairJsonRpcTrading({
        method: "SportsAPING/v1.0/cancelOrders",
        params: { marketId, instructions: toCancel.map((betId: string) => ({ betId })) },
        sessionToken,
      });
    }

    const nextStrategy = {
      ...(item?.strategy ?? {}),
      correctScore: {
        ...(item?.strategy?.correctScore ?? {}),
        lastCancelAt: new Date().toISOString(),
        lastCancel: { cancelResult, cancelledBetIdsCount: toCancel.length },
      },
    };
    await kv.set(key, { ...item, strategy: nextStrategy, updatedAt: new Date().toISOString() });

    return c.json({ ok: true, matchId, marketId, cancelled: toCancel.length > 0, cancelledCount: toCancel.length, cancelResult });
  } catch (error) {
    return c.json({ ok: false, error: error.message || "Erro ao cancelar ordens" }, 500);
  }
};

const betfairCorrectScoreTradePreviewHandler = async (c: any) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  const adminError = requireAutomationAdmin(c);
  if (adminError) return adminError;
  try {
    const body = await c.req.json().catch(() => ({}));
    const matchId = String(body?.matchId ?? "").trim();
    if (!matchId) return c.json({ ok: false, error: "matchId obrigatório" }, 400);

    const key = `${BETFAIR_QUEUE_PREFIX}${matchId}`;
    const item = (await kv.get(key)) ?? null;
    if (!item) return c.json({ ok: false, error: "Item não encontrado na fila" }, 404);

    const marketId = String(item?.betfair?.correctScore?.marketId ?? "").trim();
    if (!marketId) {
      return c.json({ ok: true, matchId, marketId: null, risk: null, cashOut: null, profit: null, fetchedAt: new Date().toISOString() });
    }

    const sessionToken = await getBetfairSessionToken();
    const listOrders = await betfairJsonRpcTrading({
      method: "SportsAPING/v1.0/listCurrentOrders",
      params: { marketIds: [marketId] },
      sessionToken,
    });

    const currentOrders = Array.isArray(listOrders?.currentOrders) ? listOrders.currentOrders : [];
    const risk = currentOrders.reduce((acc: number, o: any) => {
      const side = String(o?.side ?? "").trim().toUpperCase();
      const price = Number(o?.priceSize?.price);
      const sizeRemaining = Number(o?.sizeRemaining);
      const sizeMatched = Number(o?.sizeMatched);
      const size = (Number.isFinite(sizeRemaining) ? sizeRemaining : 0) + (Number.isFinite(sizeMatched) ? sizeMatched : 0);
      if (!Number.isFinite(size) || size <= 0) return acc;
      if (side === "LAY") {
        if (!Number.isFinite(price) || price <= 1.01) return acc;
        return acc + size * (price - 1);
      }
      return acc + size;
    }, 0);

    const pnlRes = await betfairJsonRpcTrading({
      method: "SportsAPING/v1.0/listMarketProfitAndLoss",
      params: { marketIds: [marketId], includeSettledBets: false, includeBspBets: false, netOfCommission: true },
      sessionToken,
    });
    const marketPnl = Array.isArray(pnlRes) ? pnlRes[0] : null;
    const pnlList = Array.isArray(marketPnl?.profitAndLosses)
      ? marketPnl.profitAndLosses
      : Array.isArray(marketPnl?.profitAndLoss)
        ? marketPnl.profitAndLoss
        : [];
    const values = pnlList.map((x: any) => Number(x?.ifWin)).filter((v: any) => typeof v === "number" && Number.isFinite(v));
    const profit = values.length > 0 ? values.reduce((m: number, v: number) => (v < m ? v : m), values[0]) : null;
    const cashOut = typeof profit === "number" && Number.isFinite(profit) && Number.isFinite(risk) ? risk + profit : null;

    return c.json({
      ok: true,
      matchId,
      marketId,
      risk: Number.isFinite(risk) ? round2(risk) : null,
      cashOut: typeof cashOut === "number" && Number.isFinite(cashOut) ? round2(cashOut) : null,
      profit: typeof profit === "number" && Number.isFinite(profit) ? round2(profit) : null,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    return c.json({ ok: false, error: error.message || "Erro ao calcular prévia do trade" }, 500);
  }
};

const betfairCorrectScoreCashoutHandler = async (c: any) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  const adminError = requireAutomationAdmin(c);
  if (adminError) return adminError;
  try {
    const body = await c.req.json().catch(() => ({}));
    const matchId = String(body?.matchId ?? "").trim();
    if (!matchId) return c.json({ ok: false, error: "matchId obrigatório" }, 400);

    const key = `${BETFAIR_QUEUE_PREFIX}${matchId}`;
    const item = (await kv.get(key)) ?? null;
    if (!item) return c.json({ ok: false, error: "Item não encontrado na fila" }, 404);

    const marketId = String(item?.betfair?.correctScore?.marketId ?? "").trim();
    if (!marketId) return c.json({ ok: true, matchId, marketId: null, cancelled: false, hedged: false, message: "Sem mercado Correct Score" });

    const marketStatus = String(item?.betfair?.marketStatus ?? "").toUpperCase();
    if (marketStatus === "CLOSED") {
      return c.json({ ok: true, matchId, marketId, cancelled: false, hedged: false, message: "Mercado já está CLOSED" });
    }

    const sessionToken = await getBetfairSessionToken();
    const listResult = await betfairJsonRpcTrading({
      method: "SportsAPING/v1.0/listCurrentOrders",
      params: { marketIds: [marketId] },
      sessionToken,
    });

    const currentOrders = Array.isArray(listResult?.currentOrders) ? listResult.currentOrders : [];
    const toCancel = currentOrders
      .filter((o: any) => Number(o?.sizeRemaining ?? 0) > 0 && String(o?.betId ?? "").trim())
      .map((o: any) => String(o.betId));

    let cancelResult: any = null;
    if (toCancel.length > 0) {
      cancelResult = await betfairJsonRpcTrading({
        method: "SportsAPING/v1.0/cancelOrders",
        params: { marketId, instructions: toCancel.map((betId: string) => ({ betId })) },
        sessionToken,
      });
    }

    const book = await betfairJsonRpc({
      method: "SportsAPING/v1.0/listMarketBook",
      params: {
        marketIds: [marketId],
        priceProjection: { priceData: ["EX_BEST_OFFERS"], virtualise: true },
      },
      sessionToken,
    });
    const book0 = Array.isArray(book) ? book[0] : book;
    const runners = Array.isArray(book0?.runners) ? book0.runners : [];
    const bySelection = new Map<number, any>();
    for (const r of runners) {
      const sid = Number(r?.selectionId);
      if (!Number.isFinite(sid)) continue;
      const ex = r?.ex ?? {};
      const back0 = Array.isArray(ex?.availableToBack) ? ex.availableToBack[0] : null;
      const lay0 = Array.isArray(ex?.availableToLay) ? ex.availableToLay[0] : null;
      bySelection.set(sid, {
        bestBack: back0 ? Number(back0.price) : null,
        bestLay: lay0 ? Number(lay0.price) : null,
      });
    }

    const hedgeInstructions: any[] = [];
    for (const o of currentOrders) {
      const sizeMatched = Number(o?.sizeMatched ?? 0);
      if (!Number.isFinite(sizeMatched) || sizeMatched <= 0) continue;
      const selectionId = Number(o?.selectionId);
      if (!Number.isFinite(selectionId)) continue;
      const side = String(o?.side ?? "").toUpperCase();
      const px = bySelection.get(selectionId) ?? {};
      if (side === "BACK") {
        const layPrice = Number(px?.bestLay);
        if (!Number.isFinite(layPrice) || layPrice <= 1.01) continue;
        hedgeInstructions.push({
          selectionId,
          side: "LAY",
          orderType: "LIMIT",
          limitOrder: { size: round2(sizeMatched), price: layPrice, persistenceType: "LAPSE" },
        });
      } else if (side === "LAY") {
        const backPrice = Number(px?.bestBack);
        if (!Number.isFinite(backPrice) || backPrice <= 1.01) continue;
        hedgeInstructions.push({
          selectionId,
          side: "BACK",
          orderType: "LIMIT",
          limitOrder: { size: round2(sizeMatched), price: backPrice, persistenceType: "LAPSE" },
        });
      }
    }

    let hedgeResult: any = null;
    if (hedgeInstructions.length > 0) {
      hedgeResult = await betfairJsonRpcTrading({
        method: "SportsAPING/v1.0/placeOrders",
        params: {
          marketId,
          instructions: hedgeInstructions.slice(0, 50),
          customerRef: `CS_CASH_${matchId}_${Date.now()}`.slice(0, 32),
          async: false,
        },
        sessionToken,
      });
    }

    const nextStrategy = {
      ...(item?.strategy ?? {}),
      correctScore: {
        ...(item?.strategy?.correctScore ?? {}),
        lastCashoutAt: new Date().toISOString(),
        lastCashout: { cancelResult, hedgeResult, hedgeInstructionsCount: hedgeInstructions.length, cancelledBetIdsCount: toCancel.length },
      },
    };
    await kv.set(key, { ...item, strategy: nextStrategy, updatedAt: new Date().toISOString() });

    return c.json({
      ok: true,
      matchId,
      marketId,
      cancelled: toCancel.length > 0,
      hedged: hedgeInstructions.length > 0,
      cancelledCount: toCancel.length,
      hedgedCount: hedgeInstructions.length,
      cancelResult,
      hedgeResult,
    });
  } catch (error) {
    return c.json({ ok: false, error: error.message || "Erro ao fazer cashout" }, 500);
  }
};

const betfairScalpingGoalsTickHandler = async (c: any) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  const adminError = requireAutomationAdmin(c);
  if (adminError) return adminError;
  try {
    const body = await c.req.json().catch(() => ({}));
    const matchId = String(body?.matchId ?? "").trim();
    if (!matchId) return c.json({ ok: false, error: "matchId obrigatório" }, 400);

    const cfg = (body?.config && typeof body.config === "object") ? body.config : {};
    const bankrollRaw = Number(cfg?.bankroll ?? 50);
    const bankroll = Number.isFinite(bankrollRaw) ? clamp(bankrollRaw, 2, 10_000) : 50;
    const profitTargetPctRaw = Number(cfg?.profitTargetPct ?? 0.1);
    const profitTargetPct = Number.isFinite(profitTargetPctRaw) ? clamp(profitTargetPctRaw, 0.01, 0.5) : 0.1;
    const stakePctRaw = Number(cfg?.stakePct ?? 1);
    const stakePct = Number.isFinite(stakePctRaw) ? clamp(stakePctRaw, 0.01, 1) : 1;
    const stakeAbsRaw = Number(cfg?.stakeAbs);
    const stakeAbs = Number.isFinite(stakeAbsRaw) ? round2(stakeAbsRaw) : NaN;
    const stakeBankroll = Number.isFinite(stakeAbs) && stakeAbs > 0 ? round2(clamp(stakeAbs, 2, bankroll)) : round2(clamp(bankroll * stakePct, 2, bankroll));
    const entryOffsetTicksRaw = Number(cfg?.entryOffsetTicks ?? 2);
    const entryOffsetTicks = Number.isFinite(entryOffsetTicksRaw) ? clamp(Math.trunc(entryOffsetTicksRaw), -10, 10) : 2;
    const secondsToWaitMatchRaw = Number(cfg?.secondsToWaitMatch ?? 10);
    const secondsToWaitMatch = Number.isFinite(secondsToWaitMatchRaw) ? clamp(Math.floor(secondsToWaitMatchRaw), 1, 120) : 10;

    const stepsForPrice = (p: number) => {
      if (p < 2) return 0.01;
      if (p < 3) return 0.02;
      if (p < 4) return 0.05;
      if (p < 6) return 0.1;
      if (p < 10) return 0.2;
      if (p < 20) return 0.5;
      if (p < 30) return 1;
      if (p < 50) return 2;
      if (p < 100) return 5;
      return 10;
    };
    const roundPrice = (p: number) => round2(p);
    const tickUpOnce = (p: number) => roundPrice(p + stepsForPrice(p));
    const tickDownOnce = (p: number) => {
      const s = stepsForPrice(p);
      const next = p - s;
      return roundPrice(next < 1.01 ? 1.01 : next);
    };
    const tickUp = (p: number, n: number) => {
      let v = p;
      for (let i = 0; i < n; i += 1) v = tickUpOnce(v);
      return v;
    };
    const tickDown = (p: number, n: number) => {
      let v = p;
      for (let i = 0; i < n; i += 1) v = tickDownOnce(v);
      return v;
    };
    const applyOffsetTicks = (p: number, ticks: number) => {
      if (!Number.isFinite(p) || p <= 1.01) return null;
      if (!Number.isFinite(ticks) || ticks === 0) return roundPrice(p);
      const t = Math.trunc(ticks);
      return t > 0 ? tickUp(p, t) : tickDown(p, Math.abs(t));
    };

    const key = `${BETFAIR_QUEUE_PREFIX}${matchId}`;
    const item = (await kv.get(key)) ?? null;
    if (!item) return c.json({ ok: false, error: "Item não encontrado na fila" }, 404);

    const agentRaw = String(item?.strategy?.agent ?? "").trim().toLowerCase();
    const agent = agentRaw === "scalpinggoals" || agentRaw === "scalping_goals" ? "scalpingGoals" : "correctScore";
    if (agent !== "scalpingGoals") return c.json({ ok: false, error: "Robô não é Scalping Gol Acima" }, 400);

    const betfair = item?.betfair ?? null;
    let eventId = String(betfair?.eventId ?? "").trim();
    if (!eventId && String(item?.homeTeam ?? "").trim() && String(item?.awayTeam ?? "").trim()) {
      try {
        const mapped = await resolveBetfairMatchOdds({
          homeTeam: String(item.homeTeam),
          awayTeam: String(item.awayTeam),
          utcDate: item?.utcDate,
        });
        eventId = String(mapped?.eventId ?? "").trim();
        item.betfair = { ...(item?.betfair ?? {}), ...mapped };
      } catch {}
    }
    if (!eventId) return c.json({ ok: false, error: "Betfair: eventId não resolvido" }, 400);

    const scoreHome = Number.isFinite(Number(item?.scoreHome)) ? Number(item.scoreHome) : 0;
    const scoreAway = Number.isFinite(Number(item?.scoreAway)) ? Number(item.scoreAway) : 0;
    const totalGoals = Math.max(0, Math.floor(scoreHome)) + Math.max(0, Math.floor(scoreAway));

    const ouPrev = (item?.betfair?.overUnder && typeof item.betfair.overUnder === "object") ? item.betfair.overUnder : {};
    let ou15 = ouPrev?.["1.5"] ?? null;
    let ou25 = ouPrev?.["2.5"] ?? null;
    let ou35 = ouPrev?.["3.5"] ?? null;

    try {
      if (!ou15?.marketId) ou15 = await resolveBetfairOverUnderMarket({ eventId, line: 1.5 });
    } catch {}
    try {
      if (!ou25?.marketId) ou25 = await resolveBetfairOverUnderMarket({ eventId, line: 2.5 });
    } catch {}
    try {
      if (!ou35?.marketId) ou35 = await resolveBetfairOverUnderMarket({ eventId, line: 3.5 });
    } catch {}

    const markets = [ou15, ou25, ou35].filter((x: any) => x && String(x?.marketId ?? "").trim());
    if (markets.length === 0) return c.json({ ok: false, error: "Sem mercados Over/Under resolvidos" }, 400);

    const marketIds = markets.map((m: any) => String(m.marketId));
    const sessionToken = await getBetfairSessionToken();

    const listOrders = await betfairJsonRpcTrading({
      method: "SportsAPING/v1.0/listCurrentOrders",
      params: { marketIds },
      sessionToken,
    });
    const currentOrders = Array.isArray(listOrders?.currentOrders) ? listOrders.currentOrders : [];
    const openOrdersCount = currentOrders.filter((o: any) => Number(o?.sizeRemaining ?? 0) > 0).length;
    const matchedBetsCount = currentOrders.filter((o: any) => Number(o?.sizeMatched ?? 0) > 0).length;
    const hasExistingPosition = openOrdersCount > 0 || matchedBetsCount > 0;

    const calcRisk = (orders: any[]) => {
      return round2(
        orders.reduce((acc: number, o: any) => {
          const side = String(o?.side ?? "").trim().toUpperCase();
          const price = Number(o?.priceSize?.price);
          const sizeRemaining = Number(o?.sizeRemaining);
          const sizeMatched = Number(o?.sizeMatched);
          const size = (Number.isFinite(sizeRemaining) ? sizeRemaining : 0) + (Number.isFinite(sizeMatched) ? sizeMatched : 0);
          if (!Number.isFinite(size) || size <= 0) return acc;
          if (side === "LAY") {
            if (!Number.isFinite(price) || price <= 1.01) return acc;
            return acc + size * (price - 1);
          }
          return acc + size;
        }, 0),
      );
    };

    const calcWorstProfit = async (marketId: string) => {
      const pnlRes = await betfairJsonRpcTrading({
        method: "SportsAPING/v1.0/listMarketProfitAndLoss",
        params: { marketIds: [marketId], includeSettledBets: false, includeBspBets: false, netOfCommission: true },
        sessionToken,
      });
      const mk = Array.isArray(pnlRes) ? pnlRes[0] : null;
      const pnlList = Array.isArray(mk?.profitAndLosses)
        ? mk.profitAndLosses
        : Array.isArray(mk?.profitAndLoss)
          ? mk.profitAndLoss
          : [];
      const values = pnlList.map((x: any) => Number(x?.ifWin)).filter((v: any) => typeof v === "number" && Number.isFinite(v));
      return values.length > 0 ? round2(values.reduce((m: number, v: number) => (v < m ? v : m), values[0])) : null;
    };

    const cashoutMarket = async (marketId: string) => {
      const listRes = await betfairJsonRpcTrading({
        method: "SportsAPING/v1.0/listCurrentOrders",
        params: { marketIds: [marketId] },
        sessionToken,
      });
      const orders = Array.isArray(listRes?.currentOrders) ? listRes.currentOrders : [];
      const toCancel = orders.filter((o: any) => Number(o?.sizeRemaining ?? 0) > 0 && String(o?.betId ?? "").trim()).map((o: any) => String(o.betId));
      if (toCancel.length > 0) {
        await betfairJsonRpcTrading({
          method: "SportsAPING/v1.0/cancelOrders",
          params: { marketId, instructions: toCancel.map((betId: string) => ({ betId })) },
          sessionToken,
        });
      }

      const book = await betfairJsonRpc({
        method: "SportsAPING/v1.0/listMarketBook",
        params: { marketIds: [marketId], priceProjection: { priceData: ["EX_BEST_OFFERS"], virtualise: true } },
        sessionToken,
      });
      const book0 = Array.isArray(book) ? book[0] : book;
      const runners = Array.isArray(book0?.runners) ? book0.runners : [];
      const bySelection = new Map<number, any>();
      for (const r of runners) {
        const sid = Number(r?.selectionId);
        if (!Number.isFinite(sid)) continue;
        const ex = r?.ex ?? {};
        const back0 = Array.isArray(ex?.availableToBack) ? ex.availableToBack[0] : null;
        const lay0 = Array.isArray(ex?.availableToLay) ? ex.availableToLay[0] : null;
        bySelection.set(sid, {
          bestBack: back0 ? Number(back0.price) : null,
          bestLay: lay0 ? Number(lay0.price) : null,
        });
      }

      const hedgeInstructions: any[] = [];
      for (const o of orders) {
        const sizeMatched = Number(o?.sizeMatched ?? 0);
        if (!Number.isFinite(sizeMatched) || sizeMatched <= 0) continue;
        const selectionId = Number(o?.selectionId);
        if (!Number.isFinite(selectionId)) continue;
        const side = String(o?.side ?? "").toUpperCase();
        const px = bySelection.get(selectionId) ?? {};
        if (side === "BACK") {
          const layPrice = Number(px?.bestLay);
          if (!Number.isFinite(layPrice) || layPrice <= 1.01) continue;
          hedgeInstructions.push({ selectionId, side: "LAY", orderType: "LIMIT", limitOrder: { size: round2(sizeMatched), price: layPrice, persistenceType: "LAPSE" } });
        } else if (side === "LAY") {
          const backPrice = Number(px?.bestBack);
          if (!Number.isFinite(backPrice) || backPrice <= 1.01) continue;
          hedgeInstructions.push({ selectionId, side: "BACK", orderType: "LIMIT", limitOrder: { size: round2(sizeMatched), price: backPrice, persistenceType: "LAPSE" } });
        }
      }

      if (hedgeInstructions.length > 0) {
        await betfairJsonRpcTrading({
          method: "SportsAPING/v1.0/placeOrders",
          params: { marketId, instructions: hedgeInstructions.slice(0, 50), customerRef: `SG_CASH_${matchId}_${Date.now()}`.slice(0, 32), async: false },
          sessionToken,
        });
      }
      return { cancelledCount: toCancel.length, hedgedCount: hedgeInstructions.length };
    };

    const scalpingPrev = (item?.strategy?.scalpingGoals && typeof item.strategy.scalpingGoals === "object") ? item.strategy.scalpingGoals : {};
    const adoptedExistingAt = String(scalpingPrev?.adoptedExistingAt ?? "").trim() || null;
    let phase = String(scalpingPrev?.phase ?? "").trim() || "idle";

    const profitByMarket: any[] = [];
    let profitSum = 0;
    for (const m of markets) {
      const marketId = String(m.marketId);
      try {
        const p = await calcWorstProfit(marketId);
        profitByMarket.push({ marketId, line: m.line, profit: p });
        if (typeof p === "number" && Number.isFinite(p)) profitSum += p;
      } catch {
        profitByMarket.push({ marketId, line: m.line, profit: null });
      }
    }
    profitSum = round2(profitSum);
    const risk = calcRisk(currentOrders);
    const profitPct = risk > 0 ? round2(profitSum / risk) : null;

    if (hasExistingPosition && !adoptedExistingAt && phase === "idle") {
      const nextStrategy = {
        ...(item?.strategy ?? {}),
        agent: "scalpingGoals",
        scalpingGoals: {
          ...(scalpingPrev ?? {}),
          phase: "adopted_existing",
          adoptedExistingAt: new Date().toISOString(),
          adoptedExisting: { openOrdersCount, matchedBetsCount, marketIds },
          lastTickAt: new Date().toISOString(),
          lastSummary: { risk, profitSum, profitPct, totalGoals },
        },
      };
      const nextBetfair = { ...(item?.betfair ?? {}), overUnder: { ...ouPrev, "1.5": ou15, "2.5": ou25, "3.5": ou35 } };
      await kv.set(key, { ...item, betfair: nextBetfair, strategy: nextStrategy, updatedAt: new Date().toISOString() });
      return c.json({ ok: true, matchId, adoptedExisting: true, openOrdersCount, matchedBetsCount, risk, profitSum, profitPct });
    }

    let placed: any[] = [];
    let cashouted: any[] = [];
    let repriced: any[] = [];

    const shouldCashout = typeof profitPct === "number" && Number.isFinite(profitPct) && profitPct >= profitTargetPct;
    if (shouldCashout && risk > 0) {
      for (const m of markets) {
        try {
          const r = await cashoutMarket(String(m.marketId));
          cashouted.push({ marketId: String(m.marketId), line: m.line, ...r });
        } catch (e) {
          cashouted.push({ marketId: String(m.marketId), line: m.line, error: e instanceof Error ? e.message : String(e) });
        }
      }
      phase = "closed";
    } else if (!adoptedExistingAt) {
      if (openOrdersCount > 0) {
        const nowMs = Date.now();
        const waitMs = Math.max(1_000, Math.floor(secondsToWaitMatch * 1000));

        const cancelOrder = async (marketId: string, betId: string) => {
          const bid = String(betId ?? "").trim();
          if (!bid) return null;
          return await betfairJsonRpcTrading({
            method: "SportsAPING/v1.0/cancelOrders",
            params: { marketId, instructions: [{ betId: bid }] },
            sessionToken,
          });
        };

        const mk15 = ou15?.marketId ? String(ou15.marketId) : null;
        const mk25 = ou25?.marketId ? String(ou25.marketId) : null;
        const mk35 = ou35?.marketId ? String(ou35.marketId) : null;
        const sel15 = Number(ou15?.odds?.under?.selectionId ?? ou15?.runners?.underSelectionId);
        const sel25 = Number(ou25?.odds?.under?.selectionId ?? ou25?.runners?.underSelectionId);
        const sel35 = Number(ou35?.odds?.under?.selectionId ?? ou35?.runners?.underSelectionId);
        const base15 = Number(ou15?.odds?.under?.back);
        const base25 = Number(ou25?.odds?.under?.back);
        const base35 = Number(ou35?.odds?.under?.back);
        const px15 = applyOffsetTicks(base15, entryOffsetTicks) ?? (Number.isFinite(base15) ? base15 : null);
        const px25 = applyOffsetTicks(base25, entryOffsetTicks) ?? (Number.isFinite(base25) ? base25 : null);
        const px35 = applyOffsetTicks(base35, entryOffsetTicks) ?? (Number.isFinite(base35) ? base35 : null);
        const marketInfo = new Map<string, { selectionId: number; price: number | null; line: number }>();
        if (mk15 && Number.isFinite(sel15)) marketInfo.set(mk15, { selectionId: sel15, price: Number.isFinite(px15) ? px15 : null, line: 1.5 });
        if (mk25 && Number.isFinite(sel25)) marketInfo.set(mk25, { selectionId: sel25, price: Number.isFinite(px25) ? px25 : null, line: 2.5 });
        if (mk35 && Number.isFinite(sel35)) marketInfo.set(mk35, { selectionId: sel35, price: Number.isFinite(px35) ? px35 : null, line: 3.5 });

        for (const o of currentOrders) {
          const marketId = String(o?.marketId ?? "").trim();
          if (!marketId || !marketInfo.has(marketId)) continue;
          const side = String(o?.side ?? "").toUpperCase();
          if (side !== "BACK") continue;
          const sizeMatched = Number(o?.sizeMatched ?? 0);
          if (Number.isFinite(sizeMatched) && sizeMatched > 0) continue;
          const sizeRemaining = Number(o?.sizeRemaining ?? 0);
          if (!Number.isFinite(sizeRemaining) || sizeRemaining <= 0) continue;
          const betId = String(o?.betId ?? "").trim();
          if (!betId) continue;
          const placedIso = String(o?.placedDate ?? "").trim();
          const placedMs = placedIso ? new Date(placedIso).getTime() : 0;
          if (placedMs && Number.isFinite(placedMs) && nowMs - placedMs < waitMs) continue;

          const info = marketInfo.get(marketId)!;
          if (!Number.isFinite(info.selectionId) || !Number.isFinite(info.price) || !info.price || info.price <= 1.01) continue;
          if (sizeRemaining < 2) continue;

          try {
            await cancelOrder(marketId, betId);
          } catch {}
          const res = await betfairJsonRpcTrading({
            method: "SportsAPING/v1.0/placeOrders",
            params: {
              marketId,
              instructions: [{ selectionId: info.selectionId, side: "BACK", orderType: "LIMIT", limitOrder: { size: round2(sizeRemaining), price: info.price, persistenceType: "LAPSE" } }],
              customerRef: `SG_RE_${matchId}_${Date.now()}`.slice(0, 32),
              async: false,
            },
            sessionToken,
          });
          repriced.push({ marketId, line: info.line, stake: round2(sizeRemaining), price: info.price, result: res });
        }
      }

      const isInPlay = Boolean(item?.betfair?.inPlay ?? false);
      if (phase === "idle" && !isInPlay) {
        const mk15 = ou15?.marketId ? String(ou15.marketId) : null;
        const mk25 = ou25?.marketId ? String(ou25.marketId) : null;
        const sel15 = Number(ou15?.odds?.under?.selectionId ?? ou15?.runners?.underSelectionId);
        const sel25 = Number(ou25?.odds?.under?.selectionId ?? ou25?.runners?.underSelectionId);
        const base15 = Number(ou15?.odds?.under?.back);
        const base25 = Number(ou25?.odds?.under?.back);
        const px15 = applyOffsetTicks(base15, entryOffsetTicks) ?? (Number.isFinite(base15) ? base15 : null);
        const px25 = applyOffsetTicks(base25, entryOffsetTicks) ?? (Number.isFinite(base25) ? base25 : null);
        const stake15 = round2(stakeBankroll * 0.5);
        const stake25 = round2(stakeBankroll - stake15);
        if (mk15 && mk25 && Number.isFinite(sel15) && Number.isFinite(sel25) && Number.isFinite(px15) && Number.isFinite(px25) && stake15 >= 2 && stake25 >= 2) {
          const r15 = await betfairJsonRpcTrading({
            method: "SportsAPING/v1.0/placeOrders",
            params: {
              marketId: mk15,
              instructions: [{ selectionId: sel15, side: "BACK", orderType: "LIMIT", limitOrder: { size: stake15, price: px15, persistenceType: "LAPSE" } }],
              customerRef: `SG_U15_${matchId}_${Date.now()}`.slice(0, 32),
              async: false,
            },
            sessionToken,
          });
          const r25 = await betfairJsonRpcTrading({
            method: "SportsAPING/v1.0/placeOrders",
            params: {
              marketId: mk25,
              instructions: [{ selectionId: sel25, side: "BACK", orderType: "LIMIT", limitOrder: { size: stake25, price: px25, persistenceType: "LAPSE" } }],
              customerRef: `SG_U25_${matchId}_${Date.now()}`.slice(0, 32),
              async: false,
            },
            sessionToken,
          });
          placed.push({ marketId: mk15, line: 1.5, stake: stake15, price: px15, result: r15 });
          placed.push({ marketId: mk25, line: 2.5, stake: stake25, price: px25, result: r25 });
          phase = "entered_pre";
        }
      } else if ((phase === "entered_pre" || phase === "recovery") && totalGoals >= 1) {
        const mk35 = ou35?.marketId ? String(ou35.marketId) : null;
        const sel35 = Number(ou35?.odds?.under?.selectionId ?? ou35?.runners?.underSelectionId);
        const base35 = Number(ou35?.odds?.under?.back);
        const px35 = applyOffsetTicks(base35, entryOffsetTicks) ?? (Number.isFinite(base35) ? base35 : null);
        const wantsRecovery = phase === "entered_pre";
        if (wantsRecovery && mk35 && Number.isFinite(sel35) && Number.isFinite(px35) && px35 > 1.01) {
          const needed = profitSum < 0 ? Math.abs(profitSum) * 1.2 : stakeBankroll * 0.3;
          const stake35 = round2(clamp(needed, 2, stakeBankroll));
          const r35 = await betfairJsonRpcTrading({
            method: "SportsAPING/v1.0/placeOrders",
            params: {
              marketId: mk35,
              instructions: [{ selectionId: sel35, side: "BACK", orderType: "LIMIT", limitOrder: { size: stake35, price: px35, persistenceType: "LAPSE" } }],
              customerRef: `SG_U35_${matchId}_${Date.now()}`.slice(0, 32),
              async: false,
            },
            sessionToken,
          });
          placed.push({ marketId: mk35, line: 3.5, stake: stake35, price: px35, result: r35 });
          phase = "recovery";
        }
      }
    }

    const nextStrategy = {
      ...(item?.strategy ?? {}),
      agent: "scalpingGoals",
      scalpingGoals: {
        ...(scalpingPrev ?? {}),
        phase,
        lastTickAt: new Date().toISOString(),
        lastSummary: { risk, profitSum, profitPct, totalGoals, profitTargetPct, stakePct, entryOffsetTicks, secondsToWaitMatch },
      },
    };
    const nextBetfair = { ...(item?.betfair ?? {}), overUnder: { ...ouPrev, "1.5": ou15, "2.5": ou25, "3.5": ou35 } };
    await kv.set(key, { ...item, betfair: nextBetfair, strategy: nextStrategy, updatedAt: new Date().toISOString() });

    return c.json({ ok: true, matchId, phase, risk, profitSum, profitPct, profitByMarket, placed, repriced, cashouted });
  } catch (error) {
    return c.json({ ok: false, error: error.message || "Erro no robô Scalping Gol Acima" }, 500);
  }
};

const betfairOverGoalsLimitTickHandler = async (c: any) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  const adminError = requireAutomationAdmin(c);
  if (adminError) return adminError;
  try {
    const body = await c.req.json().catch(() => ({}));
    const matchId = String(body?.matchId ?? "").trim();
    if (!matchId) return c.json({ ok: false, error: "matchId obrigatório" }, 400);

    const cfg = (body?.config && typeof body.config === "object") ? body.config : {};
    const bankrollRaw = Number(cfg?.bankroll ?? 50);
    const bankroll = Number.isFinite(bankrollRaw) ? clamp(bankrollRaw, 2, 10_000) : 50;
    const bankrollTotalRaw = Number(cfg?.bankrollTotal ?? 0);
    const bankrollTotal = Number.isFinite(bankrollTotalRaw) ? clamp(bankrollTotalRaw, 0, 10_000_000) : 0;
    const minOddsRaw = Number(cfg?.minOdds ?? 1.3);
    const minOdds = Number.isFinite(minOddsRaw) ? clamp(minOddsRaw, 1.01, 10) : 1.3;
    const maxEntriesRaw = Number(cfg?.maxEntries ?? 3);
    const maxEntries = Number.isFinite(maxEntriesRaw) ? clamp(Math.floor(maxEntriesRaw), 1, 10) : 3;
    const profitTargetPctRaw = Number(cfg?.profitTargetPct ?? 0.02);
    const profitTargetPct = Number.isFinite(profitTargetPctRaw) ? clamp(profitTargetPctRaw, 0.001, 0.5) : 0.02;
    const maxRiskPctRaw = Number(cfg?.maxRiskPct ?? 0.05);
    const maxRiskPct = Number.isFinite(maxRiskPctRaw) ? clamp(maxRiskPctRaw, 0, 1) : 0.05;
    const minDeltaTradedRaw = Number(cfg?.minDeltaTraded ?? 200);
    const minDeltaTraded = Number.isFinite(minDeltaTradedRaw) ? clamp(minDeltaTradedRaw, 10, 1_000_000) : 200;
    const dominanceRatioRaw = Number(cfg?.dominanceRatio ?? 1.25);
    const dominanceRatio = Number.isFinite(dominanceRatioRaw) ? clamp(dominanceRatioRaw, 1.01, 10) : 1.25;
    const minSecondsBetweenEntriesRaw = Number(cfg?.minSecondsBetweenEntries ?? 30);
    const minSecondsBetweenEntries = Number.isFinite(minSecondsBetweenEntriesRaw) ? clamp(minSecondsBetweenEntriesRaw, 0, 600) : 30;
    const stakePctRaw = Number(cfg?.stakePct ?? 1);
    const stakePct = Number.isFinite(stakePctRaw) ? clamp(stakePctRaw, 0.01, 1) : 1;
    const stakeAbsRaw = Number(cfg?.stakeAbs);
    const stakeAbs = Number.isFinite(stakeAbsRaw) ? round2(stakeAbsRaw) : NaN;
    const stakeBankroll = Number.isFinite(stakeAbs) && stakeAbs > 0 ? round2(clamp(stakeAbs, 2, bankroll)) : round2(clamp(bankroll * stakePct, 2, bankroll));
    const entryOffsetTicksRaw = Number(cfg?.entryOffsetTicks ?? 2);
    const entryOffsetTicks = Number.isFinite(entryOffsetTicksRaw) ? clamp(Math.trunc(entryOffsetTicksRaw), -10, 10) : 2;
    const maxSpreadTicksRaw = Number(cfg?.maxSpreadTicks ?? 2);
    const maxSpreadTicks = Number.isFinite(maxSpreadTicksRaw) ? clamp(Math.floor(maxSpreadTicksRaw), 0, 10) : 2;
    const minMarketMatchedRaw = Number(cfg?.minMarketMatched ?? 100_000);
    const minMarketMatched = Number.isFinite(minMarketMatchedRaw) ? clamp(minMarketMatchedRaw, 0, 10_000_000) : 100_000;
    const minRunnerMatchedRaw = Number(cfg?.minRunnerMatched ?? 20_000);
    const minRunnerMatched = Number.isFinite(minRunnerMatchedRaw) ? clamp(minRunnerMatchedRaw, 0, 10_000_000) : 20_000;
    const maxLinesToScanRaw = Number(cfg?.maxLinesToScan ?? 4);
    const maxLinesToScan = Number.isFinite(maxLinesToScanRaw) ? clamp(Math.floor(maxLinesToScanRaw), 1, 10) : 4;
    const maxOverLineRaw = Number(cfg?.maxOverLine ?? 3.5);
    const maxOverLine = Number.isFinite(maxOverLineRaw) ? clamp(Math.round(maxOverLineRaw * 10) / 10, 0.5, 10.5) : 3.5;
    const modeRaw = String(cfg?.mode ?? "hybrid").trim().toLowerCase();
    const mode = modeRaw === "swing" ? "swing" : modeRaw === "scalp" ? "scalp" : "hybrid";
    const targetTicksRaw = Number(cfg?.targetTicks ?? 10);
    const targetTicks = Number.isFinite(targetTicksRaw) ? clamp(Math.floor(targetTicksRaw), 1, 50) : 10;
    const timeExitMinSecRaw = Number(cfg?.timeExitMinSec ?? 30);
    const timeExitMinSec = Number.isFinite(timeExitMinSecRaw) ? clamp(Math.floor(timeExitMinSecRaw), 1, 600) : 30;
    const timeExitMaxSecRaw = Number(cfg?.timeExitMaxSec ?? 90);
    const timeExitMaxSec = Number.isFinite(timeExitMaxSecRaw) ? clamp(Math.floor(timeExitMaxSecRaw), timeExitMinSec, 900) : 90;
    const postGoalWaitMinSecRaw = Number(cfg?.postGoalWaitMinSec ?? 60);
    const postGoalWaitMinSec = Number.isFinite(postGoalWaitMinSecRaw) ? clamp(Math.floor(postGoalWaitMinSecRaw), 0, 600) : 60;
    const postGoalWaitMaxSecRaw = Number(cfg?.postGoalWaitMaxSec ?? 120);
    const postGoalWaitMaxSec = Number.isFinite(postGoalWaitMaxSecRaw) ? clamp(Math.floor(postGoalWaitMaxSecRaw), postGoalWaitMinSec, 900) : 120;
    const steamMoveTicksRaw = Number(cfg?.steamMoveTicks ?? 10);
    const steamMoveTicks = Number.isFinite(steamMoveTicksRaw) ? clamp(Math.floor(steamMoveTicksRaw), 1, 50) : 10;
    const steamMoveWindowSecRaw = Number(cfg?.steamMoveWindowSec ?? 3);
    const steamMoveWindowSec = Number.isFinite(steamMoveWindowSecRaw) ? clamp(Math.floor(steamMoveWindowSecRaw), 1, 30) : 3;
    const swingMomentumScoreRaw = Number(cfg?.swingMomentumScore ?? 75);
    const swingMomentumScore = Number.isFinite(swingMomentumScoreRaw) ? clamp(Math.floor(swingMomentumScoreRaw), 1, 100) : 75;
    const allowWindowsRaw = Boolean(cfg?.allowWindows ?? true);
    const windowMinMinRaw = Number(cfg?.windowMinMin ?? 15);
    const windowMinMin = Number.isFinite(windowMinMinRaw) ? clamp(Math.floor(windowMinMinRaw), 0, 200) : 15;
    const windowMaxMinRaw = Number(cfg?.windowMaxMin ?? 80);
    const windowMaxMin = Number.isFinite(windowMaxMinRaw) ? clamp(Math.floor(windowMaxMinRaw), windowMinMin, 200) : 80;
    const minDangerousAttacksRaw = Number(cfg?.minDangerousAttacks ?? 15);
    const minDangerousAttacks = Number.isFinite(minDangerousAttacksRaw) ? clamp(Math.floor(minDangerousAttacksRaw), 0, 500) : 15;
    const minShotsOnGoalRaw = Number(cfg?.minShotsOnGoal ?? 3);
    const minShotsOnGoal = Number.isFinite(minShotsOnGoalRaw) ? clamp(Math.floor(minShotsOnGoalRaw), 0, 100) : 3;
    const minCornersRaw = Number(cfg?.minCorners ?? 2);
    const minCorners = Number.isFinite(minCornersRaw) ? clamp(Math.floor(minCornersRaw), 0, 50) : 2;
    const minAttacksRaw = Number(cfg?.minAttacks ?? 60);
    const minAttacks = Number.isFinite(minAttacksRaw) ? clamp(Math.floor(minAttacksRaw), 0, 500) : 60;
    const gameMomentumWeightRaw = Number(cfg?.gameMomentumWeight ?? 0.4);
    const gameMomentumWeight = Number.isFinite(gameMomentumWeightRaw) ? clamp(gameMomentumWeightRaw, 0, 1) : 0.4;
    const pressureRecentSecRaw = Number(cfg?.pressureRecentSec ?? 60);
    const pressureRecentSec = Number.isFinite(pressureRecentSecRaw) ? clamp(Math.floor(pressureRecentSecRaw), 10, 600) : 60;
    const pressureTotalSecRaw = Number(cfg?.pressureTotalSec ?? 120);
    const pressureTotalSec = Number.isFinite(pressureTotalSecRaw) ? clamp(Math.floor(pressureTotalSecRaw), pressureRecentSec, 900) : 120;
    const pressureMinDeltaCornersRaw = Number(cfg?.pressureMinDeltaCorners ?? 1);
    const pressureMinDeltaCorners = Number.isFinite(pressureMinDeltaCornersRaw) ? clamp(Math.floor(pressureMinDeltaCornersRaw), 0, 20) : 1;
    const pressureMinDeltaSogRaw = Number(cfg?.pressureMinDeltaSog ?? 1);
    const pressureMinDeltaSog = Number.isFinite(pressureMinDeltaSogRaw) ? clamp(Math.floor(pressureMinDeltaSogRaw), 0, 20) : 1;
    const pressureMinDeltaDangerousAttacksRaw = Number(cfg?.pressureMinDeltaDangerousAttacks ?? 6);
    const pressureMinDeltaDangerousAttacks = Number.isFinite(pressureMinDeltaDangerousAttacksRaw) ? clamp(Math.floor(pressureMinDeltaDangerousAttacksRaw), 0, 200) : 6;
    const pressureAccelRatioRaw = Number(cfg?.pressureAccelRatio ?? 1.3);
    const pressureAccelRatio = Number.isFinite(pressureAccelRatioRaw) ? clamp(pressureAccelRatioRaw, 0.5, 10) : 1.3;

    const stepsForPrice = (p: number) => {
      if (p < 2) return 0.01;
      if (p < 3) return 0.02;
      if (p < 4) return 0.05;
      if (p < 6) return 0.1;
      if (p < 10) return 0.2;
      if (p < 20) return 0.5;
      if (p < 30) return 1;
      if (p < 50) return 2;
      if (p < 100) return 5;
      return 10;
    };
    const roundPrice = (p: number) => round2(p);
    const tickUpOnce = (p: number) => roundPrice(p + stepsForPrice(p));
    const tickDownOnce = (p: number) => {
      const s = stepsForPrice(p);
      const next = p - s;
      return roundPrice(next < 1.01 ? 1.01 : next);
    };
    const tickUp = (p: number, n: number) => {
      let v = p;
      for (let i = 0; i < n; i += 1) v = tickUpOnce(v);
      return v;
    };
    const tickDown = (p: number, n: number) => {
      let v = p;
      for (let i = 0; i < n; i += 1) v = tickDownOnce(v);
      return v;
    };
    const applyOffsetTicks = (p: number, ticks: number) => {
      if (!Number.isFinite(p) || p <= 1.01) return null;
      if (!Number.isFinite(ticks) || ticks === 0) return roundPrice(p);
      const t = Math.trunc(ticks);
      return t > 0 ? tickUp(p, t) : tickDown(p, Math.abs(t));
    };
    const tickDistance = (from: number, to: number) => {
      if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 1.01 || to <= 1.01) return null;
      if (from === to) return 0;
      let steps = 0;
      if (to > from) {
        let v = from;
        while (v < to && steps < 2000) {
          v = tickUpOnce(v);
          steps += 1;
        }
        return steps;
      }
      let v = from;
      while (v > to && steps < 2000) {
        v = tickDownOnce(v);
        steps += 1;
      }
      return steps;
    };

    const key = `${BETFAIR_QUEUE_PREFIX}${matchId}`;
    const item = (await kv.get(key)) ?? null;
    if (!item) return c.json({ ok: false, error: "Item não encontrado na fila" }, 404);

    const agentRaw = String(item?.strategy?.agent ?? "").trim().toLowerCase();
    const agent =
      agentRaw === "overgoalslimit" || agentRaw === "over_goals_limit" || agentRaw === "over_goals" ? "overGoalsLimit" : agentRaw === "scalpinggoals" || agentRaw === "scalping_goals" ? "scalpingGoals" : "correctScore";
    if (agent !== "overGoalsLimit") return c.json({ ok: false, error: "Robô não é Over Gols Limite" }, 400);

    const betfair = item?.betfair ?? null;
    let eventId = String(betfair?.eventId ?? "").trim();
    if (!eventId && String(item?.homeTeam ?? "").trim() && String(item?.awayTeam ?? "").trim()) {
      try {
        const mapped = await resolveBetfairMatchOdds({ homeTeam: String(item.homeTeam), awayTeam: String(item.awayTeam), utcDate: item?.utcDate });
        eventId = String(mapped?.eventId ?? "").trim();
        item.betfair = { ...(item?.betfair ?? {}), ...mapped };
      } catch {}
    }
    if (!eventId) return c.json({ ok: false, error: "Betfair: eventId não resolvido" }, 400);

    const scoreHome = Number.isFinite(Number(item?.scoreHome)) ? Number(item.scoreHome) : 0;
    const scoreAway = Number.isFinite(Number(item?.scoreAway)) ? Number(item.scoreAway) : 0;
    const totalGoals = Math.max(0, Math.floor(scoreHome)) + Math.max(0, Math.floor(scoreAway));
    const baseLine = totalGoals + 0.5;
    if (baseLine < 0.5 || baseLine > 10.5) return c.json({ ok: true, matchId, phase: "skip_line", totalGoals, line: baseLine, reason: "Linha fora do range" });
    const candidateLines: number[] = [];
    for (let i = 0; i < maxLinesToScan; i += 1) {
      const ln = baseLine + i;
      if (ln > 10.5) break;
      if (ln > maxOverLine) break;
      candidateLines.push(ln);
    }
    if (candidateLines.length === 0) return c.json({ ok: true, matchId, phase: "skip_line", totalGoals, line: baseLine, reason: "Sem linhas candidatas" });

    const ouPrev = (item?.betfair?.overUnder && typeof item.betfair.overUnder === "object") ? item.betfair.overUnder : {};

    const sessionToken = await getBetfairSessionToken();

    const calcRisk = (orders: any[]) => {
      return round2(
        orders.reduce((acc: number, o: any) => {
          const side = String(o?.side ?? "").trim().toUpperCase();
          const price = Number(o?.priceSize?.price);
          const sizeRemaining = Number(o?.sizeRemaining);
          const sizeMatched = Number(o?.sizeMatched);
          const size = (Number.isFinite(sizeRemaining) ? sizeRemaining : 0) + (Number.isFinite(sizeMatched) ? sizeMatched : 0);
          if (!Number.isFinite(size) || size <= 0) return acc;
          if (side === "LAY") {
            if (!Number.isFinite(price) || price <= 1.01) return acc;
            return acc + size * (price - 1);
          }
          return acc + size;
        }, 0),
      );
    };

    const calcWorstProfit = async (mid: string) => {
      const pnlRes = await betfairJsonRpcTrading({
        method: "SportsAPING/v1.0/listMarketProfitAndLoss",
        params: { marketIds: [mid], includeSettledBets: false, includeBspBets: false, netOfCommission: true },
        sessionToken,
      });
      const mk = Array.isArray(pnlRes) ? pnlRes[0] : null;
      const pnlList = Array.isArray(mk?.profitAndLosses)
        ? mk.profitAndLosses
        : Array.isArray(mk?.profitAndLoss)
          ? mk.profitAndLoss
          : [];
      const values = pnlList.map((x: any) => Number(x?.ifWin)).filter((v: any) => typeof v === "number" && Number.isFinite(v));
      return values.length > 0 ? round2(values.reduce((m: number, v: number) => (v < m ? v : m), values[0])) : null;
    };

    const cashoutMarket = async (mid: string) => {
      const listRes = await betfairJsonRpcTrading({
        method: "SportsAPING/v1.0/listCurrentOrders",
        params: { marketIds: [mid] },
        sessionToken,
      });
      const orders = Array.isArray(listRes?.currentOrders) ? listRes.currentOrders : [];
      const toCancel = orders.filter((o: any) => Number(o?.sizeRemaining ?? 0) > 0 && String(o?.betId ?? "").trim()).map((o: any) => String(o.betId));
      if (toCancel.length > 0) {
        await betfairJsonRpcTrading({
          method: "SportsAPING/v1.0/cancelOrders",
          params: { marketId: mid, instructions: toCancel.map((betId: string) => ({ betId })) },
          sessionToken,
        });
      }

      const book = await betfairJsonRpc({
        method: "SportsAPING/v1.0/listMarketBook",
        params: { marketIds: [mid], priceProjection: { priceData: ["EX_BEST_OFFERS"], virtualise: true } },
        sessionToken,
      });
      const book0 = Array.isArray(book) ? book[0] : book;
      const runners = Array.isArray(book0?.runners) ? book0.runners : [];
      const bySelection = new Map<number, any>();
      for (const r of runners) {
        const sid = Number(r?.selectionId);
        if (!Number.isFinite(sid)) continue;
        const ex = r?.ex ?? {};
        const back0 = Array.isArray(ex?.availableToBack) ? ex.availableToBack[0] : null;
        const lay0 = Array.isArray(ex?.availableToLay) ? ex.availableToLay[0] : null;
        bySelection.set(sid, { bestBack: back0 ? Number(back0.price) : null, bestLay: lay0 ? Number(lay0.price) : null });
      }

      const hedgeInstructions: any[] = [];
      for (const o of orders) {
        const sizeMatched = Number(o?.sizeMatched ?? 0);
        if (!Number.isFinite(sizeMatched) || sizeMatched <= 0) continue;
        const selectionId = Number(o?.selectionId);
        if (!Number.isFinite(selectionId)) continue;
        const side = String(o?.side ?? "").toUpperCase();
        const px = bySelection.get(selectionId) ?? {};
        if (side === "BACK") {
          const layPrice = Number(px?.bestLay);
          if (!Number.isFinite(layPrice) || layPrice <= 1.01) continue;
          hedgeInstructions.push({ selectionId, side: "LAY", orderType: "LIMIT", limitOrder: { size: round2(sizeMatched), price: layPrice, persistenceType: "LAPSE" } });
        } else if (side === "LAY") {
          const backPrice = Number(px?.bestBack);
          if (!Number.isFinite(backPrice) || backPrice <= 1.01) continue;
          hedgeInstructions.push({ selectionId, side: "BACK", orderType: "LIMIT", limitOrder: { size: round2(sizeMatched), price: backPrice, persistenceType: "LAPSE" } });
        }
      }

      let hedgeResult: any = null;
      if (hedgeInstructions.length > 0) {
        hedgeResult = await betfairJsonRpcTrading({
          method: "SportsAPING/v1.0/placeOrders",
          params: { marketId: mid, instructions: hedgeInstructions.slice(0, 50), customerRef: `OG_CASH_${matchId}_${Date.now()}`.slice(0, 32), async: false },
          sessionToken,
        });
      }
      return { cancelledCount: toCancel.length, hedgedCount: hedgeInstructions.length, hedgeResult };
    };

    const prev = (item?.strategy?.overGoalsLimit && typeof item.strategy.overGoalsLimit === "object") ? item.strategy.overGoalsLimit : {};
    const phasePrev = String(prev?.phase ?? "").trim() || "idle";
    const closedAt = String(prev?.closedAt ?? "").trim() || null;
    if (closedAt || phasePrev.startsWith("closed")) {
      return c.json({ ok: true, matchId, phase: phasePrev || "closed", totalGoals, line: baseLine });
    }

    const enteredPrevRaw = Array.isArray(prev?.enteredMarketIds) ? prev.enteredMarketIds : [];
    const enteredPrev = enteredPrevRaw.map((x: any) => String(x ?? "").trim()).filter((x: any) => x);
    const enteredSet = new Set<string>(enteredPrev);
    const marketIdsForRisk = Array.from(enteredSet).slice(0, 10);

    const randSeconds = (min: number, max: number) => {
      const a = Number.isFinite(min) ? Math.max(0, Math.floor(min)) : 0;
      const b = Number.isFinite(max) ? Math.max(a, Math.floor(max)) : a;
      if (a === b) return a;
      return a + Math.floor(Math.random() * (b - a + 1));
    };

    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const statsRaw = (body?.stats && typeof body.stats === "object") ? body.stats : null;
    const safeNum = (v: any) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const stats = statsRaw
      ? {
          fetchedAt: String(statsRaw?.fetchedAt ?? nowIso).trim() || nowIso,
          dangerousAttacksHome: safeNum(statsRaw?.dangerousAttacksHome),
          dangerousAttacksAway: safeNum(statsRaw?.dangerousAttacksAway),
          attacksHome: safeNum(statsRaw?.attacksHome),
          attacksAway: safeNum(statsRaw?.attacksAway),
          shotsOnGoalHome: safeNum(statsRaw?.shotsOnGoalHome),
          shotsOnGoalAway: safeNum(statsRaw?.shotsOnGoalAway),
          cornersHome: safeNum(statsRaw?.cornersHome),
          cornersAway: safeNum(statsRaw?.cornersAway),
          cardsHome: safeNum(statsRaw?.cardsHome),
          cardsAway: safeNum(statsRaw?.cardsAway),
        }
      : null;

    const prevPressure = (prev?.pressureSnapshot && typeof prev.pressureSnapshot === "object") ? prev.pressureSnapshot : null;
    const prevPressureAtIso = String(prevPressure?.fetchedAt ?? "").trim() || null;
    const prevPressureAtMs = prevPressureAtIso ? new Date(prevPressureAtIso).getTime() : 0;
    const curPressureAtIso = stats ? String(stats.fetchedAt) : nowIso;
    const curPressureAtMs = new Date(curPressureAtIso).getTime();
    const snapAgeSec =
      prevPressureAtMs && Number.isFinite(prevPressureAtMs) && Number.isFinite(curPressureAtMs) && curPressureAtMs >= prevPressureAtMs
        ? (curPressureAtMs - prevPressureAtMs) / 1000
        : null;
    const withinPressureWindow = typeof snapAgeSec === "number" && Number.isFinite(snapAgeSec) ? snapAgeSec <= 180 : false;

    const sum2 = (a: number | null, b: number | null) => (typeof a === "number" ? a : 0) + (typeof b === "number" ? b : 0);
    const curDA = stats ? sum2(stats.dangerousAttacksHome, stats.dangerousAttacksAway) : null;
    const curAtt = stats ? sum2(stats.attacksHome, stats.attacksAway) : null;
    const curSOG = stats ? sum2(stats.shotsOnGoalHome, stats.shotsOnGoalAway) : null;
    const curCorners = stats ? sum2(stats.cornersHome, stats.cornersAway) : null;

    const prevDA = withinPressureWindow ? safeNum(prevPressure?.dangerousAttacksTotal) : null;
    const prevAtt = withinPressureWindow ? safeNum(prevPressure?.attacksTotal) : null;
    const prevSOG = withinPressureWindow ? safeNum(prevPressure?.shotsOnGoalTotal) : null;
    const prevCorners = withinPressureWindow ? safeNum(prevPressure?.cornersTotal) : null;

    const dDA = typeof curDA === "number" && typeof prevDA === "number" ? Math.max(0, curDA - prevDA) : null;
    const dAtt = typeof curAtt === "number" && typeof prevAtt === "number" ? Math.max(0, curAtt - prevAtt) : null;
    const dSOG = typeof curSOG === "number" && typeof prevSOG === "number" ? Math.max(0, curSOG - prevSOG) : null;
    const dCorners = typeof curCorners === "number" && typeof prevCorners === "number" ? Math.max(0, curCorners - prevCorners) : null;

    let gameMomentumScore: number | null = null;
    let pressureOk = false;
    if (stats && typeof curDA === "number" && typeof curAtt === "number" && typeof curSOG === "number" && typeof curCorners === "number") {
      const base =
        Math.min(40, curDA * 1.2) +
        Math.min(30, curSOG * 6) +
        Math.min(20, curCorners * 2.5) +
        Math.min(10, curAtt / 10);
      let bonus = 0;
      if (typeof dDA === "number" && dDA >= 4) bonus += 10;
      if (typeof dSOG === "number" && dSOG >= 1) bonus += 10;
      if (typeof dCorners === "number" && dCorners >= 1) bonus += 6;
      const score = Math.max(0, Math.min(100, Math.round(base + bonus)));
      gameMomentumScore = score;
      pressureOk =
        curDA >= minDangerousAttacks &&
        curSOG >= minShotsOnGoal &&
        (curCorners >= minCorners || curAtt >= minAttacks) &&
        (typeof dDA !== "number" ? true : dDA >= 1);
    }

    const prevSeriesRaw = Array.isArray(prev?.pressureSeries) ? prev.pressureSeries : [];
    const prevSeries = prevSeriesRaw
      .filter((x: any) => x && typeof x === "object" && String((x as any)?.at ?? "").trim())
      .map((x: any) => ({
        at: String(x.at),
        dDA: Number(x?.dDA),
        dSOG: Number(x?.dSOG),
        dCorners: Number(x?.dCorners),
      }))
      .filter((x: any) => Number.isFinite(new Date(String(x.at)).getTime()));
    const seriesWindowStartMs = nowMs - pressureTotalSec * 1000;
    const seriesFiltered = prevSeries.slice(-80).filter((x: any) => {
      const ms = new Date(String(x.at)).getTime();
      return Number.isFinite(ms) && ms >= seriesWindowStartMs;
    });
    const sampleNow =
      stats && (typeof dDA === "number" || typeof dSOG === "number" || typeof dCorners === "number")
        ? {
            at: curPressureAtIso,
            dDA: typeof dDA === "number" && Number.isFinite(dDA) ? dDA : 0,
            dSOG: typeof dSOG === "number" && Number.isFinite(dSOG) ? dSOG : 0,
            dCorners: typeof dCorners === "number" && Number.isFinite(dCorners) ? dCorners : 0,
          }
        : null;
    const pressureSeries = (sampleNow ? seriesFiltered.concat([sampleNow]) : seriesFiltered).slice(-120);

    const recentStartMs = nowMs - pressureRecentSec * 1000;
    const prevStartMs = nowMs - pressureTotalSec * 1000;
    const prevEndMs = recentStartMs;
    const recent = pressureSeries.filter((x: any) => {
      const ms = new Date(String(x.at)).getTime();
      return Number.isFinite(ms) && ms >= recentStartMs;
    });
    const previous = pressureSeries.filter((x: any) => {
      const ms = new Date(String(x.at)).getTime();
      return Number.isFinite(ms) && ms >= prevStartMs && ms < prevEndMs;
    });
    const sum = (arr: any[], key: "dDA" | "dSOG" | "dCorners") =>
      arr.reduce((acc: number, x: any) => acc + (Number.isFinite(Number(x?.[key])) ? Number(x[key]) : 0), 0);
    const pressureRecentDA = round2(sum(recent, "dDA"));
    const pressurePrevDA = round2(sum(previous, "dDA"));
    const pressureRecentSOG = round2(sum(recent, "dSOG"));
    const pressureRecentCorners = round2(sum(recent, "dCorners"));
    const pressureAccel = pressurePrevDA > 0 ? round2(pressureRecentDA / pressurePrevDA) : null;
    const pressureAccelOk = pressureAccel == null ? pressureRecentDA >= pressureMinDeltaDangerousAttacks : pressureAccel >= pressureAccelRatio;
    const continuousPressure =
      pressureOk &&
      recent.length >= 2 &&
      pressureRecentCorners >= pressureMinDeltaCorners &&
      pressureRecentSOG >= pressureMinDeltaSog &&
      pressureRecentDA >= pressureMinDeltaDangerousAttacks &&
      pressureAccelOk;

    if (continuousPressure && typeof gameMomentumScore === "number" && Number.isFinite(gameMomentumScore)) {
      gameMomentumScore = Math.min(100, gameMomentumScore + 10);
    }
    const prevGoalsRaw = Number(prev?.lastGoals);
    const prevGoals = Number.isFinite(prevGoalsRaw) ? Math.max(0, Math.floor(prevGoalsRaw)) : null;
    const prevCooldownIso = String(prev?.cooldownUntil ?? "").trim() || null;
    const prevCooldownMs = prevCooldownIso ? new Date(prevCooldownIso).getTime() : 0;

    if (prevCooldownMs && Number.isFinite(prevCooldownMs) && nowMs < prevCooldownMs) {
      const nextStrategy = {
        ...(item?.strategy ?? {}),
        agent: "overGoalsLimit",
        overGoalsLimit: {
          ...(prev ?? {}),
          phase: "cooldown",
          lastGoals: totalGoals,
          cooldownUntil: prevCooldownIso,
          lastTickAt: nowIso,
          lastSummary: { totalGoals, baseLine, reason: "cooldown_until", cooldownUntil: prevCooldownIso },
        },
      };
      await kv.set(key, { ...item, strategy: nextStrategy, updatedAt: nowIso });
      return c.json({ ok: true, matchId, phase: "cooldown", totalGoals, line: baseLine, cooldownUntil: prevCooldownIso });
    }

    const goalsChanged = prevGoals != null && totalGoals !== prevGoals;
    if (goalsChanged && marketIdsForRisk.length > 0) {
      const cashouted: any[] = [];
      for (const mid of marketIdsForRisk) {
        try {
          const r = await cashoutMarket(mid);
          cashouted.push({ marketId: mid, ...r });
        } catch (e) {
          cashouted.push({ marketId: mid, error: e instanceof Error ? e.message : String(e) });
        }
      }
      const waitSec = randSeconds(postGoalWaitMinSec, postGoalWaitMaxSec);
      const cooldownUntil = new Date(nowMs + waitSec * 1000).toISOString();
      const nextStrategy = {
        ...(item?.strategy ?? {}),
        agent: "overGoalsLimit",
        overGoalsLimit: {
          ...(prev ?? {}),
          phase: "post_goal_wait",
          lastGoals: totalGoals,
          cooldownUntil,
          lastTickAt: nowIso,
          lastSummary: { totalGoals, baseLine, reason: "goal_changed", waitSec, cooldownUntil, cashoutedCount: cashouted.length },
        },
      };
      await kv.set(key, { ...item, strategy: nextStrategy, updatedAt: nowIso });
      return c.json({ ok: true, matchId, phase: "post_goal_wait", totalGoals, line: baseLine, cooldownUntil, cashouted });
    }

    const listAll = await betfairJsonRpcTrading({
      method: "SportsAPING/v1.0/listCurrentOrders",
      params: { marketIds: marketIdsForRisk },
      sessionToken,
    });
    const ordersAll = Array.isArray(listAll?.currentOrders) ? listAll.currentOrders : [];
    const risk = calcRisk(ordersAll);

    const profitByMarket: any[] = [];
    let profitSum = 0;
    for (const mid of marketIdsForRisk) {
      try {
        const p = await calcWorstProfit(mid);
        profitByMarket.push({ marketId: mid, profit: p });
        if (typeof p === "number" && Number.isFinite(p)) profitSum += p;
      } catch {
        profitByMarket.push({ marketId: mid, profit: null });
      }
    }
    profitSum = round2(profitSum);

    const profitTargetAbs = bankrollTotal > 0 ? round2(bankrollTotal * profitTargetPct) : round2(bankroll * profitTargetPct);
    const shouldCloseProfit = profitTargetAbs > 0 && profitSum >= profitTargetAbs;
    let cashouted: any[] = [];
    if (shouldCloseProfit && risk > 0) {
      for (const mid of marketIdsForRisk) {
        try {
          const r = await cashoutMarket(mid);
          cashouted.push({ marketId: mid, ...r });
        } catch (e) {
          cashouted.push({ marketId: mid, error: e instanceof Error ? e.message : String(e) });
        }
      }
      const nextStrategy = {
        ...(item?.strategy ?? {}),
        agent: "overGoalsLimit",
        overGoalsLimit: {
          ...(prev ?? {}),
          phase: "closed_profit_target",
          closedAt: nowIso,
          lastTickAt: nowIso,
          lastGoals: totalGoals,
          lastSummary: { risk, profitSum, profitTargetAbs, totalGoals, baseLine, reason: "profit_target" },
        },
      };
      const nextBetfair = { ...(item?.betfair ?? {}), overUnder: { ...ouPrev } };
      await kv.set(key, { ...item, status: "stopped", betfair: nextBetfair, strategy: nextStrategy, updatedAt: nowIso });
      return c.json({ ok: true, matchId, phase: "closed_profit_target", risk, profitSum, profitTargetAbs, cashouted });
    }

    const isInPlay = Boolean(item?.betfair?.inPlay ?? false);
    if (!isInPlay) {
      const nextStrategy = {
        ...(item?.strategy ?? {}),
        agent: "overGoalsLimit",
        overGoalsLimit: {
          ...(prev ?? {}),
          phase: phasePrev,
          lastTickAt: nowIso,
          lastGoals: totalGoals,
          lastSummary: { risk, profitSum, profitTargetAbs, totalGoals, baseLine, inPlay: false },
        },
      };
      const nextBetfair = { ...(item?.betfair ?? {}), overUnder: { ...ouPrev } };
      await kv.set(key, { ...item, betfair: nextBetfair, strategy: nextStrategy, updatedAt: nowIso });
      return c.json({ ok: true, matchId, phase: "waiting_inplay", risk, profitSum, profitTargetAbs, totalGoals, line: baseLine });
    }

    const elapsedRaw = Number(item?.live?.elapsed);
    const statusShort = String(item?.live?.statusShort ?? "").trim().toUpperCase();
    const elapsed = Number.isFinite(elapsedRaw) ? Math.max(0, Math.floor(elapsedRaw)) : null;
    const isHalfTimeGap = elapsed != null ? (elapsed >= 40 && elapsed <= 55) : false;
    const isHalfTime = statusShort === "HT" || statusShort === "HALF TIME" || statusShort === "HALFTIME";
    if (allowWindowsRaw && elapsed != null && (elapsed < windowMinMin || elapsed > windowMaxMin || isHalfTimeGap || isHalfTime)) {
      const nextStrategy = {
        ...(item?.strategy ?? {}),
        agent: "overGoalsLimit",
        overGoalsLimit: {
          ...(prev ?? {}),
          phase: "waiting_window",
          lastTickAt: nowIso,
          lastGoals: totalGoals,
          lastSummary: { risk, profitSum, profitTargetAbs, totalGoals, baseLine, elapsed, statusShort, windowMinMin, windowMaxMin },
        },
      };
      await kv.set(key, { ...item, strategy: nextStrategy, updatedAt: nowIso });
      return c.json({ ok: true, matchId, phase: "waiting_window", totalGoals, line: baseLine, elapsed, statusShort });
    }

    const lastEntryAt = String(prev?.lastEntryAt ?? "").trim();
    const lastEntryMs = lastEntryAt ? new Date(lastEntryAt).getTime() : 0;
    if (lastEntryMs && Number.isFinite(lastEntryMs) && minSecondsBetweenEntries > 0 && Date.now() - lastEntryMs < minSecondsBetweenEntries * 1000) {
      const nextStrategy = {
        ...(item?.strategy ?? {}),
        agent: "overGoalsLimit",
        overGoalsLimit: {
          ...(prev ?? {}),
          phase: "cooldown",
          lastTickAt: nowIso,
          lastGoals: totalGoals,
          lastSummary: { risk, profitSum, profitTargetAbs, totalGoals, baseLine },
        },
      };
      const nextBetfair = { ...(item?.betfair ?? {}), overUnder: { ...ouPrev } };
      await kv.set(key, { ...item, betfair: nextBetfair, strategy: nextStrategy, updatedAt: nowIso });
      return c.json({ ok: true, matchId, phase: "cooldown", risk, profitSum, profitTargetAbs, totalGoals, line: baseLine });
    }

    const entriesRaw = Number(prev?.entriesCount ?? (Array.isArray(prev?.entries) ? prev.entries.length : 0));
    const entriesCount = Number.isFinite(entriesRaw) ? Math.max(0, Math.floor(entriesRaw)) : 0;
    if (entriesCount >= maxEntries) {
      const nextStrategy = {
        ...(item?.strategy ?? {}),
        agent: "overGoalsLimit",
        overGoalsLimit: {
          ...(prev ?? {}),
          phase: "max_entries",
          lastTickAt: nowIso,
          lastGoals: totalGoals,
          lastSummary: { risk, profitSum, profitTargetAbs, totalGoals, baseLine, entriesCount, maxEntries, stakePct, entryOffsetTicks, secondsToWaitMatch },
        },
      };
      const nextBetfair = { ...(item?.betfair ?? {}), overUnder: { ...ouPrev } };
      await kv.set(key, { ...item, betfair: nextBetfair, strategy: nextStrategy, updatedAt: nowIso });
      return c.json({ ok: true, matchId, phase: "max_entries", entriesCount, maxEntries, risk, profitSum, profitTargetAbs, totalGoals, line: baseLine });
    }

    let selectedOu: any = null;
    let selectedLine = baseLine;
    let selectedMarketId: string | null = null;
    let selectedOverSelectionId: number | null = null;
    let selectedOverBack: number | null = null;
    let selectedOverLay: number | null = null;
    let selectedOverTraded: number | null = null;
    let selectedUnderTraded: number | null = null;
    let selectedSpreadTicks: number | null = null;
    let selectedMarketMatched: number | null = null;
    let selectedMomentumScore: number | null = null;
    let selectedMarketMomentumScore: number | null = null;
    let selectedGameMomentumScore: number | null = null;
    let selectedPressureOk: boolean = false;
    let selectedContinuousPressure: boolean = false;
    let selectedPressureRecentDA: number | null = null;
    let selectedPressurePrevDA: number | null = null;
    let selectedPressureAccel: number | null = null;
    let selectedPressureRecentSOG: number | null = null;
    let selectedPressureRecentCorners: number | null = null;
    let selectedSteamMove: boolean = false;
    let selectedSteamDist: number | null = null;
    let selectedOkToEnter: boolean = false;

    const prevSnapshotsRaw = (prev?.lineSnapshots && typeof prev.lineSnapshots === "object") ? prev.lineSnapshots : {};
    const prevSnapshots: Record<string, any> = { ...(prevSnapshotsRaw as any) };

    const resolvedCandidates: any[] = [];
    for (const ln of candidateLines) {
      try {
        const ou = await resolveBetfairOverUnderMarket({ eventId, line: ln });
        const marketId = String(ou?.marketId ?? "").trim();
        if (!marketId) continue;
        const over = ou?.odds?.over ?? null;
        const under = ou?.odds?.under ?? null;
        const overSelectionIdRaw = Number(over?.selectionId ?? ou?.runners?.overSelectionId);
        const overSelectionId = Number.isFinite(overSelectionIdRaw) ? overSelectionIdRaw : null;
        if (!overSelectionId) continue;

        const overBack = Number.isFinite(Number(over?.back)) ? Number(over.back) : null;
        const overLay = Number.isFinite(Number(over?.lay)) ? Number(over.lay) : null;
        const spreadTicks = (typeof overBack === "number" && typeof overLay === "number") ? tickDistance(overBack, overLay) : null;
        const totalMatchedNow = Number(ou?.matchedVolume);
        const marketMatched = Number.isFinite(totalMatchedNow) ? totalMatchedNow : null;
        const overTradedNow = Number(over?.tradedVolume);
        const underTradedNow = Number(under?.tradedVolume);
        const overTraded = Number.isFinite(overTradedNow) ? overTradedNow : null;
        const underTraded = Number.isFinite(underTradedNow) ? underTradedNow : null;

        const backLadderRaw = Array.isArray(over?.backLadder) ? over.backLadder : [];
        const layLadderRaw = Array.isArray(over?.layLadder) ? over.layLadder : [];
        const sumDepth = (a: any[]) => {
          const n = a.slice(0, 6).reduce((acc: number, x: any) => acc + (Number.isFinite(Number(x?.size)) ? Number(x.size) : 0), 0);
          return Number.isFinite(n) ? round2(n) : null;
        };
        const backDepthSum = sumDepth(backLadderRaw);
        const layDepthSum = sumDepth(layLadderRaw);
        const depthImbalance =
          typeof backDepthSum === "number" && typeof layDepthSum === "number" && Number.isFinite(backDepthSum) && Number.isFinite(layDepthSum) && layDepthSum > 0
            ? round2(backDepthSum / layDepthSum)
            : null;

        const prevSnap = prevSnapshots[String(ln)] ?? {};
        const prevOverBack = Number(prevSnap?.overBack);
        const prevOverBackAtIso = String(prevSnap?.fetchedAt ?? "").trim() || null;
        const prevOverBackAtMs = prevOverBackAtIso ? new Date(prevOverBackAtIso).getTime() : 0;
        const steamDist =
          typeof overBack === "number" &&
          Number.isFinite(overBack) &&
          Number.isFinite(prevOverBack) &&
          prevOverBack > 1.01 &&
          prevOverBackAtMs &&
          Number.isFinite(prevOverBackAtMs)
            ? tickDistance(prevOverBack, overBack)
            : null;
        const steamMove =
          typeof steamDist === "number" &&
          Number.isFinite(steamDist) &&
          steamDist >= steamMoveTicks &&
          prevOverBackAtMs &&
          Number.isFinite(prevOverBackAtMs) &&
          (nowMs - prevOverBackAtMs) <= steamMoveWindowSec * 1000;

        const prevOverTraded = Number(prevSnap?.overTraded);
        const prevUnderTraded = Number(prevSnap?.underTraded);
        const deltaOver = typeof overTraded === "number" && Number.isFinite(prevOverTraded) ? round2(overTraded - prevOverTraded) : null;
        const deltaUnder = typeof underTraded === "number" && Number.isFinite(prevUnderTraded) ? round2(underTraded - prevUnderTraded) : null;

        const hasPrices = typeof overBack === "number" && typeof overLay === "number" && overBack > 1.01 && overLay > 1.01;
        const spreadOk = typeof spreadTicks === "number" && Number.isFinite(spreadTicks) ? spreadTicks <= maxSpreadTicks : false;
        const liquidityOk =
          (typeof marketMatched === "number" && Number.isFinite(marketMatched) ? marketMatched >= minMarketMatched : false) &&
          (typeof overTraded === "number" && Number.isFinite(overTraded) ? overTraded >= minRunnerMatched : false);
        const tradedOk =
          typeof deltaOver === "number" &&
          Number.isFinite(deltaOver) &&
          deltaOver >= minDeltaTraded &&
          (typeof deltaUnder !== "number" || !Number.isFinite(deltaUnder) || deltaUnder <= 0 ? true : deltaOver >= deltaUnder * dominanceRatio);
        const baseEntryPrice =
          Number.isFinite(Number(over?.back)) && Number(over?.back) > 1.01
            ? Number(over.back)
            : Number.isFinite(Number(over?.lay)) && Number(over?.lay) > 1.01
              ? Number(over.lay)
              : Number(over?.back);
        const entryPrice = applyOffsetTicks(Number(baseEntryPrice), entryOffsetTicks) ?? Number(baseEntryPrice);
        const oddsOk = Number.isFinite(entryPrice) && entryPrice >= minOdds;
        const flowOk = typeof depthImbalance === "number" && Number.isFinite(depthImbalance) ? depthImbalance >= 1.05 : false;

        const compressionTicks =
          typeof overBack === "number" && Number.isFinite(overBack) && Number.isFinite(prevOverBack) && prevOverBack > 1.01
            ? tickDistance(prevOverBack, overBack)
            : null;
        const compressionOk =
          typeof compressionTicks === "number" && Number.isFinite(compressionTicks) ? (compressionTicks > 0 && compressionTicks <= steamMoveTicks) : false;

        let marketMomentumScore = 0;
        if (hasPrices && spreadOk) marketMomentumScore += 10;
        if (liquidityOk) marketMomentumScore += 15;
        if (tradedOk) marketMomentumScore += 25;
        if (flowOk) marketMomentumScore += 15;
        if (compressionOk) marketMomentumScore += 20;
        if (steamMove) marketMomentumScore -= 25;
        if (marketMomentumScore < 0) marketMomentumScore = 0;
        if (marketMomentumScore > 100) marketMomentumScore = 100;

        const gScore = typeof gameMomentumScore === "number" && Number.isFinite(gameMomentumScore) ? gameMomentumScore : 0;
        const w = typeof gameMomentumWeight === "number" && Number.isFinite(gameMomentumWeight) ? gameMomentumWeight : 0.4;
        const combinedMomentumScore = Math.max(0, Math.min(100, Math.round((1 - w) * marketMomentumScore + w * gScore)));

        resolvedCandidates.push({
          line: ln,
          marketId,
          overSelectionId,
          overBack,
          overLay,
          overTraded,
          underTraded,
          spreadTicks,
          marketMatched,
          deltaOver,
          deltaUnder,
          depthImbalance,
          momentumScore: combinedMomentumScore,
          marketMomentumScore,
          gameMomentumScore: (typeof gameMomentumScore === "number" && Number.isFinite(gameMomentumScore)) ? gameMomentumScore : null,
          pressureOk,
          continuousPressure,
          pressureRecentDA,
          pressurePrevDA,
          pressureAccel,
          pressureRecentSOG,
          pressureRecentCorners,
          steamMove,
          steamDist,
          okToEnter: pressureOk && hasPrices && spreadOk && liquidityOk && tradedOk && oddsOk && flowOk && !steamMove,
        });
      } catch {}
    }

    if (resolvedCandidates.length === 0) {
      const nextStrategy = {
        ...(item?.strategy ?? {}),
        agent: "overGoalsLimit",
        overGoalsLimit: {
          ...(prev ?? {}),
          phase: "waiting_market",
          lastTickAt: nowIso,
          lastGoals: totalGoals,
          lastSummary: { risk, profitSum, profitTargetAbs, totalGoals, baseLine, reason: "no_candidates" },
        },
      };
      await kv.set(key, { ...item, strategy: nextStrategy, updatedAt: nowIso });
      return c.json({ ok: true, matchId, phase: "waiting_market", totalGoals, line: baseLine });
    }

    resolvedCandidates.sort((a: any, b: any) => Number(b.momentumScore ?? 0) - Number(a.momentumScore ?? 0));
    const bestOk = resolvedCandidates.find((x: any) => x.okToEnter) ?? null;
    const bestAny = resolvedCandidates[0] ?? null;
    const chosen = bestOk ?? bestAny;

    selectedOu = ouPrev[String(chosen.line)] ?? null;
    try {
      selectedOu = await resolveBetfairOverUnderMarket({ eventId, line: chosen.line });
    } catch {
      selectedOu = null;
    }
    selectedLine = Number(chosen.line);
    selectedMarketId = String(chosen.marketId);
    selectedOverSelectionId = Number(chosen.overSelectionId);
    selectedOverBack = typeof chosen.overBack === "number" ? chosen.overBack : null;
    selectedOverLay = typeof chosen.overLay === "number" ? chosen.overLay : null;
    selectedOverTraded = typeof chosen.overTraded === "number" ? chosen.overTraded : null;
    selectedUnderTraded = typeof chosen.underTraded === "number" ? chosen.underTraded : null;
    selectedSpreadTicks = typeof chosen.spreadTicks === "number" ? chosen.spreadTicks : null;
    selectedMarketMatched = typeof chosen.marketMatched === "number" ? chosen.marketMatched : null;
    selectedMomentumScore = typeof chosen.momentumScore === "number" ? chosen.momentumScore : null;
    selectedMarketMomentumScore = typeof chosen.marketMomentumScore === "number" ? chosen.marketMomentumScore : null;
    selectedGameMomentumScore = typeof chosen.gameMomentumScore === "number" ? chosen.gameMomentumScore : null;
    selectedPressureOk = Boolean(chosen.pressureOk);
    selectedContinuousPressure = Boolean(chosen.continuousPressure);
    selectedPressureRecentDA = typeof chosen.pressureRecentDA === "number" ? chosen.pressureRecentDA : null;
    selectedPressurePrevDA = typeof chosen.pressurePrevDA === "number" ? chosen.pressurePrevDA : null;
    selectedPressureAccel = typeof chosen.pressureAccel === "number" ? chosen.pressureAccel : null;
    selectedPressureRecentSOG = typeof chosen.pressureRecentSOG === "number" ? chosen.pressureRecentSOG : null;
    selectedPressureRecentCorners = typeof chosen.pressureRecentCorners === "number" ? chosen.pressureRecentCorners : null;
    selectedSteamMove = Boolean(chosen.steamMove);
    selectedSteamDist = typeof chosen.steamDist === "number" ? chosen.steamDist : null;
    selectedOkToEnter = Boolean(chosen.okToEnter);

    const ou = selectedOu;
    const marketId = selectedMarketId;
    const line = selectedLine;
    if (!marketId || !ou || typeof ou !== "object") {
      const nextStrategy = {
        ...(item?.strategy ?? {}),
        agent: "overGoalsLimit",
        overGoalsLimit: {
          ...(prev ?? {}),
          phase: "waiting_market",
          lastTickAt: nowIso,
          lastGoals: totalGoals,
          lastSummary: { risk, profitSum, profitTargetAbs, totalGoals, baseLine, reason: "resolve_failed" },
        },
      };
      await kv.set(key, { ...item, strategy: nextStrategy, updatedAt: nowIso });
      return c.json({ ok: true, matchId, phase: "waiting_market", totalGoals, line: baseLine });
    }

    const over = ou?.odds?.over ?? null;
    const under = ou?.odds?.under ?? null;
    const overSelectionId = Number(over?.selectionId ?? ou?.runners?.overSelectionId);
    const baseEntryPrice =
      Number.isFinite(Number(over?.back)) && Number(over?.back) > 1.01
        ? Number(over.back)
        : Number.isFinite(Number(over?.lay)) && Number(over?.lay) > 1.01
          ? Number(over.lay)
          : Number(over?.back);
    const entryPrice = applyOffsetTicks(Number(baseEntryPrice), entryOffsetTicks) ?? Number(baseEntryPrice);
    const overBack = Number.isFinite(Number(over?.back)) ? Number(over.back) : null;
    const overTraded = Number.isFinite(Number(over?.tradedVolume)) ? Number(over.tradedVolume) : selectedOverTraded;
    const underTraded = Number.isFinite(Number(under?.tradedVolume)) ? Number(under.tradedVolume) : selectedUnderTraded;

    const prevSnapThis = prevSnapshots[String(line)] ?? {};
    const prevOverTraded = Number(prevSnapThis?.overTraded);
    const prevUnderTraded = Number(prevSnapThis?.underTraded);
    const deltaOver = typeof overTraded === "number" && Number.isFinite(prevOverTraded) ? round2(overTraded - prevOverTraded) : null;
    const deltaUnder = typeof underTraded === "number" && Number.isFinite(prevUnderTraded) ? round2(underTraded - prevUnderTraded) : null;

    const volumeOk = Boolean(selectedOkToEnter);

    const oddsOk = Number.isFinite(entryPrice) && entryPrice >= minOdds;

    const listThis = await betfairJsonRpcTrading({
      method: "SportsAPING/v1.0/listCurrentOrders",
      params: { marketIds: [marketId] },
      sessionToken,
    });
    const ordersThis = Array.isArray(listThis?.currentOrders) ? listThis.currentOrders : [];
    const openOrdersCount = ordersThis.filter((o: any) => Number(o?.sizeRemaining ?? 0) > 0).length;
    const matchedBetsCount = ordersThis.filter((o: any) => Number(o?.sizeMatched ?? 0) > 0).length;
    const hasExistingPosition = openOrdersCount > 0 || matchedBetsCount > 0;
    const maxRiskAbs = bankrollTotal > 0 ? round2(bankrollTotal * maxRiskPct) : round2(bankroll * maxRiskPct);
    const riskOk = !(typeof maxRiskAbs === "number" && Number.isFinite(maxRiskAbs) && maxRiskAbs > 0) ? true : risk < maxRiskAbs;

    let placed: any = null;
    let repriced: any = null;
    let exitPlaced: any = null;
    let phase = phasePrev;

    const cancelOrder = async (mid: string, betId: string) => {
      const bid = String(betId ?? "").trim();
      if (!bid) return null;
      return await betfairJsonRpcTrading({
        method: "SportsAPING/v1.0/cancelOrders",
        params: { marketId: mid, instructions: [{ betId: bid }] },
        sessionToken,
      });
    };

    const openEntry = ordersThis.find((o: any) => {
      const side = String(o?.side ?? "").toUpperCase();
      const sizeMatched = Number(o?.sizeMatched ?? 0);
      const sizeRemaining = Number(o?.sizeRemaining ?? 0);
      return side === "BACK" && (!Number.isFinite(sizeMatched) || sizeMatched <= 0) && Number.isFinite(sizeRemaining) && sizeRemaining > 0 && String(o?.betId ?? "").trim();
    }) ?? null;

    const prevHoldUntilIso = String(prev?.holdUntil ?? "").trim() || null;
    const prevHoldUntilMs = prevHoldUntilIso ? new Date(prevHoldUntilIso).getTime() : 0;
    let holdUntilNext = prevHoldUntilIso;

    const ordersForSel = ordersThis.filter((o: any) => Number(o?.selectionId) === Number(overSelectionId));
    const entryBack = ordersForSel.find((o: any) => String(o?.side ?? "").toUpperCase() === "BACK") ?? null;
    const exitLay = ordersForSel.find((o: any) => String(o?.side ?? "").toUpperCase() === "LAY") ?? null;
    const entryMatchedNow = entryBack ? Number(entryBack?.sizeMatched ?? 0) : 0;
    const exitMatchedNow = exitLay ? Number(exitLay?.sizeMatched ?? 0) : 0;
    const entryRemainingNow = entryBack ? Number(entryBack?.sizeRemaining ?? 0) : 0;
    const exitRemainingNow = exitLay ? Number(exitLay?.sizeRemaining ?? 0) : 0;
    const hasMatchedExposure = (Number.isFinite(entryMatchedNow) ? entryMatchedNow > 0 : false) || (Number.isFinite(matchedBetsCount) ? matchedBetsCount > 0 : false);

    if (!hasMatchedExposure) {
      holdUntilNext = null;
    } else if ((!prevHoldUntilMs || !Number.isFinite(prevHoldUntilMs)) && isInPlay) {
      const holdSec = randSeconds(timeExitMinSec, timeExitMaxSec);
      holdUntilNext = new Date(nowMs + holdSec * 1000).toISOString();
    }
    const timeExitHit = hasMatchedExposure && prevHoldUntilMs && Number.isFinite(prevHoldUntilMs) ? nowMs > prevHoldUntilMs : false;

    let handledPosition = false;
    if (timeExitHit) {
      try {
        await cashoutMarket(marketId);
      } catch {}
      phase = "time_exit";
      handledPosition = true;
    } else if (entryBack && Number.isFinite(entryMatchedNow) && entryMatchedNow > 0) {
      const avg = Number(entryBack?.averagePriceMatched);
      const entryPx = Number.isFinite(avg) && avg > 1.01 ? avg : Number(entryBack?.priceSize?.price);
      const canScalpExit =
        mode === "scalp" ||
        (mode === "hybrid" &&
          !selectedContinuousPressure &&
          !(typeof selectedMomentumScore === "number" && selectedMomentumScore >= swingMomentumScore));
      if (!exitLay && canScalpExit && Number.isFinite(entryPx) && entryPx > 1.01) {
        const exitPrice = tickDown(entryPx, targetTicks);
        if (Number.isFinite(exitPrice) && exitPrice > 1.01 && exitPrice < entryPx) {
          const laySizeRaw = (entryMatchedNow * entryPx) / exitPrice;
          const laySize = round2(clamp(laySizeRaw, 2, 10_000));
          try {
            const res = await betfairJsonRpcTrading({
              method: "SportsAPING/v1.0/placeOrders",
              params: {
                marketId,
                instructions: [{ selectionId: overSelectionId, side: "LAY", orderType: "LIMIT", limitOrder: { size: laySize, price: exitPrice, persistenceType: "LAPSE" } }],
                customerRef: `OG_EXT_${String(Math.round(line * 10)).padStart(2, "0")}_${matchId}_${Date.now()}`.slice(0, 32),
                async: false,
              },
              sessionToken,
            });
            exitPlaced = { marketId, line, selectionId: overSelectionId, side: "LAY", size: laySize, price: exitPrice, result: res };
            phase = "exit_placed";
          } catch {
            phase = "exit_failed";
          }
        } else {
          phase = "exit_skipped";
        }
      } else if (!exitLay && mode === "hybrid" && (selectedContinuousPressure || (typeof selectedMomentumScore === "number" && selectedMomentumScore >= swingMomentumScore))) {
        phase = selectedContinuousPressure ? "swing_hold_pressure" : "swing_hold";
      } else {
        phase = "waiting_exit";
      }
      handledPosition = true;
    } else if (entryBack && exitLay) {
      if (entryMatchedNow > 0 && exitMatchedNow > 0 && entryRemainingNow <= 0 && exitRemainingNow <= 0) {
        phase = "cycle_done";
      } else {
        phase = "waiting_exit";
      }
      handledPosition = true;
    }

    if (!handledPosition && !riskOk && !hasExistingPosition && !openEntry) {
      phase = "max_risk";
      handledPosition = true;
    }

    if (!handledPosition && openEntry) {
      const waitMs = Math.max(1_000, Math.floor(secondsToWaitMatch * 1000));
      const placedIso = String(openEntry?.placedDate ?? "").trim();
      const placedMs = placedIso ? new Date(placedIso).getTime() : 0;
      const shouldReprice = !placedMs || !Number.isFinite(placedMs) ? true : Date.now() - placedMs >= waitMs;
      const betId = String(openEntry?.betId ?? "").trim();
      const sizeRemaining = Number(openEntry?.sizeRemaining ?? 0);

      if (shouldReprice && betId && Number.isFinite(sizeRemaining) && sizeRemaining >= 2) {
        try {
          await cancelOrder(marketId, betId);
        } catch {}
        if (volumeOk && oddsOk && Number.isFinite(overSelectionId)) {
          const res = await betfairJsonRpcTrading({
            method: "SportsAPING/v1.0/placeOrders",
            params: {
              marketId,
              instructions: [{ selectionId: overSelectionId, side: "BACK", orderType: "LIMIT", limitOrder: { size: round2(sizeRemaining), price: entryPrice, persistenceType: "LAPSE" } }],
              customerRef: `OG_RE_${String(Math.round(line * 10)).padStart(2, "0")}_${matchId}_${Date.now()}`.slice(0, 32),
              async: false,
            },
            sessionToken,
          });
          repriced = { marketId, line, selectionId: overSelectionId, side: "BACK", stake: round2(sizeRemaining), price: entryPrice, result: res };
          phase = "entry_repriced";
        } else {
          phase = volumeOk && !oddsOk ? "odds_below_min" : "waiting_signal";
        }
      } else {
        phase = "waiting_match";
      }
    } else if (!handledPosition && hasExistingPosition) {
      phase = matchedBetsCount > 0 ? "adopted_existing" : "waiting_match";
    } else if (!handledPosition && riskOk && volumeOk && oddsOk && Number.isFinite(overSelectionId)) {
      const stake = round2(clamp(stakeBankroll / maxEntries, 2, stakeBankroll));
      const res = await betfairJsonRpcTrading({
        method: "SportsAPING/v1.0/placeOrders",
        params: {
          marketId,
          instructions: [{ selectionId: overSelectionId, side: "BACK", orderType: "LIMIT", limitOrder: { size: stake, price: entryPrice, persistenceType: "LAPSE" } }],
          customerRef: `OG_${String(Math.round(line * 10)).padStart(2, "0")}_${matchId}_${Date.now()}`.slice(0, 32),
          async: false,
        },
        sessionToken,
      });
      placed = { marketId, line, selectionId: overSelectionId, side: "BACK", stake, price: entryPrice, result: res };
      phase = "entered";
      enteredSet.add(marketId);
    } else if (!handledPosition) {
      phase = volumeOk && !oddsOk ? "odds_below_min" : "waiting_signal";
    }

    const nextEntries = Array.isArray(prev?.entries) ? prev.entries : [];
    const didAddEntry = Boolean(placed);
    const didReprice = Boolean(repriced);
    const nextEntriesCount = didAddEntry ? entriesCount + 1 : entriesCount;
    const entries = didAddEntry || didReprice
      ? nextEntries.concat([
          {
            marketId,
            line,
            stake: didReprice ? repriced.stake : placed.stake,
            price: didReprice ? repriced.price : placed.price,
            placedAt: new Date().toISOString(),
            deltaOver,
            deltaUnder,
            overTraded: Number.isFinite(overTraded) ? overTraded : null,
            underTraded: Number.isFinite(underTraded) ? underTraded : null,
            minOdds,
            minDeltaTraded,
            dominanceRatio,
            stakePct,
            entryOffsetTicks,
            secondsToWaitMatch,
            mode,
            targetTicks,
          },
        ])
      : nextEntries;

    const nextStrategy = {
      ...(item?.strategy ?? {}),
      agent: "overGoalsLimit",
      overGoalsLimit: {
        ...(prev ?? {}),
        phase,
        lastTickAt: nowIso,
        lastEntryAt: placed ? nowIso : lastEntryAt || null,
        holdUntil: holdUntilNext,
        lastGoals: totalGoals,
        entriesCount: nextEntriesCount,
        enteredMarketIds: Array.from(enteredSet).slice(0, 10),
        entries,
        lastMarket: {
          marketId,
          line,
          overBack: Number.isFinite(overBack) ? overBack : null,
          overTraded: Number.isFinite(overTraded) ? round2(overTraded) : null,
          underTraded: Number.isFinite(underTraded) ? round2(underTraded) : null,
          fetchedAt: nowIso,
        },
        lineSnapshots: {
          ...prevSnapshots,
          [String(line)]: {
            marketId,
            overTraded,
            underTraded,
            overBack,
            fetchedAt: nowIso,
          },
        },
        pressureSnapshot: stats
          ? {
              ...stats,
              dangerousAttacksTotal: curDA,
              attacksTotal: curAtt,
              shotsOnGoalTotal: curSOG,
              cornersTotal: curCorners,
              deltaDangerousAttacks: dDA,
              deltaAttacks: dAtt,
              deltaShotsOnGoal: dSOG,
              deltaCorners: dCorners,
              momentumScore: gameMomentumScore,
              pressureOk,
              continuousPressure,
              pressureRecentDA,
              pressurePrevDA,
              pressureAccel,
              pressureRecentSOG,
              pressureRecentCorners,
              pressureRecentSec,
              pressureTotalSec,
              computedAt: nowIso,
            }
          : prevPressure,
        pressureSeries,
        lastSummary: {
          risk,
          maxRiskAbs,
          riskOk,
          profitSum,
          profitTargetAbs,
          totalGoals,
          line,
          marketId,
          openOrdersCount,
          matchedBetsCount,
          volumeOk,
          oddsOk,
          deltaOver,
          deltaUnder,
          stakePct,
          entryOffsetTicks,
          secondsToWaitMatch,
          mode,
          targetTicks,
          maxSpreadTicks,
          minMarketMatched,
          minRunnerMatched,
          spreadTicks: selectedSpreadTicks,
          marketMatched: selectedMarketMatched,
          momentumScore: selectedMomentumScore,
          marketMomentumScore: selectedMarketMomentumScore,
          gameMomentumScore: selectedGameMomentumScore,
          pressureOk: selectedPressureOk,
          continuousPressure: selectedContinuousPressure,
          pressureRecentDA: selectedPressureRecentDA,
          pressurePrevDA: selectedPressurePrevDA,
          pressureAccel: selectedPressureAccel,
          pressureRecentSOG: selectedPressureRecentSOG,
          pressureRecentCorners: selectedPressureRecentCorners,
          dangerousAttacksTotal: curDA,
          attacksTotal: curAtt,
          shotsOnGoalTotal: curSOG,
          cornersTotal: curCorners,
          deltaDangerousAttacks: dDA,
          deltaAttacks: dAtt,
          deltaShotsOnGoal: dSOG,
          deltaCorners: dCorners,
          minDangerousAttacks,
          minShotsOnGoal,
          minCorners,
          minAttacks,
          gameMomentumWeight,
          pressureRecentSec,
          pressureTotalSec,
          pressureMinDeltaCorners,
          pressureMinDeltaSog,
          pressureMinDeltaDangerousAttacks,
          pressureAccelRatio,
          steamMove: selectedSteamMove,
          steamDist: selectedSteamDist,
          okToEnter: selectedOkToEnter,
          holdUntil: holdUntilNext,
          timeExitHit,
          entryMatched: Number.isFinite(entryMatchedNow) ? entryMatchedNow : null,
          exitMatched: Number.isFinite(exitMatchedNow) ? exitMatchedNow : null,
        },
      },
    };
    const nextBetfair = { ...(item?.betfair ?? {}), overUnder: { ...ouPrev, [String(line)]: ou } };
    await kv.set(key, { ...item, betfair: nextBetfair, strategy: nextStrategy, updatedAt: nowIso });

    return c.json({
      ok: true,
      matchId,
      phase,
      totalGoals,
      line,
      marketId,
      volumeOk,
      oddsOk,
      deltaOver,
      deltaUnder,
      openOrdersCount,
      matchedBetsCount,
      entriesCount: nextEntriesCount,
      maxEntries,
      risk,
      profitSum,
      profitTargetAbs,
      profitByMarket,
      placed,
      repriced,
      exitPlaced,
    });
  } catch (error) {
    return c.json({ ok: false, error: error.message || "Erro no robô Over Gols Limite" }, 500);
  }
};

const betfairAsianHandicapTickHandler = async (c: any) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  const adminError = requireAutomationAdmin(c);
  if (adminError) return adminError;
  try {
    const body = await c.req.json().catch(() => ({}));
    const matchId = String(body?.matchId ?? "").trim();
    if (!matchId) return c.json({ ok: false, error: "matchId obrigatório" }, 400);

    const cfg = (body?.config && typeof body.config === "object") ? body.config : {};
    const bankrollRaw = Number(cfg?.bankroll ?? 50);
    const bankroll = Number.isFinite(bankrollRaw) ? clamp(bankrollRaw, 2, 10_000) : 50;
    const bankrollTotalRaw = Number(cfg?.bankrollTotal ?? 0);
    const bankrollTotal = Number.isFinite(bankrollTotalRaw) ? clamp(bankrollTotalRaw, 0, 10_000_000) : 0;
    const stakePctRaw = Number(cfg?.stakePct ?? 1);
    const stakePct = Number.isFinite(stakePctRaw) ? clamp(stakePctRaw, 0.01, 1) : 1;
    const stakeBankroll = round2(clamp(bankroll * stakePct, 2, bankroll));
    const profitTargetPctRaw = Number(cfg?.profitTargetPct ?? 0.03);
    const profitTargetPct = Number.isFinite(profitTargetPctRaw) ? clamp(profitTargetPctRaw, 0.001, 0.5) : 0.03;
    const maxRiskPctRaw = Number(cfg?.maxRiskPct ?? 0.03);
    const maxRiskPct = Number.isFinite(maxRiskPctRaw) ? clamp(maxRiskPctRaw, 0, 1) : 0.03;
    const maxEntriesRaw = Number(cfg?.maxEntries ?? 5);
    const maxEntries = Number.isFinite(maxEntriesRaw) ? clamp(Math.floor(maxEntriesRaw), 1, 20) : 5;
    const minSecondsBetweenEntriesRaw = Number(cfg?.minSecondsBetweenEntries ?? 30);
    const minSecondsBetweenEntries = Number.isFinite(minSecondsBetweenEntriesRaw) ? clamp(Math.floor(minSecondsBetweenEntriesRaw), 0, 600) : 30;
    const entryOffsetTicksRaw = Number(cfg?.entryOffsetTicks ?? 2);
    const entryOffsetTicks = Number.isFinite(entryOffsetTicksRaw) ? clamp(Math.trunc(entryOffsetTicksRaw), -10, 10) : 2;
    const targetTicksRaw = Number(cfg?.targetTicks ?? 10);
    const targetTicks = Number.isFinite(targetTicksRaw) ? clamp(Math.floor(targetTicksRaw), 1, 50) : 10;
    const timeExitMinSecRaw = Number(cfg?.timeExitMinSec ?? 30);
    const timeExitMinSec = Number.isFinite(timeExitMinSecRaw) ? clamp(Math.floor(timeExitMinSecRaw), 1, 600) : 30;
    const timeExitMaxSecRaw = Number(cfg?.timeExitMaxSec ?? 90);
    const timeExitMaxSec = Number.isFinite(timeExitMaxSecRaw) ? clamp(Math.floor(timeExitMaxSecRaw), timeExitMinSec, 900) : 90;
    const postGoalWaitMinSecRaw = Number(cfg?.postGoalWaitMinSec ?? 60);
    const postGoalWaitMinSec = Number.isFinite(postGoalWaitMinSecRaw) ? clamp(Math.floor(postGoalWaitMinSecRaw), 0, 600) : 60;
    const postGoalWaitMaxSecRaw = Number(cfg?.postGoalWaitMaxSec ?? 120);
    const postGoalWaitMaxSec = Number.isFinite(postGoalWaitMaxSecRaw) ? clamp(Math.floor(postGoalWaitMaxSecRaw), postGoalWaitMinSec, 900) : 120;
    const steamMoveTicksRaw = Number(cfg?.steamMoveTicks ?? 10);
    const steamMoveTicks = Number.isFinite(steamMoveTicksRaw) ? clamp(Math.floor(steamMoveTicksRaw), 1, 50) : 10;
    const steamMoveWindowSecRaw = Number(cfg?.steamMoveWindowSec ?? 3);
    const steamMoveWindowSec = Number.isFinite(steamMoveWindowSecRaw) ? clamp(Math.floor(steamMoveWindowSecRaw), 1, 30) : 3;
    const maxSpreadTicksRaw = Number(cfg?.maxSpreadTicks ?? 2);
    const maxSpreadTicks = Number.isFinite(maxSpreadTicksRaw) ? clamp(Math.floor(maxSpreadTicksRaw), 0, 10) : 2;
    const minMarketMatchedRaw = Number(cfg?.minMarketMatched ?? 120_000);
    const minMarketMatched = Number.isFinite(minMarketMatchedRaw) ? clamp(minMarketMatchedRaw, 0, 10_000_000) : 120_000;
    const minRunnerMatchedRaw = Number(cfg?.minRunnerMatched ?? 20_000);
    const minRunnerMatched = Number.isFinite(minRunnerMatchedRaw) ? clamp(minRunnerMatchedRaw, 0, 10_000_000) : 20_000;
    const maxAbsLineRaw = Number(cfg?.maxAbsLine ?? 2);
    const maxAbsLine = Number.isFinite(maxAbsLineRaw) ? clamp(Math.round(maxAbsLineRaw * 4) / 4, 0, 10) : 2;
    const ladderDepthLevelsRaw = Number(cfg?.ladderDepthLevels ?? 10);
    const ladderDepthLevels = Number.isFinite(ladderDepthLevelsRaw) ? clamp(Math.floor(ladderDepthLevelsRaw), 1, 50) : 10;
    const flowImbalanceRatioRaw = Number(cfg?.flowImbalanceRatio ?? 1.12);
    const flowImbalanceRatio = Number.isFinite(flowImbalanceRatioRaw) ? clamp(flowImbalanceRatioRaw, 1.01, 10) : 1.12;
    const minLadderDepthSumRaw = Number(cfg?.minLadderDepthSum ?? 250);
    const minLadderDepthSum = Number.isFinite(minLadderDepthSumRaw) ? clamp(minLadderDepthSumRaw, 0, 1_000_000) : 250;
    const modeRaw = String(cfg?.mode ?? "hybrid").trim().toLowerCase();
    const mode = modeRaw === "swing" ? "swing" : modeRaw === "scalp" ? "scalp" : "hybrid";
    const swingMomentumScoreRaw = Number(cfg?.swingMomentumScore ?? 75);
    const swingMomentumScore = Number.isFinite(swingMomentumScoreRaw) ? clamp(Math.floor(swingMomentumScoreRaw), 1, 100) : 75;
    const allowWindowsRaw = Boolean(cfg?.allowWindows ?? true);
    const windowMinMinRaw = Number(cfg?.windowMinMin ?? 15);
    const windowMinMin = Number.isFinite(windowMinMinRaw) ? clamp(Math.floor(windowMinMinRaw), 0, 200) : 15;
    const windowMaxMinRaw = Number(cfg?.windowMaxMin ?? 80);
    const windowMaxMin = Number.isFinite(windowMaxMinRaw) ? clamp(Math.floor(windowMaxMinRaw), windowMinMin, 200) : 80;
    const minDangerousAttacksRaw = Number(cfg?.minDangerousAttacks ?? 15);
    const minDangerousAttacks = Number.isFinite(minDangerousAttacksRaw) ? clamp(Math.floor(minDangerousAttacksRaw), 0, 500) : 15;
    const minShotsOnGoalRaw = Number(cfg?.minShotsOnGoal ?? 3);
    const minShotsOnGoal = Number.isFinite(minShotsOnGoalRaw) ? clamp(Math.floor(minShotsOnGoalRaw), 0, 100) : 3;
    const minCornersRaw = Number(cfg?.minCorners ?? 2);
    const minCorners = Number.isFinite(minCornersRaw) ? clamp(Math.floor(minCornersRaw), 0, 50) : 2;
    const minAttacksRaw = Number(cfg?.minAttacks ?? 60);
    const minAttacks = Number.isFinite(minAttacksRaw) ? clamp(Math.floor(minAttacksRaw), 0, 500) : 60;
    const gameMomentumWeightRaw = Number(cfg?.gameMomentumWeight ?? 0.4);
    const gameMomentumWeight = Number.isFinite(gameMomentumWeightRaw) ? clamp(gameMomentumWeightRaw, 0, 1) : 0.4;
    const pressureRecentSecRaw = Number(cfg?.pressureRecentSec ?? 60);
    const pressureRecentSec = Number.isFinite(pressureRecentSecRaw) ? clamp(Math.floor(pressureRecentSecRaw), 10, 600) : 60;
    const pressureTotalSecRaw = Number(cfg?.pressureTotalSec ?? 120);
    const pressureTotalSec = Number.isFinite(pressureTotalSecRaw) ? clamp(Math.floor(pressureTotalSecRaw), pressureRecentSec, 900) : 120;
    const pressureMinDeltaCornersRaw = Number(cfg?.pressureMinDeltaCorners ?? 1);
    const pressureMinDeltaCorners = Number.isFinite(pressureMinDeltaCornersRaw) ? clamp(Math.floor(pressureMinDeltaCornersRaw), 0, 20) : 1;
    const pressureMinDeltaSogRaw = Number(cfg?.pressureMinDeltaSog ?? 1);
    const pressureMinDeltaSog = Number.isFinite(pressureMinDeltaSogRaw) ? clamp(Math.floor(pressureMinDeltaSogRaw), 0, 20) : 1;
    const pressureMinDeltaDangerousAttacksRaw = Number(cfg?.pressureMinDeltaDangerousAttacks ?? 6);
    const pressureMinDeltaDangerousAttacks = Number.isFinite(pressureMinDeltaDangerousAttacksRaw) ? clamp(Math.floor(pressureMinDeltaDangerousAttacksRaw), 0, 200) : 6;
    const pressureAccelRatioRaw = Number(cfg?.pressureAccelRatio ?? 1.3);
    const pressureAccelRatio = Number.isFinite(pressureAccelRatioRaw) ? clamp(pressureAccelRatioRaw, 0.5, 10) : 1.3;

    const stepsForPrice = (p: number) => {
      if (p < 2) return 0.01;
      if (p < 3) return 0.02;
      if (p < 4) return 0.05;
      if (p < 6) return 0.1;
      if (p < 10) return 0.2;
      if (p < 20) return 0.5;
      if (p < 30) return 1;
      if (p < 50) return 2;
      if (p < 100) return 5;
      return 10;
    };
    const roundPrice = (p: number) => round2(p);
    const tickUpOnce = (p: number) => roundPrice(p + stepsForPrice(p));
    const tickDownOnce = (p: number) => {
      const s = stepsForPrice(p);
      const next = p - s;
      return roundPrice(next < 1.01 ? 1.01 : next);
    };
    const tickUp = (p: number, n: number) => {
      let v = p;
      for (let i = 0; i < n; i += 1) v = tickUpOnce(v);
      return v;
    };
    const tickDown = (p: number, n: number) => {
      let v = p;
      for (let i = 0; i < n; i += 1) v = tickDownOnce(v);
      return v;
    };
    const applyOffsetTicks = (p: number, ticks: number) => {
      if (!Number.isFinite(p) || p <= 1.01) return null;
      if (!Number.isFinite(ticks) || ticks === 0) return roundPrice(p);
      const t = Math.trunc(ticks);
      return t > 0 ? tickUp(p, t) : tickDown(p, Math.abs(t));
    };
    const tickDistance = (from: number, to: number) => {
      if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 1.01 || to <= 1.01) return null;
      if (from === to) return 0;
      let steps = 0;
      if (to > from) {
        let v = from;
        while (v < to && steps < 2000) {
          v = tickUpOnce(v);
          steps += 1;
        }
        return steps;
      }
      let v = from;
      while (v > to && steps < 2000) {
        v = tickDownOnce(v);
        steps += 1;
      }
      return steps;
    };

    const key = `${BETFAIR_QUEUE_PREFIX}${matchId}`;
    const item = (await kv.get(key)) ?? null;
    if (!item) return c.json({ ok: false, error: "Item não encontrado na fila" }, 404);

    const agentRaw = String(item?.strategy?.agent ?? "").trim().toLowerCase();
    const agent =
      agentRaw === "asianhandicap" || agentRaw === "asian_handicap" || agentRaw === "handicap_asiatico" || agentRaw === "handicapasiatico"
        ? "asianHandicap"
        : agentRaw === "overgoalslimit" || agentRaw === "over_goals_limit" || agentRaw === "over_goals"
          ? "overGoalsLimit"
          : agentRaw === "scalpinggoals" || agentRaw === "scalping_goals"
            ? "scalpingGoals"
            : agentRaw === "scalpingticks" || agentRaw === "scalping_ticks"
              ? "scalpingTicks"
              : "correctScore";
    if (agent !== "asianHandicap") return c.json({ ok: false, error: "Robô não é Handicap Asiático" }, 400);

    const betfair = item?.betfair ?? null;
    let eventId = String(betfair?.eventId ?? "").trim();
    if (!eventId && String(item?.homeTeam ?? "").trim() && String(item?.awayTeam ?? "").trim()) {
      try {
        const mapped = await resolveBetfairMatchOdds({ homeTeam: String(item.homeTeam), awayTeam: String(item.awayTeam), utcDate: item?.utcDate });
        eventId = String(mapped?.eventId ?? "").trim();
        item.betfair = { ...(item?.betfair ?? {}), ...mapped };
      } catch {}
    }
    if (!eventId) return c.json({ ok: false, error: "Betfair: eventId não resolvido" }, 400);

    const nowIso = new Date().toISOString();
    const nowMs = Date.now();

    const liveRaw = (body?.live && typeof body.live === "object") ? body.live : null;
    const liveGoalsHome = Number(liveRaw?.goalsHome);
    const liveGoalsAway = Number(liveRaw?.goalsAway);
    const scoreHome = Number.isFinite(liveGoalsHome) ? liveGoalsHome : (Number.isFinite(Number(item?.scoreHome)) ? Number(item.scoreHome) : 0);
    const scoreAway = Number.isFinite(liveGoalsAway) ? liveGoalsAway : (Number.isFinite(Number(item?.scoreAway)) ? Number(item.scoreAway) : 0);
    const totalGoals = Math.max(0, Math.floor(scoreHome)) + Math.max(0, Math.floor(scoreAway));
    const scoreDiff = Math.max(-20, Math.min(20, Math.floor(scoreHome) - Math.floor(scoreAway)));
    const elapsedMinRaw = Number(liveRaw?.elapsed ?? item?.live?.elapsed);
    const elapsedMin = Number.isFinite(elapsedMinRaw) ? Math.max(0, Math.floor(elapsedMinRaw)) : null;

    const prev = (item?.strategy?.asianHandicap && typeof item.strategy.asianHandicap === "object") ? item.strategy.asianHandicap : {};
    const phasePrev = String(prev?.phase ?? "").trim() || "idle";
    const closedAt = String(prev?.closedAt ?? "").trim() || null;
    if (closedAt || phasePrev.startsWith("closed")) {
      return c.json({ ok: true, matchId, phase: phasePrev || "closed", totalGoals });
    }

    const enteredPrevRaw = Array.isArray(prev?.enteredMarketIds) ? prev.enteredMarketIds : [];
    const enteredPrev = enteredPrevRaw.map((x: any) => String(x ?? "").trim()).filter((x: any) => x);
    const enteredSet = new Set<string>(enteredPrev);
    const marketIdsForRisk = Array.from(enteredSet).slice(0, 10);

    const randSeconds = (min: number, max: number) => {
      const a = Number.isFinite(min) ? Math.max(0, Math.floor(min)) : 0;
      const b = Number.isFinite(max) ? Math.max(a, Math.floor(max)) : a;
      if (a === b) return a;
      return a + Math.floor(Math.random() * (b - a + 1));
    };

    const prevGoalsRaw = Number(prev?.lastGoals);
    const prevGoals = Number.isFinite(prevGoalsRaw) ? Math.max(0, Math.floor(prevGoalsRaw)) : null;
    const prevCooldownIso = String(prev?.cooldownUntil ?? "").trim() || null;
    const prevCooldownMs = prevCooldownIso ? new Date(prevCooldownIso).getTime() : 0;

    if (prevCooldownMs && Number.isFinite(prevCooldownMs) && nowMs < prevCooldownMs) {
      const nextStrategy = {
        ...(item?.strategy ?? {}),
        agent: "asianHandicap",
        asianHandicap: {
          ...(prev ?? {}),
          phase: "cooldown",
          lastGoals: totalGoals,
          cooldownUntil: prevCooldownIso,
          lastTickAt: nowIso,
          lastSummary: { totalGoals, reason: "cooldown_until", cooldownUntil: prevCooldownIso },
        },
      };
      await kv.set(key, { ...item, strategy: nextStrategy, updatedAt: nowIso });
      return c.json({ ok: true, matchId, phase: "cooldown", totalGoals, cooldownUntil: prevCooldownIso });
    }

    const sessionToken = await getBetfairSessionToken();

    const calcRisk = (orders: any[]) => {
      return round2(
        orders.reduce((acc: number, o: any) => {
          const side = String(o?.side ?? "").trim().toUpperCase();
          const price = Number(o?.priceSize?.price);
          const sizeRemaining = Number(o?.sizeRemaining);
          const sizeMatched = Number(o?.sizeMatched);
          const size = (Number.isFinite(sizeRemaining) ? sizeRemaining : 0) + (Number.isFinite(sizeMatched) ? sizeMatched : 0);
          if (!Number.isFinite(size) || size <= 0) return acc;
          if (side === "LAY") {
            if (!Number.isFinite(price) || price <= 1.01) return acc;
            return acc + size * (price - 1);
          }
          return acc + size;
        }, 0),
      );
    };

    const calcWorstProfit = async (mid: string) => {
      const pnlRes = await betfairJsonRpcTrading({
        method: "SportsAPING/v1.0/listMarketProfitAndLoss",
        params: { marketIds: [mid], includeSettledBets: false, includeBspBets: false, netOfCommission: true },
        sessionToken,
      });
      const mk = Array.isArray(pnlRes) ? pnlRes[0] : null;
      const pnlList = Array.isArray(mk?.profitAndLosses)
        ? mk.profitAndLosses
        : Array.isArray(mk?.profitAndLoss)
          ? mk.profitAndLoss
          : [];
      const values = pnlList.map((x: any) => Number(x?.ifWin)).filter((v: any) => typeof v === "number" && Number.isFinite(v));
      return values.length > 0 ? round2(values.reduce((m: number, v: number) => (v < m ? v : m), values[0])) : null;
    };

    const cashoutMarket = async (mid: string) => {
      const listRes = await betfairJsonRpcTrading({
        method: "SportsAPING/v1.0/listCurrentOrders",
        params: { marketIds: [mid] },
        sessionToken,
      });
      const orders = Array.isArray(listRes?.currentOrders) ? listRes.currentOrders : [];
      const toCancel = orders.filter((o: any) => Number(o?.sizeRemaining ?? 0) > 0 && String(o?.betId ?? "").trim()).map((o: any) => String(o.betId));
      if (toCancel.length > 0) {
        await betfairJsonRpcTrading({
          method: "SportsAPING/v1.0/cancelOrders",
          params: { marketId: mid, instructions: toCancel.map((betId: string) => ({ betId })) },
          sessionToken,
        });
      }

      const book = await betfairJsonRpc({
        method: "SportsAPING/v1.0/listMarketBook",
        params: {
          marketIds: [mid],
          priceProjection: { priceData: ["EX_BEST_OFFERS"], virtualise: true },
        },
        sessionToken,
      });
      const book0 = Array.isArray(book) ? book[0] : book;
      const runners = Array.isArray(book0?.runners) ? book0.runners : [];
      const bySelection = new Map<number, any>();
      for (const r of runners) {
        const sid = Number(r?.selectionId);
        if (!Number.isFinite(sid)) continue;
        const ex = r?.ex ?? {};
        const back0 = Array.isArray(ex?.availableToBack) ? ex.availableToBack[0] : null;
        const lay0 = Array.isArray(ex?.availableToLay) ? ex.availableToLay[0] : null;
        bySelection.set(sid, { bestBack: back0 ? Number(back0.price) : null, bestLay: lay0 ? Number(lay0.price) : null });
      }

      const hedgeInstructions: any[] = [];
      for (const o of orders) {
        const sizeMatched = Number(o?.sizeMatched ?? 0);
        if (!Number.isFinite(sizeMatched) || sizeMatched <= 0) continue;
        const selectionId = Number(o?.selectionId);
        if (!Number.isFinite(selectionId)) continue;
        const side = String(o?.side ?? "").toUpperCase();
        const px = bySelection.get(selectionId) ?? {};
        if (side === "BACK") {
          const layPrice = Number(px?.bestLay);
          if (!Number.isFinite(layPrice) || layPrice <= 1.01) continue;
          hedgeInstructions.push({ selectionId, side: "LAY", orderType: "LIMIT", limitOrder: { size: round2(sizeMatched), price: layPrice, persistenceType: "LAPSE" } });
        } else if (side === "LAY") {
          const backPrice = Number(px?.bestBack);
          if (!Number.isFinite(backPrice) || backPrice <= 1.01) continue;
          hedgeInstructions.push({ selectionId, side: "BACK", orderType: "LIMIT", limitOrder: { size: round2(sizeMatched), price: backPrice, persistenceType: "LAPSE" } });
        }
      }

      let hedgeResult: any = null;
      if (hedgeInstructions.length > 0) {
        hedgeResult = await betfairJsonRpcTrading({
          method: "SportsAPING/v1.0/placeOrders",
          params: { marketId: mid, instructions: hedgeInstructions.slice(0, 50), customerRef: `AH_CASH_${matchId}_${Date.now()}`.slice(0, 32), async: false },
          sessionToken,
        });
      }
      return { cancelledCount: toCancel.length, hedgedCount: hedgeInstructions.length, hedgeResult };
    };

    const goalsChanged = prevGoals != null && totalGoals !== prevGoals;
    if (goalsChanged && marketIdsForRisk.length > 0) {
      const cashouted: any[] = [];
      for (const mid of marketIdsForRisk) {
        try {
          const r = await cashoutMarket(mid);
          cashouted.push({ marketId: mid, ...r });
        } catch (e) {
          cashouted.push({ marketId: mid, error: e instanceof Error ? e.message : String(e) });
        }
      }
      const waitSec = randSeconds(postGoalWaitMinSec, postGoalWaitMaxSec);
      const cooldownUntil = new Date(nowMs + waitSec * 1000).toISOString();
      const nextStrategy = {
        ...(item?.strategy ?? {}),
        agent: "asianHandicap",
        asianHandicap: {
          ...(prev ?? {}),
          phase: "post_goal_wait",
          lastGoals: totalGoals,
          cooldownUntil,
          lastTickAt: nowIso,
          lastSummary: { totalGoals, reason: "goal_changed", waitSec, cooldownUntil, cashoutedCount: cashouted.length },
        },
      };
      await kv.set(key, { ...item, strategy: nextStrategy, updatedAt: nowIso });
      return c.json({ ok: true, matchId, phase: "post_goal_wait", totalGoals, cooldownUntil, cashouted });
    }

    const listAll = await betfairJsonRpcTrading({
      method: "SportsAPING/v1.0/listCurrentOrders",
      params: { marketIds: marketIdsForRisk },
      sessionToken,
    });
    const ordersAll = Array.isArray(listAll?.currentOrders) ? listAll.currentOrders : [];
    const risk = calcRisk(ordersAll);
    const maxRiskAbs = round2((bankrollTotal > 0 ? bankrollTotal : bankroll) * maxRiskPct);
    const riskOk = maxRiskAbs <= 0 ? true : risk <= maxRiskAbs;

    const profitByMarket: any[] = [];
    let profitSum = 0;
    for (const mid of marketIdsForRisk) {
      try {
        const p = await calcWorstProfit(mid);
        profitByMarket.push({ marketId: mid, profit: p });
        if (typeof p === "number" && Number.isFinite(p)) profitSum += p;
      } catch {
        profitByMarket.push({ marketId: mid, profit: null });
      }
    }
    profitSum = round2(profitSum);
    const profitTargetAbs = bankrollTotal > 0 ? round2(bankrollTotal * profitTargetPct) : round2(bankroll * profitTargetPct);
    const shouldCloseProfit = profitTargetAbs > 0 && profitSum >= profitTargetAbs;
    if (shouldCloseProfit && risk > 0 && marketIdsForRisk.length > 0) {
      const cashouted: any[] = [];
      for (const mid of marketIdsForRisk) {
        try {
          const r = await cashoutMarket(mid);
          cashouted.push({ marketId: mid, ...r });
        } catch (e) {
          cashouted.push({ marketId: mid, error: e instanceof Error ? e.message : String(e) });
        }
      }
      const nextStrategy = {
        ...(item?.strategy ?? {}),
        agent: "asianHandicap",
        asianHandicap: {
          ...(prev ?? {}),
          phase: "closed_profit_target",
          closedAt: nowIso,
          lastTickAt: nowIso,
          lastGoals: totalGoals,
          lastSummary: { risk, profitSum, profitTargetAbs, totalGoals, reason: "profit_target" },
        },
      };
      await kv.set(key, { ...item, strategy: nextStrategy, updatedAt: nowIso });
      return c.json({ ok: true, matchId, phase: "closed_profit_target", totalGoals, risk, profitSum, profitTargetAbs, cashouted });
    }

    const statsRaw = (body?.stats && typeof body.stats === "object") ? body.stats : null;
    const safeNum = (v: any) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const stats = statsRaw
      ? {
          fetchedAt: String(statsRaw?.fetchedAt ?? nowIso).trim() || nowIso,
          dangerousAttacksHome: safeNum(statsRaw?.dangerousAttacksHome),
          dangerousAttacksAway: safeNum(statsRaw?.dangerousAttacksAway),
          attacksHome: safeNum(statsRaw?.attacksHome),
          attacksAway: safeNum(statsRaw?.attacksAway),
          shotsOnGoalHome: safeNum(statsRaw?.shotsOnGoalHome),
          shotsOnGoalAway: safeNum(statsRaw?.shotsOnGoalAway),
          cornersHome: safeNum(statsRaw?.cornersHome),
          cornersAway: safeNum(statsRaw?.cornersAway),
          cardsHome: safeNum(statsRaw?.cardsHome),
          cardsAway: safeNum(statsRaw?.cardsAway),
        }
      : null;

    const prevPressure = (prev?.pressureSnapshot && typeof prev.pressureSnapshot === "object") ? prev.pressureSnapshot : null;
    const prevPressureAtIso = String(prevPressure?.fetchedAt ?? "").trim() || null;
    const prevPressureAtMs = prevPressureAtIso ? new Date(prevPressureAtIso).getTime() : 0;
    const curPressureAtIso = stats ? String(stats.fetchedAt) : nowIso;
    const curPressureAtMs = new Date(curPressureAtIso).getTime();
    const snapAgeSec =
      prevPressureAtMs && Number.isFinite(prevPressureAtMs) && Number.isFinite(curPressureAtMs) && curPressureAtMs >= prevPressureAtMs
        ? (curPressureAtMs - prevPressureAtMs) / 1000
        : null;
    const withinPressureWindow = typeof snapAgeSec === "number" && Number.isFinite(snapAgeSec) ? snapAgeSec <= 180 : false;

    const sum2 = (a: number | null, b: number | null) => (typeof a === "number" ? a : 0) + (typeof b === "number" ? b : 0);
    const curDA = stats ? sum2(stats.dangerousAttacksHome, stats.dangerousAttacksAway) : null;
    const curAtt = stats ? sum2(stats.attacksHome, stats.attacksAway) : null;
    const curSOG = stats ? sum2(stats.shotsOnGoalHome, stats.shotsOnGoalAway) : null;
    const curCorners = stats ? sum2(stats.cornersHome, stats.cornersAway) : null;

    const prevDA = withinPressureWindow ? safeNum(prevPressure?.dangerousAttacksTotal) : null;
    const prevAtt = withinPressureWindow ? safeNum(prevPressure?.attacksTotal) : null;
    const prevSOG = withinPressureWindow ? safeNum(prevPressure?.shotsOnGoalTotal) : null;
    const prevCorners = withinPressureWindow ? safeNum(prevPressure?.cornersTotal) : null;

    const dDA = typeof curDA === "number" && typeof prevDA === "number" ? Math.max(0, curDA - prevDA) : null;
    const dAtt = typeof curAtt === "number" && typeof prevAtt === "number" ? Math.max(0, curAtt - prevAtt) : null;
    const dSOG = typeof curSOG === "number" && typeof prevSOG === "number" ? Math.max(0, curSOG - prevSOG) : null;
    const dCorners = typeof curCorners === "number" && typeof prevCorners === "number" ? Math.max(0, curCorners - prevCorners) : null;

    let gameMomentumScore: number | null = null;
    let pressureOk = false;
    if (stats && typeof curDA === "number" && typeof curAtt === "number" && typeof curSOG === "number" && typeof curCorners === "number") {
      const base =
        Math.min(40, curDA * 1.2) +
        Math.min(30, curSOG * 6) +
        Math.min(20, curCorners * 2.5) +
        Math.min(10, curAtt / 10);
      let bonus = 0;
      if (typeof dDA === "number" && dDA >= 4) bonus += 10;
      if (typeof dSOG === "number" && dSOG >= 1) bonus += 10;
      if (typeof dCorners === "number" && dCorners >= 1) bonus += 6;
      const score = Math.max(0, Math.min(100, Math.round(base + bonus)));
      gameMomentumScore = score;
      pressureOk =
        curDA >= minDangerousAttacks &&
        curSOG >= minShotsOnGoal &&
        (curCorners >= minCorners || curAtt >= minAttacks) &&
        (typeof dDA !== "number" ? true : dDA >= 1);
    }

    const prevSeriesRaw = Array.isArray(prev?.pressureSeries) ? prev.pressureSeries : [];
    const prevSeries = prevSeriesRaw
      .filter((x: any) => x && typeof x === "object" && String((x as any)?.at ?? "").trim())
      .map((x: any) => ({
        at: String(x.at),
        dDA: Number(x?.dDA),
        dSOG: Number(x?.dSOG),
        dCorners: Number(x?.dCorners),
      }))
      .filter((x: any) => Number.isFinite(new Date(String(x.at)).getTime()));
    const seriesWindowStartMs = nowMs - pressureTotalSec * 1000;
    const seriesFiltered = prevSeries.slice(-80).filter((x: any) => {
      const ms = new Date(String(x.at)).getTime();
      return Number.isFinite(ms) && ms >= seriesWindowStartMs;
    });
    const sampleNow =
      stats && (typeof dDA === "number" || typeof dSOG === "number" || typeof dCorners === "number")
        ? {
            at: curPressureAtIso,
            dDA: typeof dDA === "number" && Number.isFinite(dDA) ? dDA : 0,
            dSOG: typeof dSOG === "number" && Number.isFinite(dSOG) ? dSOG : 0,
            dCorners: typeof dCorners === "number" && Number.isFinite(dCorners) ? dCorners : 0,
          }
        : null;
    const pressureSeries = (sampleNow ? seriesFiltered.concat([sampleNow]) : seriesFiltered).slice(-120);

    const recentStartMs = nowMs - pressureRecentSec * 1000;
    const prevStartMs = nowMs - pressureTotalSec * 1000;
    const prevEndMs = recentStartMs;
    const recent = pressureSeries.filter((x: any) => {
      const ms = new Date(String(x.at)).getTime();
      return Number.isFinite(ms) && ms >= recentStartMs;
    });
    const previous = pressureSeries.filter((x: any) => {
      const ms = new Date(String(x.at)).getTime();
      return Number.isFinite(ms) && ms >= prevStartMs && ms < prevEndMs;
    });
    const sum = (arr: any[], key: "dDA" | "dSOG" | "dCorners") =>
      arr.reduce((acc: number, x: any) => acc + (Number.isFinite(Number(x?.[key])) ? Number(x[key]) : 0), 0);
    const pressureRecentDA = round2(sum(recent, "dDA"));
    const pressurePrevDA = round2(sum(previous, "dDA"));
    const pressureRecentSOG = round2(sum(recent, "dSOG"));
    const pressureRecentCorners = round2(sum(recent, "dCorners"));
    const pressureAccel = pressurePrevDA > 0 ? round2(pressureRecentDA / pressurePrevDA) : null;
    const pressureAccelOk = pressureAccel == null ? pressureRecentDA >= pressureMinDeltaDangerousAttacks : pressureAccel >= pressureAccelRatio;
    const continuousPressure =
      pressureOk &&
      recent.length >= 2 &&
      pressureRecentCorners >= pressureMinDeltaCorners &&
      pressureRecentSOG >= pressureMinDeltaSog &&
      pressureRecentDA >= pressureMinDeltaDangerousAttacks &&
      pressureAccelOk;
    if (continuousPressure && typeof gameMomentumScore === "number" && Number.isFinite(gameMomentumScore)) {
      gameMomentumScore = Math.min(100, gameMomentumScore + 10);
    }

    const inWindow = allowWindows && typeof elapsedMin === "number" ? elapsedMin >= windowMinMin && elapsedMin <= windowMaxMin : true;

    const homeOdds = Number(item?.betfair?.odds?.home?.back);
    const awayOdds = Number(item?.betfair?.odds?.away?.back);
    const favoriteSide =
      Number.isFinite(homeOdds) && Number.isFinite(awayOdds) ? (homeOdds <= awayOdds ? "home" : "away") : "home";
    const favoriteTrailing = favoriteSide === "home" ? scoreDiff < 0 : scoreDiff > 0;
    const favoriteLeading = favoriteSide === "home" ? scoreDiff > 0 : scoreDiff < 0;

    const prefSetHomeLines = (() => {
      if (favoriteSide === "home") {
        if (favoriteTrailing) return [0, 0.25, 0.5, 1, -0.25, 1.5, 2];
        if (favoriteLeading) return [-0.5, -1, -0.25, -1.5, -2, 0];
        return [-0.25, -0.5, 0, -1];
      }
      if (favoriteTrailing) return [0, -0.25, -0.5, -1, 0.25, -1.5, -2];
      if (favoriteLeading) return [0.5, 1, 0.25, 1.5, 2, 0];
      return [0.25, 0.5, 0, 1];
    })()
      .map((x) => Math.round(Number(x) * 4) / 4)
      .filter((x) => Number.isFinite(x) && Math.abs(x) <= maxAbsLine);

    const desiredHomeLines = Array.from(new Set(prefSetHomeLines));
    if (desiredHomeLines.length === 0) return c.json({ ok: true, matchId, phase: "skip_line", totalGoals, reason: "Sem linhas candidatas" });

    const parseLine = (marketName: string) => {
      const s = String(marketName ?? "").trim();
      if (!s) return null;
      const m = s.match(/([+-]?\d+(?:\.\d+)?)/);
      if (!m) return null;
      const n = Number(m[1]);
      if (!Number.isFinite(n)) return null;
      return Math.round(n * 4) / 4;
    };
    const norm = (s: string) => String(s ?? "").trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

    const cat = await betfairJsonRpc({
      method: "SportsAPING/v1.0/listMarketCatalogue",
      params: {
        filter: { eventIds: [eventId], marketTypeCodes: ["ASIAN_HANDICAP", "ASIAN_HANDICAP_DOUBLE_LINE"] },
        maxResults: 40,
        marketProjection: ["RUNNER_DESCRIPTION", "MARKET_START_TIME"],
      },
      sessionToken,
    });
    const catArr = Array.isArray(cat) ? cat : [];
    const homeName = norm(String(item?.homeTeam ?? ""));
    const awayName = norm(String(item?.awayTeam ?? ""));
    const markets = catArr
      .map((m: any) => {
        const marketId = String(m?.marketId ?? "").trim();
        const marketName = String(m?.marketName ?? "").trim();
        if (!marketId) return null;
        const line = parseLine(marketName);
        if (line == null) return null;
        if (!desiredHomeLines.some((x) => Math.abs(x - line) < 0.001)) return null;
        return { marketId, marketName, line, runners: Array.isArray(m?.runners) ? m.runners : [] };
      })
      .filter((x: any) => x);

    if (markets.length === 0) {
      const nextStrategy = {
        ...(item?.strategy ?? {}),
        agent: "asianHandicap",
        asianHandicap: {
          ...(prev ?? {}),
          phase: "skip_no_market",
          lastGoals: totalGoals,
          lastTickAt: nowIso,
          pressureSnapshot: stats
            ? {
                ...stats,
                dangerousAttacksTotal: curDA,
                attacksTotal: curAtt,
                shotsOnGoalTotal: curSOG,
                cornersTotal: curCorners,
                deltaDangerousAttacks: dDA,
                deltaAttacks: dAtt,
                deltaShotsOnGoal: dSOG,
                deltaCorners: dCorners,
                momentumScore: gameMomentumScore,
                pressureOk,
                continuousPressure,
                pressureRecentDA,
                pressurePrevDA,
                pressureAccel,
                pressureRecentSOG,
                pressureRecentCorners,
                pressureRecentSec,
                pressureTotalSec,
                computedAt: nowIso,
              }
            : prevPressure,
          pressureSeries,
          lastSummary: { totalGoals, favoriteSide, scoreDiff, elapsedMin, reason: "no_markets" },
        },
      };
      await kv.set(key, { ...item, strategy: nextStrategy, updatedAt: nowIso });
      return c.json({ ok: true, matchId, phase: "skip_no_market", totalGoals, desiredHomeLines });
    }

    const marketIds = markets.map((m: any) => String(m.marketId));
    const books = await betfairJsonRpc({
      method: "SportsAPING/v1.0/listMarketBook",
      params: {
        marketIds,
        priceProjection: { priceData: ["EX_BEST_OFFERS", "EX_TRADED"], virtualise: true, bestPricesDepth: ladderDepthLevels },
      },
      sessionToken,
    });
    const booksArr = Array.isArray(books) ? books : [];
    const bookById = new Map<string, any>();
    for (const b of booksArr) {
      const mid = String(b?.marketId ?? "").trim();
      if (!mid) continue;
      bookById.set(mid, b);
    }

    const resolveTeamSids = (m: any) => {
      const rr = Array.isArray(m?.runners) ? m.runners : [];
      let homeSel: number | null = null;
      let awaySel: number | null = null;
      for (const r of rr) {
        const sid = Number(r?.selectionId);
        const rn = norm(String(r?.runnerName ?? ""));
        if (!Number.isFinite(sid)) continue;
        if (!homeSel && homeName && rn.includes(homeName)) homeSel = sid;
        if (!awaySel && awayName && rn.includes(awayName)) awaySel = sid;
      }
      if (homeSel == null || awaySel == null) {
        const rr2 = rr.filter((r: any) => Number.isFinite(Number(r?.selectionId)));
        if (rr2.length >= 2) {
          const sid0 = Number(rr2[0].selectionId);
          const sid1 = Number(rr2[1].selectionId);
          if (homeSel == null) homeSel = Number.isFinite(sid0) ? sid0 : homeSel;
          if (awaySel == null) awaySel = Number.isFinite(sid1) ? sid1 : awaySel;
        }
      }
      return { homeSel, awaySel };
    };

    const prevBestBack = Number(prev?.lastBestBack);
    const prevBestBackAtIso = String(prev?.lastBestBackAt ?? "").trim();
    const prevBestBackAtMs = prevBestBackAtIso ? new Date(prevBestBackAtIso).getTime() : 0;
    const prevBestBackMarketId = String(prev?.lastBestBackMarketId ?? "").trim() || null;
    const prevBestBackSelectionId = Number(prev?.lastBestBackSelectionId);
    const steamRefOk =
      Number.isFinite(prevBestBack) &&
      prevBestBack > 1.01 &&
      prevBestBackAtMs &&
      Number.isFinite(prevBestBackAtMs) &&
      nowMs - prevBestBackAtMs <= steamMoveWindowSec * 1000;

    const candidates: any[] = [];
    for (const m of markets) {
      const mid = String(m.marketId);
      const book = bookById.get(mid) ?? null;
      const totalMatched = Number(book?.totalMatched);
      const matchedVolume = Number.isFinite(totalMatched) ? round2(totalMatched) : null;
      const marketStatus = String(book?.status ?? "").trim() || null;
      const isClosed = String(marketStatus ?? "").toUpperCase() === "CLOSED";
      const inPlay = isClosed ? false : Boolean(book?.inplay ?? false);
      const publishTime = book?.publishTime ? String(book.publishTime) : null;

      const { homeSel, awaySel } = resolveTeamSids(m);
      const favSel = favoriteSide === "home" ? homeSel : awaySel;
      if (!favSel) continue;

      const runnersBook = Array.isArray(book?.runners) ? book.runners : [];
      const rb = runnersBook.find((x: any) => Number(x?.selectionId) === Number(favSel)) ?? null;
      const ex = rb?.ex ?? {};
      const back0 = Array.isArray(ex?.availableToBack) ? ex.availableToBack[0] : null;
      const lay0 = Array.isArray(ex?.availableToLay) ? ex.availableToLay[0] : null;
      const bestBack = back0 ? Number(back0.price) : null;
      const bestLay = lay0 ? Number(lay0.price) : null;
      const backLadder = Array.isArray(ex?.availableToBack) ? ex.availableToBack.slice(0, ladderDepthLevels) : [];
      const layLadder = Array.isArray(ex?.availableToLay) ? ex.availableToLay.slice(0, ladderDepthLevels) : [];
      const backDepthSum = round2(backLadder.reduce((acc: number, x: any) => acc + (Number.isFinite(Number(x?.size)) ? Number(x.size) : 0), 0));
      const layDepthSum = round2(layLadder.reduce((acc: number, x: any) => acc + (Number.isFinite(Number(x?.size)) ? Number(x.size) : 0), 0));
      const depthImbalance = layDepthSum > 0 ? round2(backDepthSum / layDepthSum) : null;

      const traded = Array.isArray(ex?.tradedVolume) ? ex.tradedVolume : [];
      const tradedVolume = round2(traded.reduce((acc: number, t: any) => acc + (Number.isFinite(Number(t?.size)) ? Number(t.size) : 0), 0));

      const spreadTicks =
        Number.isFinite(bestBack) && Number.isFinite(bestLay) ? tickDistance(Number(bestBack), Number(bestLay)) : null;

      const hasPrices = Number.isFinite(bestBack) && Number.isFinite(bestLay) && Number(bestBack) > 1.01 && Number(bestLay) > 1.01;
      const spreadOk = typeof spreadTicks === "number" ? spreadTicks <= maxSpreadTicks : false;
      const liquidityOk = (matchedVolume != null ? matchedVolume >= minMarketMatched : false) && tradedVolume >= minRunnerMatched;
      const depthOk = backDepthSum >= minLadderDepthSum || layDepthSum >= minLadderDepthSum;
      const flowOk = depthOk && (depthImbalance == null ? false : depthImbalance >= flowImbalanceRatio);

      const steamMove =
        steamRefOk &&
        prevBestBackMarketId &&
        prevBestBackMarketId === mid &&
        Number.isFinite(prevBestBackSelectionId) &&
        Number(prevBestBackSelectionId) === Number(favSel) &&
        Number.isFinite(bestBack) &&
        bestBack > 1.01
          ? (() => {
              const dist = tickDistance(Number(prevBestBack), Number(bestBack));
              return typeof dist === "number" && dist >= steamMoveTicks;
            })()
          : false;
      const steamDist =
        steamMove && Number.isFinite(bestBack) && Number.isFinite(prevBestBack) ? tickDistance(Number(prevBestBack), Number(bestBack)) : null;

      let marketMomentumScore = 0;
      if (hasPrices && spreadOk) marketMomentumScore += 15;
      if (liquidityOk) marketMomentumScore += 25;
      if (flowOk) marketMomentumScore += 25;
      if (!steamMove) marketMomentumScore += 10;
      if (inPlay) marketMomentumScore += 5;
      if (!inWindow) marketMomentumScore -= 25;
      marketMomentumScore = Math.max(0, Math.min(100, Math.round(marketMomentumScore)));

      const gScore = typeof gameMomentumScore === "number" && Number.isFinite(gameMomentumScore) ? gameMomentumScore : 0;
      const w = typeof gameMomentumWeight === "number" && Number.isFinite(gameMomentumWeight) ? gameMomentumWeight : 0.4;
      const momentumScore = Math.max(0, Math.min(100, Math.round((1 - w) * marketMomentumScore + w * gScore)));

      const okToEnter = inWindow && riskOk && pressureOk && hasPrices && spreadOk && liquidityOk && flowOk && !steamMove;
      candidates.push({
        marketId: mid,
        lineHome: m.line,
        favored: favoriteSide,
        selectionId: Number(favSel),
        bestBack,
        bestLay,
        spreadTicks,
        tradedVolume,
        matchedVolume,
        depthImbalance,
        backDepthSum,
        layDepthSum,
        marketStatus,
        inPlay,
        publishTime,
        marketMomentumScore,
        gameMomentumScore,
        momentumScore,
        pressureOk,
        continuousPressure,
        steamMove,
        steamDist,
        okToEnter,
      });
    }

    if (candidates.length === 0) {
      const nextStrategy = {
        ...(item?.strategy ?? {}),
        agent: "asianHandicap",
        asianHandicap: {
          ...(prev ?? {}),
          phase: "skip_no_candidates",
          lastGoals: totalGoals,
          lastTickAt: nowIso,
          pressureSnapshot: stats
            ? {
                ...stats,
                dangerousAttacksTotal: curDA,
                attacksTotal: curAtt,
                shotsOnGoalTotal: curSOG,
                cornersTotal: curCorners,
                deltaDangerousAttacks: dDA,
                deltaAttacks: dAtt,
                deltaShotsOnGoal: dSOG,
                deltaCorners: dCorners,
                momentumScore: gameMomentumScore,
                pressureOk,
                continuousPressure,
                pressureRecentDA,
                pressurePrevDA,
                pressureAccel,
                pressureRecentSOG,
                pressureRecentCorners,
                pressureRecentSec,
                pressureTotalSec,
                computedAt: nowIso,
              }
            : prevPressure,
          pressureSeries,
          lastSummary: { totalGoals, favoriteSide, scoreDiff, elapsedMin, reason: "no_candidates" },
        },
      };
      await kv.set(key, { ...item, strategy: nextStrategy, updatedAt: nowIso });
      return c.json({ ok: true, matchId, phase: "skip_no_candidates", totalGoals, desiredHomeLines });
    }

    candidates.sort((a: any, b: any) => (Number(b.momentumScore) || 0) - (Number(a.momentumScore) || 0));
    const chosen = candidates[0];

    const chosenMarketId = String(chosen.marketId);
    if (!enteredSet.has(chosenMarketId)) marketIdsForRisk.unshift(chosenMarketId);
    const marketIdsForRiskFinal = Array.from(new Set(marketIdsForRisk)).slice(0, 10);

    const listChosen = await betfairJsonRpcTrading({
      method: "SportsAPING/v1.0/listCurrentOrders",
      params: { marketIds: [chosenMarketId] },
      sessionToken,
    });
    const ordersChosen = Array.isArray(listChosen?.currentOrders) ? listChosen.currentOrders : [];
    const openOrdersCount = ordersChosen.filter((o: any) => Number(o?.sizeRemaining ?? 0) > 0).length;
    const matchedBetsCount = ordersChosen.filter((o: any) => Number(o?.sizeMatched ?? 0) > 0).length;

    const entriesCountPrev = Number(prev?.entriesCount);
    const entriesCount = Number.isFinite(entriesCountPrev) ? entriesCountPrev : 0;
    const lastEntryAtIso = String(prev?.lastEntryAt ?? "").trim() || null;
    const lastEntryAtMs = lastEntryAtIso ? new Date(lastEntryAtIso).getTime() : 0;
    const canReenterByTime = lastEntryAtMs ? (nowMs - lastEntryAtMs) / 1000 >= minSecondsBetweenEntries : true;

    let phase = "idle";
    let placed: any = null;
    let exitPlaced: any = null;
    let cashouted: any = null;
    let holdUntilNext: string | null = String(prev?.holdUntil ?? "").trim() || null;
    const holdUntilMs = holdUntilNext ? new Date(holdUntilNext).getTime() : 0;
    const entryMatchedNow = ordersChosen.filter((o: any) => String(o?.side ?? "").toUpperCase() === "BACK").reduce((acc: number, o: any) => acc + (Number.isFinite(Number(o?.sizeMatched)) ? Number(o.sizeMatched) : 0), 0);

    if (holdUntilMs && Number.isFinite(holdUntilMs) && nowMs > holdUntilMs && matchedBetsCount > 0) {
      const r = await cashoutMarket(chosenMarketId);
      cashouted = r;
      phase = "time_exit";
      holdUntilNext = null;
    } else if (matchedBetsCount === 0 && openOrdersCount === 0 && entriesCount < maxEntries && canReenterByTime && Boolean(chosen.okToEnter)) {
      const entryPx = Number(chosen.bestBack);
      const px = Number.isFinite(entryPx) ? (applyOffsetTicks(entryPx, entryOffsetTicks) ?? entryPx) : null;
      if (px && Number.isFinite(px) && px > 1.01) {
        const instructions = [
          {
            selectionId: Number(chosen.selectionId),
            side: "BACK",
            orderType: "LIMIT",
            limitOrder: { size: stakeBankroll, price: px, persistenceType: "LAPSE" },
          },
        ];
        placed = await betfairJsonRpcTrading({
          method: "SportsAPING/v1.0/placeOrders",
          params: { marketId: chosenMarketId, instructions, customerRef: `AH_ENT_${matchId}_${Date.now()}`.slice(0, 32), async: false },
          sessionToken,
        });
        phase = "entered";
      } else {
        phase = "skip_bad_price";
      }
    } else if (matchedBetsCount > 0) {
      if (!holdUntilNext) {
        const waitSec = randSeconds(timeExitMinSec, timeExitMaxSec);
        holdUntilNext = new Date(nowMs + waitSec * 1000).toISOString();
      }

      const entryOrder = ordersChosen.find((o: any) => String(o?.side ?? "").toUpperCase() === "BACK" && Number(o?.sizeMatched ?? 0) > 0) ?? null;
      const entryPx = Number(entryOrder?.averagePriceMatched ?? entryOrder?.priceSize?.price);
      const entrySz = Number(entryOrder?.sizeMatched ?? entryOrder?.priceSize?.size);

      const alreadyHasExit = ordersChosen.some((o: any) => String(o?.side ?? "").toUpperCase() === "LAY" && Number(o?.sizeRemaining ?? 0) > 0);
      const shouldHoldSwing = mode === "swing" || (mode === "hybrid" && (Boolean(chosen.continuousPressure) || (typeof chosen.momentumScore === "number" && chosen.momentumScore >= swingMomentumScore)));

      if (!alreadyHasExit && !shouldHoldSwing && Number.isFinite(entryPx) && entryPx > 1.01 && Number.isFinite(entrySz) && entrySz > 0) {
        const targetLay = tickDown(entryPx, targetTicks);
        const instructions = [
          {
            selectionId: Number(chosen.selectionId),
            side: "LAY",
            orderType: "LIMIT",
            limitOrder: { size: round2(entrySz), price: targetLay, persistenceType: "LAPSE" },
          },
        ];
        exitPlaced = await betfairJsonRpcTrading({
          method: "SportsAPING/v1.0/placeOrders",
          params: { marketId: chosenMarketId, instructions, customerRef: `AH_EXT_${matchId}_${Date.now()}`.slice(0, 32), async: false },
          sessionToken,
        });
        phase = "exit_placed";
      } else {
        phase = shouldHoldSwing ? (chosen.continuousPressure ? "swing_hold_pressure" : "swing_hold") : "waiting_exit";
      }
    } else {
      phase = chosen.okToEnter ? "waiting_entry" : "blocked";
    }

    const nextEntriesCount = phase === "entered" ? entriesCount + 1 : entriesCount;
    const nextStrategy = {
      ...(item?.strategy ?? {}),
      agent: "asianHandicap",
      asianHandicap: {
        ...(prev ?? {}),
        phase,
        lastTickAt: nowIso,
        lastGoals: totalGoals,
        enteredMarketIds: Array.from(new Set(enteredPrev.concat(chosenMarketId))),
        entriesCount: nextEntriesCount,
        lastEntryAt: phase === "entered" ? nowIso : lastEntryAtIso,
        holdUntil: holdUntilNext,
        lastBestBack: Number.isFinite(Number(chosen.bestBack)) ? Number(chosen.bestBack) : null,
        lastBestBackAt: nowIso,
        lastBestBackMarketId: chosenMarketId,
        lastBestBackSelectionId: Number(chosen.selectionId),
        pressureSnapshot: stats
          ? {
              ...stats,
              dangerousAttacksTotal: curDA,
              attacksTotal: curAtt,
              shotsOnGoalTotal: curSOG,
              cornersTotal: curCorners,
              deltaDangerousAttacks: dDA,
              deltaAttacks: dAtt,
              deltaShotsOnGoal: dSOG,
              deltaCorners: dCorners,
              momentumScore: gameMomentumScore,
              pressureOk,
              continuousPressure,
              pressureRecentDA,
              pressurePrevDA,
              pressureAccel,
              pressureRecentSOG,
              pressureRecentCorners,
              pressureRecentSec,
              pressureTotalSec,
              computedAt: nowIso,
            }
          : prevPressure,
        pressureSeries,
        lastMarket: {
          marketId: chosenMarketId,
          lineHome: chosen.lineHome,
          selectionId: chosen.selectionId,
          bestBack: chosen.bestBack ?? null,
          bestLay: chosen.bestLay ?? null,
          spreadTicks: chosen.spreadTicks ?? null,
          tradedVolume: chosen.tradedVolume ?? null,
          matchedVolume: chosen.matchedVolume ?? null,
          inPlay: chosen.inPlay ?? null,
          marketStatus: chosen.marketStatus ?? null,
          fetchedAt: nowIso,
        },
        lastSummary: {
          totalGoals,
          scoreHome,
          scoreAway,
          scoreDiff,
          elapsedMin,
          favoriteSide,
          inWindow,
          stakePct,
          stakeBankroll,
          entryOffsetTicks,
          targetTicks,
          mode,
          swingMomentumScore,
          risk,
          maxRiskAbs,
          riskOk,
          profitSum,
          profitTargetAbs,
          chosen: {
            marketId: chosenMarketId,
            lineHome: chosen.lineHome,
            selectionId: chosen.selectionId,
            bestBack: chosen.bestBack,
            bestLay: chosen.bestLay,
            spreadTicks: chosen.spreadTicks,
            matchedVolume: chosen.matchedVolume,
            tradedVolume: chosen.tradedVolume,
            depthImbalance: chosen.depthImbalance,
            marketMomentumScore: chosen.marketMomentumScore,
            gameMomentumScore: chosen.gameMomentumScore,
            momentumScore: chosen.momentumScore,
            pressureOk: chosen.pressureOk,
            continuousPressure: chosen.continuousPressure,
            steamMove: chosen.steamMove,
            steamDist: chosen.steamDist,
            okToEnter: chosen.okToEnter,
          },
        },
      },
    };
    await kv.set(key, { ...item, strategy: nextStrategy, updatedAt: nowIso });

    return c.json({
      ok: true,
      matchId,
      phase,
      totalGoals,
      scoreHome,
      scoreAway,
      elapsedMin,
      favoriteSide,
      lineHome: chosen.lineHome,
      marketId: chosenMarketId,
      selectionId: chosen.selectionId,
      spreadTicks: chosen.spreadTicks,
      matchedVolume: chosen.matchedVolume,
      tradedVolume: chosen.tradedVolume,
      depthImbalance: chosen.depthImbalance,
      pressureOk,
      continuousPressure,
      entriesCount: nextEntriesCount,
      maxEntries,
      risk,
      profitSum,
      profitTargetAbs,
      placed,
      exitPlaced,
      cashouted,
      marketIdsForRisk: marketIdsForRiskFinal,
    });
  } catch (error) {
    return c.json({ ok: false, error: error.message || "Erro no robô Handicap Asiático" }, 500);
  }
};

const betfairScalpingTicksTickHandler = async (c: any) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  const adminError = requireAutomationAdmin(c);
  if (adminError) return adminError;
  try {
    const body = await c.req.json().catch(() => ({}));
    const matchId = String(body?.matchId ?? "").trim();
    if (!matchId) return c.json({ ok: false, error: "matchId obrigatório" }, 400);

    const cfg = (body?.config && typeof body.config === "object") ? body.config : {};
    const bankrollRaw = Number(cfg?.bankroll ?? 50);
    const bankroll = Number.isFinite(bankrollRaw) ? clamp(bankrollRaw, 2, 10_000) : 50;
    const targetTicksRaw = Number(cfg?.targetTicks ?? 10);
    const targetTicks = Number.isFinite(targetTicksRaw) ? clamp(Math.floor(targetTicksRaw), 1, 50) : 10;
    const entryOffsetTicksRaw = Number(cfg?.entryOffsetTicks ?? 2);
    const entryOffsetTicks = Number.isFinite(entryOffsetTicksRaw) ? clamp(Math.trunc(entryOffsetTicksRaw), -10, 10) : 2;
    const maxSpreadTicksRaw = Number(cfg?.maxSpreadTicks ?? 2);
    const maxSpreadTicks = Number.isFinite(maxSpreadTicksRaw) ? clamp(Math.floor(maxSpreadTicksRaw), 0, 10) : 2;
    const minSecondsBetweenCyclesRaw = Number(cfg?.minSecondsBetweenCycles ?? 8);
    const minSecondsBetweenCycles = Number.isFinite(minSecondsBetweenCyclesRaw) ? clamp(Math.floor(minSecondsBetweenCyclesRaw), 0, 600) : 8;
    const stakePctRaw = Number(cfg?.stakePct ?? 1);
    const stakePct = Number.isFinite(stakePctRaw) ? clamp(stakePctRaw, 0.01, 1) : 1;
    const secondsToWaitMatchRaw = Number(cfg?.secondsToWaitMatch ?? 10);
    const secondsToWaitMatch = Number.isFinite(secondsToWaitMatchRaw) ? clamp(Math.floor(secondsToWaitMatchRaw), 1, 120) : 10;
    const maxCyclesRaw = Number(cfg?.maxCycles ?? 50);
    const maxCycles = Number.isFinite(maxCyclesRaw) ? clamp(Math.floor(maxCyclesRaw), 1, 500) : 50;
    const maxLinesToScanRaw = Number(cfg?.maxLinesToScan ?? 4);
    const maxLinesToScan = Number.isFinite(maxLinesToScanRaw) ? clamp(Math.floor(maxLinesToScanRaw), 1, 10) : 4;
    const minDeltaTradedRaw = Number(cfg?.minDeltaTraded ?? 40);
    const minDeltaTraded = Number.isFinite(minDeltaTradedRaw) ? clamp(minDeltaTradedRaw, 0, 1_000_000) : 40;
    const dominanceRatioRaw = Number(cfg?.dominanceRatio ?? 1.15);
    const dominanceRatio = Number.isFinite(dominanceRatioRaw) ? clamp(dominanceRatioRaw, 0.5, 10) : 1.15;
    const dangerMinDeltaTradedRaw = Number(cfg?.dangerMinDeltaTraded ?? 120);
    const dangerMinDeltaTraded = Number.isFinite(dangerMinDeltaTradedRaw) ? clamp(dangerMinDeltaTradedRaw, 0, 1_000_000) : 120;
    const dangerDominanceRatioRaw = Number(cfg?.dangerDominanceRatio ?? 1.3);
    const dangerDominanceRatio = Number.isFinite(dangerDominanceRatioRaw) ? clamp(dangerDominanceRatioRaw, 0.5, 10) : 1.3;
    const stopLossTicksRaw = Number(cfg?.stopLossTicks ?? 8);
    const stopLossTicks = Number.isFinite(stopLossTicksRaw) ? clamp(Math.floor(stopLossTicksRaw), 1, 50) : 8;
    const minMarketMatchedRaw = Number(cfg?.minMarketMatched ?? 80_000);
    const minMarketMatched = Number.isFinite(minMarketMatchedRaw) ? clamp(minMarketMatchedRaw, 0, 10_000_000) : 80_000;
    const minRunnerMatchedRaw = Number(cfg?.minRunnerMatched ?? 15_000);
    const minRunnerMatched = Number.isFinite(minRunnerMatchedRaw) ? clamp(minRunnerMatchedRaw, 0, 10_000_000) : 15_000;
    const postGoalWaitMinSecRaw = Number(cfg?.postGoalWaitMinSec ?? 60);
    const postGoalWaitMinSec = Number.isFinite(postGoalWaitMinSecRaw) ? clamp(Math.floor(postGoalWaitMinSecRaw), 0, 600) : 60;
    const postGoalWaitMaxSecRaw = Number(cfg?.postGoalWaitMaxSec ?? 120);
    const postGoalWaitMaxSec = Number.isFinite(postGoalWaitMaxSecRaw) ? clamp(Math.floor(postGoalWaitMaxSecRaw), postGoalWaitMinSec, 900) : 120;
    const timeExitMinSecRaw = Number(cfg?.timeExitMinSec ?? 30);
    const timeExitMinSec = Number.isFinite(timeExitMinSecRaw) ? clamp(Math.floor(timeExitMinSecRaw), 1, 600) : 30;
    const timeExitMaxSecRaw = Number(cfg?.timeExitMaxSec ?? 90);
    const timeExitMaxSec = Number.isFinite(timeExitMaxSecRaw) ? clamp(Math.floor(timeExitMaxSecRaw), timeExitMinSec, 900) : 90;
    const steamMoveTicksRaw = Number(cfg?.steamMoveTicks ?? 8);
    const steamMoveTicks = Number.isFinite(steamMoveTicksRaw) ? clamp(Math.floor(steamMoveTicksRaw), 1, 50) : 8;
    const steamMoveWindowSecRaw = Number(cfg?.steamMoveWindowSec ?? 3);
    const steamMoveWindowSec = Number.isFinite(steamMoveWindowSecRaw) ? clamp(Math.floor(steamMoveWindowSecRaw), 1, 30) : 3;
    const ladderDepthLevelsRaw = Number(cfg?.ladderDepthLevels ?? 6);
    const ladderDepthLevels = Number.isFinite(ladderDepthLevelsRaw) ? clamp(Math.floor(ladderDepthLevelsRaw), 1, 10) : 6;
    const minLadderDepthSumRaw = Number(cfg?.minLadderDepthSum ?? 300);
    const minLadderDepthSum = Number.isFinite(minLadderDepthSumRaw) ? clamp(minLadderDepthSumRaw, 0, 10_000_000) : 300;
    const flowImbalanceRatioRaw = Number(cfg?.flowImbalanceRatio ?? 1.1);
    const flowImbalanceRatio = Number.isFinite(flowImbalanceRatioRaw) ? clamp(flowImbalanceRatioRaw, 0.5, 10) : 1.1;
    const spoofWallMinSizeRaw = Number(cfg?.spoofWallMinSize ?? 200);
    const spoofWallMinSize = Number.isFinite(spoofWallMinSizeRaw) ? clamp(spoofWallMinSizeRaw, 0, 10_000_000) : 200;
    const spoofWallDropPctRaw = Number(cfg?.spoofWallDropPct ?? 0.6);
    const spoofWallDropPct = Number.isFinite(spoofWallDropPctRaw) ? clamp(spoofWallDropPctRaw, 0, 1) : 0.6;
    const spoofMaxDeltaMatchedRaw = Number(cfg?.spoofMaxDeltaMatched ?? 40);
    const spoofMaxDeltaMatched = Number.isFinite(spoofMaxDeltaMatchedRaw) ? clamp(spoofMaxDeltaMatchedRaw, 0, 10_000_000) : 40;
    const dangerDepthCollapseRatioRaw = Number(cfg?.dangerDepthCollapseRatio ?? 0.55);
    const dangerDepthCollapseRatio = Number.isFinite(dangerDepthCollapseRatioRaw) ? clamp(dangerDepthCollapseRatioRaw, 0, 1) : 0.55;
    const dangerDepthCollapseMinDeltaMatchedRaw = Number(cfg?.dangerDepthCollapseMinDeltaMatched ?? 120);
    const dangerDepthCollapseMinDeltaMatched = Number.isFinite(dangerDepthCollapseMinDeltaMatchedRaw) ? clamp(dangerDepthCollapseMinDeltaMatchedRaw, 0, 10_000_000) : 120;
    const runnerWindowSecRaw = Number(cfg?.runnerWindowSec ?? 6);
    const runnerWindowSec = Number.isFinite(runnerWindowSecRaw) ? clamp(Math.floor(runnerWindowSecRaw), 1, 60) : 6;
    const spoofMaxDeltaUnderTradedRaw = Number(cfg?.spoofMaxDeltaUnderTraded ?? 15);
    const spoofMaxDeltaUnderTraded = Number.isFinite(spoofMaxDeltaUnderTradedRaw) ? clamp(spoofMaxDeltaUnderTradedRaw, 0, 10_000_000) : 15;
    const minAbsorbDeltaUnderTradedRaw = Number(cfg?.minAbsorbDeltaUnderTraded ?? 25);
    const minAbsorbDeltaUnderTraded = Number.isFinite(minAbsorbDeltaUnderTradedRaw) ? clamp(minAbsorbDeltaUnderTradedRaw, 0, 10_000_000) : 25;

    const key = `${BETFAIR_QUEUE_PREFIX}${matchId}`;
    const item = (await kv.get(key)) ?? null;
    if (!item) return c.json({ ok: false, error: "Item não encontrado na fila" }, 404);

    const agentRaw = String(item?.strategy?.agent ?? "").trim().toLowerCase();
    const agent =
      agentRaw === "scalpingticks" || agentRaw === "scalping_ticks" ? "scalpingTicks" : agentRaw === "overgoalslimit" || agentRaw === "over_goals_limit" ? "overGoalsLimit" : agentRaw === "scalpinggoals" || agentRaw === "scalping_goals" ? "scalpingGoals" : "correctScore";
    if (agent !== "scalpingTicks") return c.json({ ok: false, error: "Robô não é Scalping em Ticks" }, 400);

    const betfair = item?.betfair ?? null;
    let eventId = String(betfair?.eventId ?? "").trim();
    if (!eventId && String(item?.homeTeam ?? "").trim() && String(item?.awayTeam ?? "").trim()) {
      try {
        const mapped = await resolveBetfairMatchOdds({ homeTeam: String(item.homeTeam), awayTeam: String(item.awayTeam), utcDate: item?.utcDate });
        eventId = String(mapped?.eventId ?? "").trim();
        item.betfair = { ...(item?.betfair ?? {}), ...mapped };
      } catch {}
    }
    if (!eventId) return c.json({ ok: false, error: "Betfair: eventId não resolvido" }, 400);

    const scoreHome = Number.isFinite(Number(item?.scoreHome)) ? Number(item.scoreHome) : 0;
    const scoreAway = Number.isFinite(Number(item?.scoreAway)) ? Number(item.scoreAway) : 0;
    const totalGoals = Math.max(0, Math.floor(scoreHome)) + Math.max(0, Math.floor(scoreAway));
    const baseLine = totalGoals + 1.5;
    if (baseLine < 1.5 || baseLine > 10.5) return c.json({ ok: true, matchId, phase: "skip_line", totalGoals, line: baseLine });
    const candidateLines: number[] = [];
    for (let i = 0; i < maxLinesToScan; i += 1) {
      const ln = baseLine + i;
      if (ln > 10.5) break;
      candidateLines.push(ln);
    }

    const sessionToken = await getBetfairSessionToken();

    const stepsForPrice = (p: number) => {
      if (p < 2) return 0.01;
      if (p < 3) return 0.02;
      if (p < 4) return 0.05;
      if (p < 6) return 0.1;
      if (p < 10) return 0.2;
      if (p < 20) return 0.5;
      if (p < 30) return 1;
      if (p < 50) return 2;
      if (p < 100) return 5;
      return 10;
    };
    const roundPrice = (p: number) => round2(p);
    const tickUpOnce = (p: number) => roundPrice(p + stepsForPrice(p));
    const tickDownOnce = (p: number) => {
      const s = stepsForPrice(p);
      const next = p - s;
      return roundPrice(next < 1.01 ? 1.01 : next);
    };
    const tickUp = (p: number, n: number) => {
      let v = p;
      for (let i = 0; i < n; i += 1) v = tickUpOnce(v);
      return v;
    };
    const tickDown = (p: number, n: number) => {
      let v = p;
      for (let i = 0; i < n; i += 1) v = tickDownOnce(v);
      return v;
    };
    const tickDistance = (from: number, to: number) => {
      if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 1.01 || to <= 1.01) return null;
      if (from === to) return 0;
      let steps = 0;
      if (to > from) {
        let v = from;
        while (v < to && steps < 2000) {
          v = tickUpOnce(v);
          steps += 1;
        }
        return steps;
      }
      let v = from;
      while (v > to && steps < 2000) {
        v = tickDownOnce(v);
        steps += 1;
      }
      return steps;
    };

    const randSeconds = (min: number, max: number) => {
      const a = Number.isFinite(min) ? Math.max(0, Math.floor(min)) : 0;
      const b = Number.isFinite(max) ? Math.max(a, Math.floor(max)) : a;
      if (a === b) return a;
      return a + Math.floor(Math.random() * (b - a + 1));
    };

    const prev = (item?.strategy?.scalpingTicks && typeof item.strategy.scalpingTicks === "object") ? item.strategy.scalpingTicks : {};
    const prevMarketId = String(prev?.marketId ?? "").trim() || null;
    const prevLine = Number(prev?.line);
    const prevGoalsRaw = Number(prev?.lastGoals);
    const prevGoals = Number.isFinite(prevGoalsRaw) ? Math.max(0, Math.floor(prevGoalsRaw)) : null;
    const prevCooldownIso = String(prev?.cooldownUntil ?? "").trim() || null;
    const prevCooldownMs = prevCooldownIso ? new Date(prevCooldownIso).getTime() : 0;
    const prevHoldUntilIso = String(prev?.holdUntil ?? "").trim() || null;
    const prevHoldUntilMs = prevHoldUntilIso ? new Date(prevHoldUntilIso).getTime() : 0;
    const prevLastPriceRaw = Number(prev?.lastBestBack);
    const prevLastPrice = Number.isFinite(prevLastPriceRaw) ? prevLastPriceRaw : null;
    const prevLastPriceAtIso = String(prev?.lastBestBackAt ?? "").trim() || null;
    const prevLastPriceAtMs = prevLastPriceAtIso ? new Date(prevLastPriceAtIso).getTime() : 0;
    const prevLastPriceMarketId = String(prev?.lastBestBackMarketId ?? "").trim() || null;
    const carryLossAbsPrevRaw = Number(prev?.carryLossAbs ?? 0);
    let carryLossAbsNext = Number.isFinite(carryLossAbsPrevRaw) ? Math.max(0, carryLossAbsPrevRaw) : 0;
    let lastCarryLossAddedAbs: number | null = null;
    const prevSnapshotsRaw = (prev?.lineSnapshots && typeof prev.lineSnapshots === "object") ? prev.lineSnapshots : {};
    const prevSnapshots: Record<string, any> = { ...(prevSnapshotsRaw as any) };
    if (prevMarketId && Number.isFinite(prevLine) && prevLine > 0 && (prevSnapshots[String(prevLine)] == null)) {
      prevSnapshots[String(prevLine)] = {
        marketId: prevMarketId,
        totalMatched: Number(prev?.lastTotalMatched),
        fetchedAt: String(prev?.lastTickAt ?? "").trim() || null,
      };
    }

    const cashoutMarket = async (mid: string) => {
      const listRes = await betfairJsonRpcTrading({
        method: "SportsAPING/v1.0/listCurrentOrders",
        params: { marketIds: [mid] },
        sessionToken,
      });
      const orders = Array.isArray(listRes?.currentOrders) ? listRes.currentOrders : [];
      const toCancel = orders.filter((o: any) => Number(o?.sizeRemaining ?? 0) > 0 && String(o?.betId ?? "").trim()).map((o: any) => String(o.betId));
      if (toCancel.length > 0) {
        await betfairJsonRpcTrading({
          method: "SportsAPING/v1.0/cancelOrders",
          params: { marketId: mid, instructions: toCancel.map((betId: string) => ({ betId })) },
          sessionToken,
        });
      }

      const book = await betfairJsonRpc({
        method: "SportsAPING/v1.0/listMarketBook",
        params: { marketIds: [mid], priceProjection: { priceData: ["EX_BEST_OFFERS"], virtualise: true } },
        sessionToken,
      });
      const book0 = Array.isArray(book) ? book[0] : book;
      const runners = Array.isArray(book0?.runners) ? book0.runners : [];
      const bySelection = new Map<number, any>();
      for (const r of runners) {
        const sid = Number(r?.selectionId);
        if (!Number.isFinite(sid)) continue;
        const ex = r?.ex ?? {};
        const back0 = Array.isArray(ex?.availableToBack) ? ex.availableToBack[0] : null;
        const lay0 = Array.isArray(ex?.availableToLay) ? ex.availableToLay[0] : null;
        bySelection.set(sid, { bestBack: back0 ? Number(back0.price) : null, bestLay: lay0 ? Number(lay0.price) : null });
      }

      const hedgeInstructions: any[] = [];
      for (const o of orders) {
        const sizeMatched = Number(o?.sizeMatched ?? 0);
        if (!Number.isFinite(sizeMatched) || sizeMatched <= 0) continue;
        const selectionId = Number(o?.selectionId);
        if (!Number.isFinite(selectionId)) continue;
        const side = String(o?.side ?? "").toUpperCase();
        const px = bySelection.get(selectionId) ?? {};
        if (side === "BACK") {
          const layPrice = Number(px?.bestLay);
          if (!Number.isFinite(layPrice) || layPrice <= 1.01) continue;
          hedgeInstructions.push({ selectionId, side: "LAY", orderType: "LIMIT", limitOrder: { size: round2(sizeMatched), price: layPrice, persistenceType: "LAPSE" } });
        } else if (side === "LAY") {
          const backPrice = Number(px?.bestBack);
          if (!Number.isFinite(backPrice) || backPrice <= 1.01) continue;
          hedgeInstructions.push({ selectionId, side: "BACK", orderType: "LIMIT", limitOrder: { size: round2(sizeMatched), price: backPrice, persistenceType: "LAPSE" } });
        }
      }

      let hedgeResult: any = null;
      if (hedgeInstructions.length > 0) {
        hedgeResult = await betfairJsonRpcTrading({
          method: "SportsAPING/v1.0/placeOrders",
          params: { marketId: mid, instructions: hedgeInstructions.slice(0, 50), customerRef: `ST_CASH_${matchId}_${Date.now()}`.slice(0, 32), async: false },
          sessionToken,
        });
      }
      return { cancelledCount: toCancel.length, hedgedCount: hedgeInstructions.length, hedgeResult };
    };

    const preNowMs = Date.now();
    const preNowIso = new Date().toISOString();
    if (prevCooldownMs && Number.isFinite(prevCooldownMs) && preNowMs < prevCooldownMs) {
      const nextStrategy = {
        ...(item?.strategy ?? {}),
        agent: "scalpingTicks",
        scalpingTicks: {
          ...(prev ?? {}),
          phase: "cooldown",
          lastGoals: totalGoals,
          cooldownUntil: prevCooldownIso,
          lastTickAt: preNowIso,
          lastSummary: { totalGoals, reason: "cooldown_until", cooldownUntil: prevCooldownIso },
        },
      };
      await kv.set(key, { ...item, strategy: nextStrategy, updatedAt: preNowIso });
      return c.json({ ok: true, matchId, phase: "cooldown", totalGoals, cooldownUntil: prevCooldownIso });
    }

    const goalsChanged = prevGoals != null && totalGoals !== prevGoals;

    const mustResetLine =
      prevMarketId &&
      Number.isFinite(prevLine) &&
      (prevLine < baseLine || prevLine > 10.5 || Math.round(prevLine * 10) % 10 !== 5);
    if (mustResetLine) {
      try {
        await cashoutMarket(prevMarketId);
      } catch {}
      try {
        const pnlRes = await betfairJsonRpcTrading({
          method: "SportsAPING/v1.0/listMarketProfitAndLoss",
          params: { marketIds: [prevMarketId], includeSettledBets: false, netOfCommission: true },
          sessionToken,
        });
        const pnl0 = Array.isArray(pnlRes) ? pnlRes[0] : pnlRes;
        const pls = Array.isArray(pnl0?.profitAndLosses) ? pnl0.profitAndLosses : [];
        const minIfWin = pls.reduce((acc: number | null, x: any) => {
          const v = Number(x?.ifWin);
          if (!Number.isFinite(v)) return acc;
          if (acc == null) return v;
          return Math.min(acc, v);
        }, null);
        const lossAbs = typeof minIfWin === "number" && Number.isFinite(minIfWin) && minIfWin < 0 ? round2(Math.abs(minIfWin)) : 0;
        if (lossAbs > 0) {
          carryLossAbsNext = round2(carryLossAbsNext + lossAbs);
          lastCarryLossAddedAbs = lossAbs;
        }
      } catch {}
    }

    if (goalsChanged) {
      const waitSec = randSeconds(postGoalWaitMinSec, postGoalWaitMaxSec);
      const cooldownUntil = new Date(preNowMs + waitSec * 1000).toISOString();
      const nextStrategy = {
        ...(item?.strategy ?? {}),
        agent: "scalpingTicks",
        scalpingTicks: {
          ...(prev ?? {}),
          phase: "post_goal_wait",
          lastGoals: totalGoals,
          cooldownUntil,
          lastTickAt: preNowIso,
          carryLossAbs: carryLossAbsNext,
          lastCarryLossAddedAbs,
          lastSummary: { totalGoals, reason: "goal_changed", waitSec, cooldownUntil },
        },
      };
      await kv.set(key, { ...item, strategy: nextStrategy, updatedAt: preNowIso });
      return c.json({ ok: true, matchId, phase: "post_goal_wait", totalGoals, cooldownUntil });
    }

    const ouPrev = (item?.betfair?.overUnder && typeof item.betfair.overUnder === "object") ? item.betfair.overUnder : {};
    const resolvedCandidates: Array<{
      line: number;
      marketId: string;
      underSelectionId: number;
      overSelectionId: number | null;
      bestBackPrice: number | null;
      bestLayPrice: number | null;
      bestBackSize: number | null;
      bestLaySize: number | null;
      backDepthSum: number | null;
      layDepthSum: number | null;
      depthImbalance: number | null;
      spoofSuspect: boolean;
      absorptionSuspect: boolean;
      defenseSuspect: boolean;
      flowRisk: boolean;
      totalMatched: number | null;
      underTraded: number | null;
      overTraded: number | null;
      spreadTicks: number | null;
      deltaMatched: number | null;
      deltaUnderTraded: number | null;
      deltaOverTraded: number | null;
      volumeOk: boolean;
      goalRisk: boolean;
    }> = [];

    for (const ln of candidateLines) {
      try {
        const ou = await resolveBetfairOverUnderMarket({ eventId, line: ln });
        const marketId = String(ou?.marketId ?? "").trim();
        const underSelectionId = Number(ou?.odds?.under?.selectionId ?? ou?.runners?.underSelectionId);
        const overSelectionIdRaw = Number(ou?.odds?.over?.selectionId ?? ou?.runners?.overSelectionId);
        const overSelectionId = Number.isFinite(overSelectionIdRaw) ? overSelectionIdRaw : null;

        const bestBackPrice = Number.isFinite(Number(ou?.odds?.under?.back)) ? Number(ou.odds.under.back) : null;
        const bestLayPrice = Number.isFinite(Number(ou?.odds?.under?.lay)) ? Number(ou.odds.under.lay) : null;
        const bestBackSize = Number.isFinite(Number(ou?.odds?.under?.backSize)) ? Number(ou.odds.under.backSize) : null;
        const bestLaySize = Number.isFinite(Number(ou?.odds?.under?.laySize)) ? Number(ou.odds.under.laySize) : null;
        const backLadderRaw = Array.isArray(ou?.odds?.under?.backLadder) ? ou.odds.under.backLadder : [];
        const layLadderRaw = Array.isArray(ou?.odds?.under?.layLadder) ? ou.odds.under.layLadder : [];
        const sumDepth = (a: any[]) => {
          const n = a
            .slice(0, ladderDepthLevels)
            .reduce((acc: number, x: any) => acc + (Number.isFinite(Number(x?.size)) ? Number(x.size) : 0), 0);
          return Number.isFinite(n) ? round2(n) : null;
        };
        const backDepthSum = sumDepth(backLadderRaw);
        const layDepthSum = sumDepth(layLadderRaw);
        const depthImbalance =
          typeof backDepthSum === "number" &&
          typeof layDepthSum === "number" &&
          Number.isFinite(backDepthSum) &&
          Number.isFinite(layDepthSum) &&
          layDepthSum > 0
            ? round2(backDepthSum / layDepthSum)
            : null;
        const back1Size = typeof backLadderRaw?.[0]?.size === "number" ? Number(backLadderRaw[0].size) : bestBackSize;
        const lay1Size = typeof layLadderRaw?.[0]?.size === "number" ? Number(layLadderRaw[0].size) : bestLaySize;
        const totalMatchedNow = Number(ou?.matchedVolume);
        const totalMatched = Number.isFinite(totalMatchedNow) ? totalMatchedNow : null;
        const underTradedNow = Number(ou?.odds?.under?.tradedVolume);
        const underTraded = Number.isFinite(underTradedNow) ? underTradedNow : null;
        const overTradedNow = Number(ou?.odds?.over?.tradedVolume);
        const overTraded = Number.isFinite(overTradedNow) ? overTradedNow : null;
        const spreadTicks = Number.isFinite(bestBackPrice) && Number.isFinite(bestLayPrice) ? tickDistance(bestBackPrice, bestLayPrice) : null;

        const depthMinMultiplier = (p: number | null) => {
          if (!(typeof p === "number" && Number.isFinite(p))) return 1;
          if (p <= 1.5) return 1.4;
          if (p <= 2.2) return 1.0;
          return 0.8;
        };
        const imbalanceMultiplier = (p: number | null) => {
          if (!(typeof p === "number" && Number.isFinite(p))) return 1;
          if (p <= 1.5) return 0.95;
          if (p <= 2.2) return 1.0;
          return 1.08;
        };

        const prevSnap = prevSnapshots[String(ln)] ?? {};
        const prevMatched = Number(prevSnap?.totalMatched);
        const prevUnderTraded = Number(prevSnap?.underTraded);
        const prevOverTraded = Number(prevSnap?.overTraded);
        const prevBackDepthSum = Number(prevSnap?.backDepthSum);
        const prevLayDepthSum = Number(prevSnap?.layDepthSum);
        const prevLay1Size = Number(prevSnap?.lay1Size);
        const prevBack1Size = Number(prevSnap?.back1Size);
        const prevBestLay = Number(prevSnap?.bestLay);
        const prevBestBack = Number(prevSnap?.bestBack);
        const prevFetchedAtIso = String(prevSnap?.fetchedAt ?? "").trim() || null;
        const prevFetchedAtMs = prevFetchedAtIso ? new Date(prevFetchedAtIso).getTime() : 0;
        const snapAgeSec = prevFetchedAtMs && Number.isFinite(prevFetchedAtMs) ? (Date.now() - prevFetchedAtMs) / 1000 : null;
        const deltaMatched = typeof totalMatched === "number" && Number.isFinite(prevMatched) ? round2(totalMatched - prevMatched) : null;
        const deltaUnderTraded = typeof underTraded === "number" && Number.isFinite(prevUnderTraded) ? round2(underTraded - prevUnderTraded) : null;
        const deltaOverTraded = typeof overTraded === "number" && Number.isFinite(prevOverTraded) ? round2(overTraded - prevOverTraded) : null;
        const deltaMatchedAbs = typeof deltaMatched === "number" && Number.isFinite(deltaMatched) ? Math.abs(deltaMatched) : null;
        const deltaUnderAbs = typeof deltaUnderTraded === "number" && Number.isFinite(deltaUnderTraded) ? Math.abs(deltaUnderTraded) : null;
        const isRunnerWindow = typeof snapAgeSec === "number" && Number.isFinite(snapAgeSec) ? snapAgeSec <= runnerWindowSec : false;

        const dU = typeof deltaUnderTraded === "number" && Number.isFinite(deltaUnderTraded) ? Math.max(0, deltaUnderTraded) : 0;
        const dO = typeof deltaOverTraded === "number" && Number.isFinite(deltaOverTraded) ? Math.max(0, deltaOverTraded) : 0;
        const hasPrices = Number.isFinite(bestBackPrice) && Number.isFinite(bestLayPrice) && Number(bestBackPrice) > 1.01 && Number(bestLayPrice) > 1.01;
        const spreadOk = Number.isFinite(spreadTicks) ? Number(spreadTicks) <= maxSpreadTicks : false;
        const tradedOk = dU >= minDeltaTraded && dU >= dO * dominanceRatio;
        const liquidityOk =
          (typeof totalMatched === "number" && Number.isFinite(totalMatched) ? totalMatched >= minMarketMatched : false) &&
          (typeof underTraded === "number" && Number.isFinite(underTraded) ? underTraded >= minRunnerMatched : false);
        const effMinDepthSum = minLadderDepthSum * depthMinMultiplier(bestBackPrice);
        const effImbalanceRatio = flowImbalanceRatio * imbalanceMultiplier(bestBackPrice);
        const depthOk =
          typeof backDepthSum === "number" &&
          typeof layDepthSum === "number" &&
          Number.isFinite(backDepthSum) &&
          Number.isFinite(layDepthSum) &&
          backDepthSum > 0 &&
          layDepthSum > 0 &&
          (backDepthSum + layDepthSum) >= effMinDepthSum;
        const imbalanceOk = typeof depthImbalance === "number" && Number.isFinite(depthImbalance) ? depthImbalance >= effImbalanceRatio : false;

        const layWallDropPct =
          Number.isFinite(prevLay1Size) && prevLay1Size > 0 && Number.isFinite(lay1Size as number) && typeof lay1Size === "number"
            ? (prevLay1Size - lay1Size) / prevLay1Size
            : 0;
        const backWallDropPct =
          Number.isFinite(prevBack1Size) && prevBack1Size > 0 && Number.isFinite(back1Size as number) && typeof back1Size === "number"
            ? (prevBack1Size - back1Size) / prevBack1Size
            : 0;
        const isFreshSnap = typeof snapAgeSec === "number" && Number.isFinite(snapAgeSec) ? snapAgeSec <= 12 : false;
        const spoofSuspect =
          isFreshSnap &&
          isRunnerWindow &&
          typeof deltaMatchedAbs === "number" &&
          Number.isFinite(deltaMatchedAbs) &&
          deltaMatchedAbs <= spoofMaxDeltaMatched &&
          typeof deltaUnderAbs === "number" &&
          Number.isFinite(deltaUnderAbs) &&
          deltaUnderAbs <= spoofMaxDeltaUnderTraded &&
          ((Number.isFinite(prevLay1Size) && prevLay1Size >= spoofWallMinSize && layWallDropPct >= spoofWallDropPct) ||
            (Number.isFinite(prevBack1Size) && prevBack1Size >= spoofWallMinSize && backWallDropPct >= spoofWallDropPct));

        const absorptionSuspect =
          isFreshSnap &&
          isRunnerWindow &&
          typeof deltaMatchedAbs === "number" &&
          Number.isFinite(deltaMatchedAbs) &&
          deltaMatchedAbs >= Math.max(20, minDeltaTraded) &&
          dU >= minAbsorbDeltaUnderTraded &&
          typeof prevLayDepthSum === "number" &&
          Number.isFinite(prevLayDepthSum) &&
          typeof layDepthSum === "number" &&
          Number.isFinite(layDepthSum) &&
          layDepthSum < prevLayDepthSum &&
          typeof bestLayPrice === "number" &&
          Number.isFinite(bestLayPrice) &&
          typeof prevBestLay === "number" &&
          Number.isFinite(prevBestLay) &&
          bestLayPrice <= prevBestLay;

        const defenseSuspect =
          isFreshSnap &&
          isRunnerWindow &&
          typeof prevBestBack === "number" &&
          Number.isFinite(prevBestBack) &&
          typeof bestBackPrice === "number" &&
          Number.isFinite(bestBackPrice) &&
          bestBackPrice === prevBestBack &&
          typeof prevBackDepthSum === "number" &&
          Number.isFinite(prevBackDepthSum) &&
          typeof backDepthSum === "number" &&
          Number.isFinite(backDepthSum) &&
          backDepthSum > prevBackDepthSum;

        const flowRisk =
          isFreshSnap &&
          isRunnerWindow &&
          typeof prevLayDepthSum === "number" &&
          Number.isFinite(prevLayDepthSum) &&
          prevLayDepthSum > 0 &&
          typeof layDepthSum === "number" &&
          Number.isFinite(layDepthSum) &&
          (layDepthSum / prevLayDepthSum) <= dangerDepthCollapseRatio &&
          typeof deltaMatchedAbs === "number" &&
          Number.isFinite(deltaMatchedAbs) &&
          deltaMatchedAbs >= dangerDepthCollapseMinDeltaMatched;

        const flowOk = depthOk && !spoofSuspect && (imbalanceOk || absorptionSuspect || defenseSuspect);
        const volumeOk = hasPrices && spreadOk && tradedOk && liquidityOk && flowOk;
        const goalRisk = dO >= dangerMinDeltaTraded && dO >= Math.max(1, dU) * dangerDominanceRatio;

        if (marketId && Number.isFinite(underSelectionId)) {
          resolvedCandidates.push({
            line: ln,
            marketId,
            underSelectionId,
            overSelectionId,
            bestBackPrice,
            bestLayPrice,
            bestBackSize,
            bestLaySize,
            backDepthSum,
            layDepthSum,
            depthImbalance,
            spoofSuspect,
            absorptionSuspect,
            defenseSuspect,
            flowRisk,
            totalMatched,
            underTraded,
            overTraded,
            spreadTicks,
            deltaMatched,
            deltaUnderTraded,
            deltaOverTraded,
            volumeOk,
            goalRisk,
          });
        }
      } catch {}
    }

    if (resolvedCandidates.length === 0) {
      const nextStrategy = {
        ...(item?.strategy ?? {}),
        agent: "scalpingTicks",
        scalpingTicks: {
          ...(prev ?? {}),
          phase: "waiting_market",
          lastTickAt: new Date().toISOString(),
          lastSummary: { totalGoals, baseLine, reason: "no_candidates" },
        },
      };
      await kv.set(key, { ...item, strategy: nextStrategy, updatedAt: new Date().toISOString() });
      return c.json({ ok: true, matchId, phase: "waiting_market", totalGoals, line: baseLine });
    }

    const byMarketId = new Map<string, any>();
    for (const x of resolvedCandidates) byMarketId.set(String(x.marketId), x);

    const marketIdsForOrders = Array.from(new Set([...(prevMarketId ? [prevMarketId] : []), ...resolvedCandidates.map((x) => x.marketId)])).slice(0, 40);
    const ordersResAll = await betfairJsonRpcTrading({
      method: "SportsAPING/v1.0/listCurrentOrders",
      params: { marketIds: marketIdsForOrders },
      sessionToken,
    });
    const ordersAll = Array.isArray(ordersResAll?.currentOrders) ? ordersResAll.currentOrders : [];

    let selected = resolvedCandidates.find((x) => prevMarketId && x.marketId === prevMarketId) ?? null;
    if (!selected) {
      const activeFromOrders =
        resolvedCandidates.find((x) => ordersAll.some((o: any) => String(o?.marketId ?? "").trim() === x.marketId && Number(o?.selectionId) === x.underSelectionId)) ?? null;
      selected = activeFromOrders;
    }
    if (!selected) {
      const best =
        resolvedCandidates
          .filter((x) => x.volumeOk)
          .sort((a, b) => {
            const aScore = (typeof a.deltaUnderTraded === "number" ? a.deltaUnderTraded : 0) - (typeof a.spreadTicks === "number" ? a.spreadTicks * 20 : 200);
            const bScore = (typeof b.deltaUnderTraded === "number" ? b.deltaUnderTraded : 0) - (typeof b.spreadTicks === "number" ? b.spreadTicks * 20 : 200);
            return bScore - aScore;
          })[0] ?? null;
      selected = best ?? resolvedCandidates[0];
    }

    const line = selected.line;
    const marketId = selected.marketId;
    const underSelectionId = selected.underSelectionId;
    const bestBackPrice = selected.bestBackPrice;
    const bestLayPrice = selected.bestLayPrice;
    const bestBackSize = selected.bestBackSize;
    const bestLaySize = selected.bestLaySize;
    const spreadTicks = selected.spreadTicks;
    const totalMatched = selected.totalMatched;
    const deltaMatched = selected.deltaMatched;

    const cyclesDone = Number(prev?.cyclesDone);
    const cycles = Number.isFinite(cyclesDone) ? Math.max(0, Math.floor(cyclesDone)) : 0;
    if (cycles >= maxCycles) {
      const nowIso = new Date().toISOString();
      const pickedOu = (() => {
        const cached = ouPrev[String(line)];
        if (cached && typeof cached === "object") return cached;
        return { marketId, odds: { under: { selectionId: underSelectionId, back: bestBackPrice, lay: bestLayPrice } }, oddsFetchedAt: nowIso };
      })();
      const nextStrategy = {
        ...(item?.strategy ?? {}),
        agent: "scalpingTicks",
        scalpingTicks: {
          ...(prev ?? {}),
          phase: "max_cycles",
          marketId,
          line,
          lastTickAt: nowIso,
          cyclesDone: cycles,
          lastSummary: { totalGoals, line, marketId, cycles, maxCycles },
        },
      };
      const nextBetfair = { ...(item?.betfair ?? {}), overUnder: { ...ouPrev, [String(line)]: pickedOu } };
      await kv.set(key, { ...item, betfair: nextBetfair, strategy: nextStrategy, updatedAt: nowIso });
      return c.json({ ok: true, matchId, phase: "max_cycles", totalGoals, line, marketId, cycles, maxCycles });
    }

    const lastCycleAt = String(prev?.lastCycleAt ?? "").trim();
    const lastCycleMs = lastCycleAt ? new Date(lastCycleAt).getTime() : 0;
    if (lastCycleMs && Number.isFinite(lastCycleMs) && minSecondsBetweenCycles > 0 && Date.now() - lastCycleMs < minSecondsBetweenCycles * 1000) {
      const nowIso = new Date().toISOString();
      const pickedOu = (() => {
        const cached = ouPrev[String(line)];
        if (cached && typeof cached === "object") return cached;
        return { marketId, odds: { under: { selectionId: underSelectionId, back: bestBackPrice, lay: bestLayPrice } }, oddsFetchedAt: nowIso };
      })();
      const nextStrategy = {
        ...(item?.strategy ?? {}),
        agent: "scalpingTicks",
        scalpingTicks: {
          ...(prev ?? {}),
          phase: "cooldown",
          marketId,
          line,
          lastTickAt: nowIso,
          cyclesDone: cycles,
          lastSummary: { totalGoals, line, marketId, cycles, cooldown: minSecondsBetweenCycles },
        },
      };
      const nextBetfair = { ...(item?.betfair ?? {}), overUnder: { ...ouPrev, [String(line)]: pickedOu } };
      await kv.set(key, { ...item, betfair: nextBetfair, strategy: nextStrategy, updatedAt: nowIso });
      return c.json({ ok: true, matchId, phase: "cooldown", totalGoals, line, marketId, cycles });
    }

    const orders = ordersAll.filter((o: any) => String(o?.marketId ?? "").trim() === marketId && Number(o?.selectionId) === underSelectionId);

    const openOrdersCount = orders.filter((o: any) => Number(o?.sizeRemaining ?? 0) > 0).length;
    const matchedBetsCount = orders.filter((o: any) => Number(o?.sizeMatched ?? 0) > 0).length;

    const entryBack = orders.find((o: any) => String(o?.side ?? "").toUpperCase() === "BACK") ?? null;
    const exitLay = orders.find((o: any) => String(o?.side ?? "").toUpperCase() === "LAY") ?? null;

    let placed: any = null;
    let phase = String(prev?.phase ?? "").trim() || "idle";
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const repriceAfterMs = Math.max(1_000, Math.floor(secondsToWaitMatch * 1000));
    let holdUntilNext = prevHoldUntilIso;
    let cooldownUntilNext = prevCooldownIso;
    let lastEntryPlacedAtNext = String(prev?.lastEntryPlacedAt ?? "").trim() || null;
    let lastEntryRepriceAtNext = String(prev?.lastEntryRepriceAt ?? "").trim() || null;
    let lastCycleProfitAbs: number | null = null;

    const isInPlay = Boolean(item?.betfair?.inPlay ?? false);
    const entryMatchedNow = entryBack ? Number(entryBack?.sizeMatched ?? 0) : 0;
    const hasMatchedExposure =
      (Number.isFinite(entryMatchedNow) ? entryMatchedNow > 0 : false) ||
      (Number.isFinite(matchedBetsCount) ? matchedBetsCount > 0 : false);

    if (!hasMatchedExposure) {
      holdUntilNext = null;
    } else if ((!prevHoldUntilMs || !Number.isFinite(prevHoldUntilMs)) && isInPlay) {
      const holdSec = randSeconds(timeExitMinSec, timeExitMaxSec);
      holdUntilNext = new Date(nowMs + holdSec * 1000).toISOString();
    }

    const steamDist =
      prevLastPrice != null &&
      Number.isFinite(prevLastPrice) &&
      prevLastPriceAtMs &&
      Number.isFinite(prevLastPriceAtMs) &&
      Number.isFinite(bestBackPrice as number) &&
      typeof bestBackPrice === "number" &&
      prevLastPriceMarketId === marketId
        ? tickDistance(prevLastPrice, bestBackPrice)
        : null;
    const steamMove =
      typeof steamDist === "number" &&
      Number.isFinite(steamDist) &&
      steamDist >= steamMoveTicks &&
      prevLastPriceAtMs &&
      Number.isFinite(prevLastPriceAtMs) &&
      (nowMs - prevLastPriceAtMs) <= steamMoveWindowSec * 1000;
    const timeExitHit =
      hasMatchedExposure && prevHoldUntilMs && Number.isFinite(prevHoldUntilMs) ? nowMs > prevHoldUntilMs : false;
    const activityOk =
      (typeof selected?.deltaUnderTraded === "number" && Number.isFinite(selected.deltaUnderTraded) ? selected.deltaUnderTraded > 0 : false) ||
      (typeof deltaMatched === "number" && Number.isFinite(deltaMatched) ? deltaMatched > 0 : true);
    const canEnter =
      isInPlay &&
      Number.isFinite(bestBackPrice) &&
      Number.isFinite(bestLayPrice) &&
      Number.isFinite(spreadTicks) &&
      spreadTicks <= maxSpreadTicks &&
      (Number.isFinite(bestBackSize) ? bestBackSize > 0 : true) &&
      (Number.isFinite(bestLaySize) ? bestLaySize > 0 : true) &&
      activityOk &&
      Boolean(selected.volumeOk) &&
      !selected.goalRisk &&
      !selected.flowRisk &&
      !steamMove;

    const cancelOrder = async (mid: string, betId: string) => {
      const bid = String(betId ?? "").trim();
      if (!bid) return null;
      return await betfairJsonRpcTrading({
        method: "SportsAPING/v1.0/cancelOrders",
        params: { marketId: mid, instructions: [{ betId: bid }] },
        sessionToken,
      });
    };

    const openEntry = orders.find((o: any) => {
      const side = String(o?.side ?? "").toUpperCase();
      const sizeMatched = Number(o?.sizeMatched ?? 0);
      const sizeRemaining = Number(o?.sizeRemaining ?? 0);
      return side === "BACK" && (!Number.isFinite(sizeMatched) || sizeMatched <= 0) && Number.isFinite(sizeRemaining) && sizeRemaining > 0 && String(o?.betId ?? "").trim();
    }) ?? null;

    if (isInPlay && (entryBack || openEntry) && ((selected.goalRisk || selected.flowRisk || steamMove || timeExitHit) || (typeof bestLayPrice === "number" && Number.isFinite(bestLayPrice) && entryBack && Number(entryBack?.sizeMatched ?? 0) > 0))) {
      const entryMatched = entryBack ? Number(entryBack?.sizeMatched ?? 0) : 0;
      const avg = entryBack ? Number(entryBack?.averagePriceMatched) : NaN;
      const entryPx = entryBack && Number.isFinite(avg) && avg > 1.01 ? avg : entryBack ? Number(entryBack?.priceSize?.price) : NaN;
      const adverseTicks =
        entryBack && entryMatched > 0 && Number.isFinite(entryPx) && entryPx > 1.01 && typeof bestLayPrice === "number" && bestLayPrice > entryPx
          ? tickDistance(entryPx, bestLayPrice)
          : null;
      const stopLossHit = typeof adverseTicks === "number" && Number.isFinite(adverseTicks) ? adverseTicks >= stopLossTicks : false;
      const mustExit = Boolean(selected.goalRisk) || Boolean(selected.flowRisk) || stopLossHit || steamMove || timeExitHit;
      if (mustExit) {
        try {
          await cashoutMarket(marketId);
        } catch {}
        const nextStrategy = {
          ...(item?.strategy ?? {}),
          agent: "scalpingTicks",
          scalpingTicks: {
            ...(prev ?? {}),
            phase: "risk_exit",
            marketId,
            line,
            lastTickAt: nowIso,
            lastCycleAt: nowIso,
            cyclesDone: cycles,
            lastEntryPlacedAt: lastEntryPlacedAtNext,
            lastEntryRepriceAt: lastEntryRepriceAtNext,
            holdUntil: null,
            cooldownUntil: cooldownUntilNext,
            lastBestBack: Number.isFinite(bestBackPrice) ? bestBackPrice : prevLastPrice,
            lastBestBackAt: Number.isFinite(bestBackPrice) ? nowIso : prevLastPriceAtIso,
            lastBestBackMarketId: Number.isFinite(bestBackPrice) ? marketId : prevLastPriceMarketId,
            lastGoals: totalGoals,
            carryLossAbs: carryLossAbsNext,
            lastCarryLossAddedAbs,
            lastCycleProfitAbs,
            lineSnapshots: (() => {
              const next: any = {};
              for (const x of resolvedCandidates) {
                next[String(x.line)] = {
                  marketId: x.marketId,
                  totalMatched: x.totalMatched,
                  underTraded: x.underTraded,
                  overTraded: x.overTraded,
                  bestBack: x.bestBackPrice,
                  bestLay: x.bestLayPrice,
                  backDepthSum: x.backDepthSum,
                  layDepthSum: x.layDepthSum,
                  depthImbalance: x.depthImbalance,
                  back1Size: x.bestBackSize,
                  lay1Size: x.bestLaySize,
                  fetchedAt: nowIso,
                };
              }
              return next;
            })(),
            lastSummary: {
              totalGoals,
              line,
              marketId,
              reason: "risk_exit",
              goalRisk: selected.goalRisk,
              flowRisk: selected.flowRisk,
              spoofSuspect: selected.spoofSuspect,
              absorptionSuspect: selected.absorptionSuspect,
              defenseSuspect: selected.defenseSuspect,
              backDepthSum: selected.backDepthSum,
              layDepthSum: selected.layDepthSum,
              depthImbalance: selected.depthImbalance,
              steamMove,
              steamDist,
              steamMoveWindowSec,
              timeExitHit,
              holdUntil: holdUntilNext,
              stopLossTicks,
              adverseTicks,
            },
          },
        };
        const nextBetfair = { ...(item?.betfair ?? {}), overUnder: { ...ouPrev } };
        await kv.set(key, { ...item, betfair: nextBetfair, strategy: nextStrategy, updatedAt: new Date().toISOString() });
        return c.json({ ok: true, matchId, phase: "risk_exit", totalGoals, line, marketId, cyclesDone: cycles, openOrdersCount, matchedBetsCount, spreadTicks });
      }
    }

    if (openEntry && canEnter) {
      const placedIso = String(openEntry?.placedDate ?? "").trim();
      const placedMs = placedIso ? new Date(placedIso).getTime() : (lastEntryPlacedAtNext ? new Date(lastEntryPlacedAtNext).getTime() : 0);
      const lastReIso = String(lastEntryRepriceAtNext ?? "").trim();
      const lastReMs = lastReIso ? new Date(lastReIso).getTime() : 0;
      const ageOk = placedMs && Number.isFinite(placedMs) ? (nowMs - placedMs) >= repriceAfterMs : true;
      const cooldownOk = !lastReMs || !Number.isFinite(lastReMs) ? true : (nowMs - lastReMs) >= repriceAfterMs;
      if (ageOk && cooldownOk) {
        const betId = String(openEntry?.betId ?? "").trim();
        const stakeRemaining = Number(openEntry?.sizeRemaining ?? 0);
        if (betId && Number.isFinite(stakeRemaining) && stakeRemaining >= 2) {
          try {
            await cancelOrder(marketId, betId);
          } catch {}
          const entryLimitPrice =
            entryOffsetTicks >= 0 ? tickUp(Number(bestBackPrice), entryOffsetTicks) : tickDown(Number(bestBackPrice), Math.abs(entryOffsetTicks));
          const res = await betfairJsonRpcTrading({
            method: "SportsAPING/v1.0/placeOrders",
            params: {
              marketId,
              instructions: [{ selectionId: underSelectionId, side: "BACK", orderType: "LIMIT", limitOrder: { size: round2(stakeRemaining), price: entryLimitPrice, persistenceType: "LAPSE" } }],
              customerRef: `ST_RE_${matchId}_${Date.now()}`.slice(0, 32),
              async: false,
            },
            sessionToken,
          });
          placed = { kind: "reprice_entry", marketId, line, selectionId: underSelectionId, side: "BACK", stake: round2(stakeRemaining), price: entryLimitPrice, result: res };
          phase = "entry_repriced";
          lastEntryPlacedAtNext = nowIso;
          lastEntryRepriceAtNext = nowIso;
        }
      }
    }

    if (!entryBack && !exitLay && openOrdersCount === 0 && matchedBetsCount === 0) {
      if (!isInPlay) {
        phase = "waiting_inplay";
      } else if (canEnter) {
        const stakeBase = round2(clamp(bankroll * stakePct, 2, bankroll));
        const entryLimitPrice =
          entryOffsetTicks >= 0 ? tickUp(Number(bestBackPrice), entryOffsetTicks) : tickDown(Number(bestBackPrice), Math.abs(entryOffsetTicks));
        const exitForCalc = Number.isFinite(entryLimitPrice) && entryLimitPrice > 1.01 ? tickDown(entryLimitPrice, targetTicks) : null;
        const profitFactor =
          Number.isFinite(entryLimitPrice) && Number.isFinite(exitForCalc) && exitForCalc && exitForCalc > 1.01 && entryLimitPrice > exitForCalc
            ? (entryLimitPrice / exitForCalc) - 1
            : null;
        const desiredProfitAbs =
          typeof profitFactor === "number" && Number.isFinite(profitFactor) && profitFactor > 0
            ? round2(carryLossAbsNext + stakeBase * profitFactor)
            : null;
        const stake =
          typeof desiredProfitAbs === "number" && typeof profitFactor === "number" && Number.isFinite(profitFactor) && profitFactor > 0
            ? round2(clamp(desiredProfitAbs / profitFactor, 2, stakeBase))
            : stakeBase;
        const res = await betfairJsonRpcTrading({
          method: "SportsAPING/v1.0/placeOrders",
          params: {
            marketId,
            instructions: [{ selectionId: underSelectionId, side: "BACK", orderType: "LIMIT", limitOrder: { size: stake, price: entryLimitPrice, persistenceType: "LAPSE" } }],
            customerRef: `ST_ENT_${matchId}_${Date.now()}`.slice(0, 32),
            async: false,
          },
          sessionToken,
        });
        placed = { kind: "entry", marketId, line, selectionId: underSelectionId, side: "BACK", stake, price: entryLimitPrice, result: res };
        phase = "entry_placed";
        lastEntryPlacedAtNext = nowIso;
      } else {
        phase = "waiting_market";
      }
    } else if (entryBack && Number(entryBack?.sizeMatched ?? 0) > 0 && !exitLay) {
      const sizeMatched = Number(entryBack.sizeMatched);
      const avg = Number(entryBack?.averagePriceMatched);
      const entryPx = Number.isFinite(avg) && avg > 1.01 ? avg : Number(entryBack?.priceSize?.price);
      const exitPrice = Number.isFinite(entryPx) && entryPx > 1.01 ? tickDown(entryPx, targetTicks) : null;
      if (Number.isFinite(exitPrice) && exitPrice && exitPrice > 1.01 && sizeMatched > 0) {
        const laySizeRaw = Number.isFinite(entryPx) && entryPx > 1.01 ? (sizeMatched * entryPx) / exitPrice : sizeMatched;
        const laySize = round2(clamp(laySizeRaw, 2, 10_000));
        const res = await betfairJsonRpcTrading({
          method: "SportsAPING/v1.0/placeOrders",
          params: {
            marketId,
            instructions: [{ selectionId: underSelectionId, side: "LAY", orderType: "LIMIT", limitOrder: { size: laySize, price: exitPrice, persistenceType: "LAPSE" } }],
            customerRef: `ST_EXT_${matchId}_${Date.now()}`.slice(0, 32),
            async: false,
          },
          sessionToken,
        });
        placed = { kind: "exit", marketId, line, selectionId: underSelectionId, side: "LAY", size: laySize, price: exitPrice, result: res };
        phase = "exit_placed";
      } else {
        phase = "exit_skipped";
      }
    } else if (entryBack && exitLay) {
      const entryMatched = Number(entryBack?.sizeMatched ?? 0);
      const exitMatched = Number(exitLay?.sizeMatched ?? 0);
      const entryRemaining = Number(entryBack?.sizeRemaining ?? 0);
      const exitRemaining = Number(exitLay?.sizeRemaining ?? 0);
      if (entryMatched > 0 && exitMatched > 0 && entryRemaining <= 0 && exitRemaining <= 0) {
        phase = "cycle_done";
        const profitAbs = round2(Math.max(0, exitMatched - entryMatched));
        if (profitAbs > 0) {
          lastCycleProfitAbs = profitAbs;
          carryLossAbsNext = round2(Math.max(0, carryLossAbsNext - profitAbs));
        }
      } else {
        phase = "waiting_exit";
      }
    } else if (openOrdersCount > 0) {
      phase = "waiting_orders";
    }

    const nextCyclesDone = phase === "cycle_done" ? cycles + 1 : cycles;
    const nextLastCycleAt = phase === "cycle_done" ? new Date().toISOString() : (lastCycleAt || null);
    const nextPhase = phase === "cycle_done" ? "idle" : phase;
    if (phase === "cycle_done") holdUntilNext = null;

    const nextStrategy = {
      ...(item?.strategy ?? {}),
      agent: "scalpingTicks",
      scalpingTicks: {
        ...(prev ?? {}),
        phase: nextPhase,
        marketId,
        line,
        lastTickAt: nowIso,
        lastCycleAt: nextLastCycleAt,
        cyclesDone: nextCyclesDone,
        lastEntryPlacedAt: lastEntryPlacedAtNext,
        lastEntryRepriceAt: lastEntryRepriceAtNext,
        holdUntil: holdUntilNext,
        cooldownUntil: cooldownUntilNext,
        lastBestBack: Number.isFinite(bestBackPrice) ? bestBackPrice : prevLastPrice,
        lastBestBackAt: Number.isFinite(bestBackPrice) ? nowIso : prevLastPriceAtIso,
        lastBestBackMarketId: Number.isFinite(bestBackPrice) ? marketId : prevLastPriceMarketId,
        lastGoals: totalGoals,
        carryLossAbs: carryLossAbsNext,
        lastCarryLossAddedAbs,
        lastCycleProfitAbs,
        lineSnapshots: (() => {
          const next: any = {};
          for (const x of resolvedCandidates) {
            next[String(x.line)] = {
              marketId: x.marketId,
              totalMatched: x.totalMatched,
              underTraded: x.underTraded,
              overTraded: x.overTraded,
              bestBack: x.bestBackPrice,
              bestLay: x.bestLayPrice,
              backDepthSum: x.backDepthSum,
              layDepthSum: x.layDepthSum,
              depthImbalance: x.depthImbalance,
              back1Size: x.bestBackSize,
              lay1Size: x.bestLaySize,
              fetchedAt: nowIso,
            };
          }
          return next;
        })(),
        lastSummary: {
          totalGoals,
          line,
          marketId,
          reason: nextPhase,
          targetTicks,
          entryOffsetTicks,
          maxSpreadTicks,
          minSecondsBetweenCycles,
          stakePct,
          secondsToWaitMatch,
          maxCycles,
          maxLinesToScan,
          minDeltaTraded,
          dominanceRatio,
          dangerMinDeltaTraded,
          dangerDominanceRatio,
          stopLossTicks,
          spreadTicks,
          holdUntil: holdUntilNext,
          timeExitHit,
          steamMove,
          steamDist,
          steamMoveTicks,
          steamMoveWindowSec,
          canEnter,
          activityOk,
          bestBack: Number.isFinite(bestBackPrice) ? bestBackPrice : null,
          bestLay: Number.isFinite(bestLayPrice) ? bestLayPrice : null,
          totalMatched,
          deltaMatched,
          openOrdersCount,
          matchedBetsCount,
          volumeOk: selected.volumeOk,
          goalRisk: selected.goalRisk,
          flowRisk: selected.flowRisk,
          spoofSuspect: selected.spoofSuspect,
          absorptionSuspect: selected.absorptionSuspect,
          defenseSuspect: selected.defenseSuspect,
          backDepthSum: selected.backDepthSum,
          layDepthSum: selected.layDepthSum,
          depthImbalance: selected.depthImbalance,
          deltaUnderTraded: selected.deltaUnderTraded,
          deltaOverTraded: selected.deltaOverTraded,
          minMarketMatched,
          minRunnerMatched,
          ladderDepthLevels,
          minLadderDepthSum,
          flowImbalanceRatio,
          spoofWallMinSize,
          spoofWallDropPct,
          spoofMaxDeltaMatched,
          runnerWindowSec,
          spoofMaxDeltaUnderTraded,
          minAbsorbDeltaUnderTraded,
          dangerDepthCollapseRatio,
          dangerDepthCollapseMinDeltaMatched,
        },
        lastTotalMatched: totalMatched,
      },
    };
    const pickedOu = (() => {
      const cached = ouPrev[String(line)];
      if (cached && typeof cached === "object") return cached;
      return { marketId, odds: { under: { selectionId: underSelectionId, back: bestBackPrice, lay: bestLayPrice } }, oddsFetchedAt: nowIso };
    })();
    const nextBetfair = { ...(item?.betfair ?? {}), overUnder: { ...ouPrev, [String(line)]: pickedOu } };
    await kv.set(key, { ...item, betfair: nextBetfair, strategy: nextStrategy, updatedAt: new Date().toISOString() });

    return c.json({ ok: true, matchId, phase: nextPhase, totalGoals, line, marketId, cyclesDone: nextCyclesDone, placed, openOrdersCount, matchedBetsCount, spreadTicks });
  } catch (error) {
    return c.json({ ok: false, error: error.message || "Erro no robô Scalping em Ticks" }, 500);
  }
};

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

const buildAutomationMarkets = (prediction: any, homeTeam: string | null, awayTeam: string | null) => {
  const p = prediction && typeof prediction === "object" ? prediction : null;
  if (!p) return [];

  const markets: any[] = [];
  const h = homeTeam || "Casa";
  const a = awayTeam || "Visitante";

  const winner = String(p?.winner?.prediction ?? "").trim();
  const winnerConf = Number(p?.winner?.confidence);
  if (winner) {
    const label = winner === "home" ? `Vencedor: ${h}` : winner === "away" ? `Vencedor: ${a}` : "Vencedor: Empate";
    markets.push({
      key: "winner",
      label,
      enabled: false,
      details: Number.isFinite(winnerConf) ? `${Math.round(winnerConf)}%` : null,
    });
  }

  const ouPred = String(p?.overUnder?.prediction ?? "").trim();
  const ouLine = Number(p?.overUnder?.line);
  const ouConf = Number(p?.overUnder?.confidence);
  if (ouPred && Number.isFinite(ouLine)) {
    const side = ouPred === "over" ? "Over" : ouPred === "under" ? "Under" : "OU";
    markets.push({
      key: "overUnder",
      label: `${side} ${ouLine}`,
      enabled: false,
      details: Number.isFinite(ouConf) ? `${Math.round(ouConf)}%` : null,
    });
  }

  const bttsPred = String(p?.btts?.prediction ?? "").trim();
  const bttsConf = Number(p?.btts?.confidence);
  if (bttsPred) {
    markets.push({
      key: "btts",
      label: `Ambas marcam: ${bttsPred === "yes" ? "Sim" : "Não"}`,
      enabled: false,
      details: Number.isFinite(bttsConf) ? `${Math.round(bttsConf)}%` : null,
    });
  }

  const cs = String(p?.correctScore?.score ?? "").trim();
  const csConf = Number(p?.correctScore?.confidence);
  markets.push({
    key: "correctScore",
    label: cs ? `Placar correto: ${cs}` : "Placar correto",
    enabled: true,
    details: Number.isFinite(csConf) ? `${Math.round(csConf)}%` : null,
  });

  const ahTeam = String(p?.asianHandicap?.team ?? "").trim();
  const ahLine = Number(p?.asianHandicap?.line);
  const ahConf = Number(p?.asianHandicap?.confidence);
  if (ahTeam && Number.isFinite(ahLine)) {
    const teamLabel = ahTeam === "home" ? h : a;
    const lineLabel = ahLine > 0 ? `+${ahLine}` : `${ahLine}`;
    markets.push({
      key: "asianHandicap",
      label: `Handicap: ${teamLabel} (${lineLabel})`,
      enabled: false,
      details: Number.isFinite(ahConf) ? `${Math.round(ahConf)}%` : null,
    });
  }

  const fh = String(p?.firstHalf?.prediction ?? "").trim();
  const fhConf = Number(p?.firstHalf?.confidence);
  if (fh) {
    const label = fh === "home" ? h : fh === "away" ? a : "Empate";
    markets.push({
      key: "firstHalf",
      label: `1º tempo: ${label}`,
      enabled: false,
      details: Number.isFinite(fhConf) ? `${Math.round(fhConf)}%` : null,
    });
  }

  const sh = String(p?.secondHalf?.prediction ?? "").trim();
  const shConf = Number(p?.secondHalf?.confidence);
  if (sh) {
    const label = sh === "home" ? h : sh === "away" ? a : "Empate";
    markets.push({
      key: "secondHalf",
      label: `2º tempo: ${label}`,
      enabled: false,
      details: Number.isFinite(shConf) ? `${Math.round(shConf)}%` : null,
    });
  }

  return markets;
};

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
      homeCrest: String(body?.homeCrest ?? "").trim() || existing?.homeCrest || null,
      awayCrest: String(body?.awayCrest ?? "").trim() || existing?.awayCrest || null,
      scoreHome: Number.isFinite(Number(body?.scoreHome)) ? Number(body.scoreHome) : (Number.isFinite(Number(existing?.scoreHome)) ? Number(existing.scoreHome) : null),
      scoreAway: Number.isFinite(Number(body?.scoreAway)) ? Number(body.scoreAway) : (Number.isFinite(Number(existing?.scoreAway)) ? Number(existing.scoreAway) : null),
      prediction: body?.prediction ?? existing?.prediction ?? null,
      markets: Array.isArray(existing?.markets)
        ? existing.markets
        : buildAutomationMarkets(
          body?.prediction ?? existing?.prediction ?? null,
          String(body?.homeTeam ?? existing?.homeTeam ?? "").trim() || null,
          String(body?.awayTeam ?? existing?.awayTeam ?? "").trim() || null,
        ),
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
        payload.utcDate = String(mapped?.marketStartTime ?? "").trim() || payload.utcDate || null;
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

const betfairQueueBatchUpdateHandler = async (c: any) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  try {
    const body = await c.req.json().catch(() => ({}));
    const raw = Array.isArray(body?.updates) ? body.updates : [];
    if (raw.length === 0) return c.json({ ok: true, updated: 0 });
    const limited = raw.slice(0, 50);

    const byId = new Map<string, any>();
    for (const u of limited) {
      const matchId = String(u?.matchId ?? "").trim();
      const patch = (u?.patch && typeof u.patch === "object") ? u.patch : null;
      if (!matchId || !patch) continue;
      byId.set(matchId, patch);
    }
    if (byId.size === 0) return c.json({ ok: true, updated: 0 });

    const matchIds = Array.from(byId.keys());
    const keys = matchIds.map((id) => `${BETFAIR_QUEUE_PREFIX}${id}`);
    const existing = await kv.mget(keys);
    const nowIso = new Date().toISOString();

    const nextValues = existing.map((current, i) => {
      const matchId = matchIds[i];
      const patch = byId.get(matchId) ?? {};
      const base = (current && typeof current === "object") ? current : {};
      return { ...base, ...patch, updatedAt: nowIso };
    });

    await kv.mset(keys, nextValues);
    return c.json({ ok: true, updated: nextValues.length });
  } catch (error) {
    return c.json({ ok: false, error: error.message || "Erro ao atualizar itens" }, 500);
  }
};

const betfairQueueRefreshOddsHandler = async (c: any) => {
  const authError = requireBearer(c);
  if (authError) return authError;
  try {
    const body = await c.req.json().catch(() => ({}));
    const maxRaw = Number(body?.max ?? 10);
    const max = Number.isFinite(maxRaw) ? Math.max(1, Math.min(30, Math.floor(maxRaw))) : 10;
    const minFreshSecondsRaw = Number(body?.minFreshSeconds ?? 10);
    const minFreshSeconds = Number.isFinite(minFreshSecondsRaw) ? Math.max(1, Math.min(120, Math.floor(minFreshSecondsRaw))) : 10;
    const includeCorrectScore = Boolean(body?.includeCorrectScore ?? false);
    const runCorrectScorePlan = Boolean(body?.runCorrectScorePlan ?? false);
    const planConfig = (body?.planConfig && typeof body.planConfig === "object") ? body.planConfig : {};

    const items = await kv.getByPrefix(BETFAIR_QUEUE_PREFIX);
    const list = Array.isArray(items) ? items : [];
    if (list.length === 0) return c.json({ ok: true, updated: 0, skipped: 0, remapped: 0 });

    const now = Date.now();
    const isStale = (iso: string | null | undefined) => {
      const v = String(iso ?? "").trim();
      if (!v) return true;
      const ms = new Date(v).getTime();
      if (!Number.isFinite(ms)) return true;
      const age = (now - ms) / 1000;
      return !Number.isFinite(age) || age < 0 || age >= minFreshSeconds;
    };

    const candidates = list
      .filter((x: any) => {
        const status = String(x?.status ?? "").trim();
        if (status === "stopped") return false;
        return true;
      })
      .slice(0, 200);

    const toRemap = candidates
      .filter((x: any) => !String(x?.betfair?.marketId ?? "").trim())
      .filter((x: any) => String(x?.homeTeam ?? "").trim() && String(x?.awayTeam ?? "").trim())
      .slice(0, Math.min(6, max));

    let remapped = 0;
    for (const x of toRemap) {
      try {
        const mapped = await resolveBetfairMatchOdds({
          homeTeam: String(x.homeTeam),
          awayTeam: String(x.awayTeam),
          utcDate: x?.utcDate,
        });
        const cs = includeCorrectScore ? await resolveBetfairCorrectScoreMarket({ eventId: String(mapped?.eventId ?? "") }) : null;
        const nextBetfair = includeCorrectScore ? { ...mapped, correctScore: cs } : mapped;
        const key = `${BETFAIR_QUEUE_PREFIX}${String(x.matchId)}`;
        const next = {
          ...x,
          betfair: nextBetfair,
          utcDate: String(nextBetfair?.marketStartTime ?? "").trim() || x?.utcDate || null,
          mappingStatus: "mapped",
          mappingError: null,
          mappedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await kv.set(key, next);
        remapped += 1;
      } catch {}
    }

    const refreshable = candidates
      .filter((x: any) => String(x?.betfair?.marketId ?? "").trim())
      .filter((x: any) => Boolean(x?.betfair?.inPlay ?? false) || String(x?.live?.provider ?? "") === "betfair" || isStale(x?.betfair?.oddsFetchedAt ?? x?.betfair?.odds?.fetchedAt ?? null))
      .slice(0, max);

    if (refreshable.length === 0) return c.json({ ok: true, updated: 0, skipped: candidates.length, remapped });

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

    const byMarketId = new Map<string, any>();
    const marketIds = refreshable.map((x: any) => String(x.betfair.marketId));
    for (let i = 0; i < marketIds.length; i += 25) {
      const chunk = marketIds.slice(i, i + 25);
      const books = await withTimeout(
        () =>
          call("SportsAPING/v1.0/listMarketBook", {
            marketIds: chunk,
            priceProjection: { priceData: ["EX_BEST_OFFERS"], virtualise: true },
          }),
        9000,
      );
      if (Array.isArray(books)) for (const b of books) byMarketId.set(String(b?.marketId ?? ""), b);
    }

    const byEventId = new Map<string, any>();
    const eventIds = Array.from(
      new Set(
        refreshable
          .map((x: any) => String(x?.betfair?.eventId ?? "").trim())
          .filter((id: string) => id),
      ),
    );
    for (let i = 0; i < eventIds.length; i += 50) {
      try {
        const chunk = eventIds.slice(i, i + 50);
        const idsParam = encodeURIComponent(chunk.join(","));
        const url = `https://ips.betfair.com/inplayservice/v1.1/eventTimelines?eventIds=${idsParam}&alt=json&regionCode=UK&locale=en_GB`;
        const timelines = await withTimeout(async () => {
          const res = await fetch(url, {
            method: "GET",
            redirect: "follow",
            headers: {
              accept: "application/json",
              "cache-control": "no-cache",
              "user-agent": "Mozilla/5.0",
            },
          });
          if (!res.ok) throw new Error(`IPS HTTP ${res.status}`);
          const text = await res.text();
          try {
            return JSON.parse(text);
          } catch {
            throw new Error("IPS JSON parse error");
          }
        }, 7000);
        if (Array.isArray(timelines)) {
          for (const t of timelines) {
            const eventId = String(t?.eventId ?? "").trim();
            if (eventId) byEventId.set(eventId, t);
          }
        }
      } catch {}
    }

    let updated = 0;
    let skipped = 0;
    for (const x of refreshable) {
      const marketId = String(x?.betfair?.marketId ?? "").trim();
      const book = byMarketId.get(marketId) ?? null;
      if (!book) {
        skipped += 1;
        continue;
      }

      const runners = Array.isArray(book?.runners) ? book.runners : [];
      const pick = (selectionId: number | null | undefined) => {
        const sid = Number(selectionId);
        if (!Number.isFinite(sid)) return { back: null, backSize: null, lay: null, laySize: null };
        const rb = runners.find((r: any) => Number(r?.selectionId) === sid) ?? null;
        const ex = rb?.ex ?? {};
        const back0 = Array.isArray(ex?.availableToBack) ? ex.availableToBack[0] : null;
        const lay0 = Array.isArray(ex?.availableToLay) ? ex.availableToLay[0] : null;
        const ltp = Number(rb?.lastPriceTraded);
        const back = back0 ? Number(back0.price) : (Number.isFinite(ltp) ? ltp : null);
        const lay = lay0 ? Number(lay0.price) : (Number.isFinite(ltp) ? ltp : null);
        const backSize = back0 ? Number(back0.size) : null;
        const laySize = lay0 ? Number(lay0.size) : null;
        return {
          back: Number.isFinite(back as number) ? (back as number) : null,
          backSize: Number.isFinite(backSize as number) ? (backSize as number) : null,
          lay: Number.isFinite(lay as number) ? (lay as number) : null,
          laySize: Number.isFinite(laySize as number) ? (laySize as number) : null,
        };
      };

      const homeSid = Number(x?.betfair?.runners?.homeSelectionId);
      const drawSid = Number(x?.betfair?.runners?.drawSelectionId);
      const awaySid = Number(x?.betfair?.runners?.awaySelectionId);
      const odds = {
        home: pick(Number.isFinite(homeSid) ? homeSid : null),
        draw: pick(Number.isFinite(drawSid) ? drawSid : null),
        away: pick(Number.isFinite(awaySid) ? awaySid : null),
      };

      const totalMatched = Number(book?.totalMatched);
      const marketStatus = String(book?.status ?? "").trim() || null;
      const isClosed = String(marketStatus ?? "").toUpperCase() === "CLOSED";
      const prevInPlay = Boolean(x?.betfair?.inPlay ?? false);
      const inPlay = isClosed ? false : (typeof book?.inplay === "boolean" ? Boolean(book.inplay) : prevInPlay);
      const prevOdds = (x?.betfair?.odds && typeof x.betfair.odds === "object") ? x.betfair.odds : {};
      const mergeSide = (prev: any, next: any) => {
        const p = (prev && typeof prev === "object") ? prev : {};
        const n = (next && typeof next === "object") ? next : {};
        return {
          back: n.back ?? p.back ?? null,
          backSize: n.backSize ?? p.backSize ?? null,
          lay: n.lay ?? p.lay ?? null,
          laySize: n.laySize ?? p.laySize ?? null,
        };
      };
      const mergedOdds = {
        home: mergeSide(prevOdds?.home, odds.home),
        draw: mergeSide(prevOdds?.draw, odds.draw),
        away: mergeSide(prevOdds?.away, odds.away),
      };
      const publishTimeMs = Number(book?.publishTime);
      const publishTime = Number.isFinite(publishTimeMs) ? new Date(publishTimeMs).toISOString() : (x?.betfair?.publishTime ?? null);
      const prevSince = String(x?.betfair?.inPlaySince ?? "").trim() || null;
      const inPlaySince = inPlay ? (prevSince ?? (!prevInPlay ? new Date().toISOString() : null) ?? new Date().toISOString()) : null;
      const prevMatched = Number(x?.betfair?.matchedVolume);
      const matchedVolume = Number.isFinite(totalMatched) && totalMatched > 0
        ? totalMatched
        : Number.isFinite(prevMatched) && prevMatched > 0
        ? prevMatched
        : Number.isFinite(totalMatched)
        ? totalMatched
        : null;
      const nextBetfair = {
        ...(x?.betfair ?? {}),
        matchedVolume,
        inPlay,
        inPlaySince,
        marketStatus,
        publishTime,
        odds: mergedOdds,
        oddsFetchedAt: new Date().toISOString(),
      };

      const eventId = String(x?.betfair?.eventId ?? "").trim();
      const timeline = eventId ? (byEventId.get(eventId) ?? null) : null;
      const elapsed = Number(timeline?.timeElapsed);
      const statusRaw = String(timeline?.status ?? "").trim().toUpperCase();
      const statusShort = statusRaw === "ENDED" ? "FINISHED" : statusRaw || null;
      const scoreHomeRaw = String(timeline?.score?.home?.score ?? "").trim();
      const scoreAwayRaw = String(timeline?.score?.away?.score ?? "").trim();
      const scoreHome = scoreHomeRaw && /^\d+$/.test(scoreHomeRaw) ? Number(scoreHomeRaw) : null;
      const scoreAway = scoreAwayRaw && /^\d+$/.test(scoreAwayRaw) ? Number(scoreAwayRaw) : null;
      const nowIso = new Date().toISOString();
      const fallbackElapsed = (() => {
        if (!inPlay) return null;
        const iso = String(nextBetfair?.marketStartTime ?? x?.utcDate ?? "").trim();
        if (!iso) return null;
        const ms = new Date(iso).getTime();
        if (!Number.isFinite(ms)) return null;
        const diffMin = Math.floor((Date.now() - ms) / 60000);
        if (!Number.isFinite(diffMin) || diffMin < 0 || diffMin > 200) return null;
        return diffMin;
      })();

      const fallbackStatusShort = isClosed ? "FINISHED" : inPlay ? "LIVE" : null;
      const nextLive = timeline
        ? {
            provider: "betfair",
            elapsed: Number.isFinite(elapsed) ? elapsed : fallbackElapsed,
            extra: null,
            statusShort: statusShort || fallbackStatusShort,
            fetchedAt: nowIso,
          }
        : inPlay
        ? {
            provider: "betfair",
            elapsed: fallbackElapsed,
            extra: null,
            statusShort: fallbackStatusShort,
            fetchedAt: nowIso,
          }
        : (x?.live ?? null);


      let cs: any = null;
      if (includeCorrectScore) {
        try {
          const eventId = String(x?.betfair?.eventId ?? "").trim();
          if (eventId) cs = await resolveBetfairCorrectScoreMarket({ eventId });
        } catch {
          cs = null;
        }
      }
      if (includeCorrectScore) nextBetfair.correctScore = cs;

      const key = `${BETFAIR_QUEUE_PREFIX}${String(x.matchId)}`;
      const next: any = {
        ...x,
        utcDate: String(nextBetfair?.marketStartTime ?? "").trim() || x?.utcDate || null,
        scoreHome: (Number.isFinite(scoreHome as number) ? scoreHome : x?.scoreHome ?? null),
        scoreAway: (Number.isFinite(scoreAway as number) ? scoreAway : x?.scoreAway ?? null),
        live: nextLive,
        betfair: nextBetfair,
        updatedAt: new Date().toISOString(),
      };

      if (runCorrectScorePlan) {
        try {
          const plan = planCorrectScoreForQueueItem(next, planConfig);
          next.strategy = {
            ...(next?.strategy ?? {}),
            correctScore: {
              ...(next?.strategy?.correctScore ?? {}),
              lastPlan: plan,
              lastPlannedAt: plan.createdAt,
            },
          };
        } catch {}
      }
      await kv.set(key, next);
      updated += 1;
    }

    return c.json({ ok: true, updated, skipped, remapped });
  } catch (error) {
    return c.json({ ok: false, error: error.message || "Erro ao atualizar odds" }, 500);
  }
};

app.post("/automation/betfair/queue/remove", betfairQueueRemoveHandler);
app.post("/automation/betfair/queue/update", betfairQueueUpdateHandler);
app.post("/automation/betfair/queue/batchUpdate", betfairQueueBatchUpdateHandler);
app.post("/automation/betfair/queue/refreshOdds", betfairQueueRefreshOddsHandler);

app.post("/automation/betfair/strategy/correctScore/plan", betfairCorrectScorePlanHandler);
app.post("/automation/betfair/strategy/correctScore/execute", betfairCorrectScoreExecuteHandler);
app.post("/automation/betfair/strategy/correctScore/rebalance", betfairCorrectScoreRebalanceHandler);
app.post("/automation/betfair/strategy/correctScore/openOrdersSummary", betfairCorrectScoreOpenOrdersSummaryHandler);
app.post("/automation/betfair/strategy/correctScore/cancelOpenOrders", betfairCorrectScoreCancelOpenOrdersHandler);
app.post("/automation/betfair/strategy/correctScore/tradePreview", betfairCorrectScoreTradePreviewHandler);
app.post("/automation/betfair/strategy/correctScore/cashout", betfairCorrectScoreCashoutHandler);
app.post("/automation/betfair/strategy/scalpingGoals/tick", betfairScalpingGoalsTickHandler);
app.post("/automation/betfair/strategy/scalpingTicks/tick", betfairScalpingTicksTickHandler);
app.post("/automation/betfair/strategy/overGoalsLimit/tick", betfairOverGoalsLimitTickHandler);
app.post("/automation/betfair/strategy/asianHandicap/tick", betfairAsianHandicapTickHandler);

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
    const count = await kv.countByPrefix(TRAINING_SAMPLES_PREFIX);
    return c.json({ ok: true, count });
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

    const rows = await kv.listByPrefix(TRAINING_SAMPLES_PREFIX, { offset, limit });
    const items = rows.map((r: any) => r?.value).filter((v: any) => v) as any[];
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

app.post("/cache/api-football/leagues/get", leaguesCacheGetHandler);
app.post("/cache/api-football/leagues/set", leaguesCacheSetHandler);

app.post("/training/meta/get", trainingMetaGetHandler);
app.post("/training/meta/set", trainingMetaSetHandler);

app.post("/training/samples/upsert", trainingSamplesUpsertHandler);
app.post("/training/samples/count", trainingSamplesCountHandler);
app.post("/training/samples/list", trainingSamplesListHandler);

Deno.serve(app.fetch);
} catch (error) {
  __bootError = error;
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const stack = error instanceof Error ? String(error.stack ?? "") : "";
  const body = JSON.stringify({ ok: false, code: "BOOT_TRAP", message, stack });
  Deno.serve((_req) => {
    return new Response(body, {
      status: 500,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      },
    });
  });
}
