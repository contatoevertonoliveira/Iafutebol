const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-automation-token, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "600",
};

const json = (body: unknown, status = 200, extraHeaders?: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      ...(extraHeaders ?? {}),
    },
  });

const requireBearer = (req: Request) => {
  const auth = req.headers.get("authorization") ?? "";
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

const proxyGet = async (targetUrl: string, headers: Record<string, string>) => {
  const res = await fetch(targetUrl, { method: "GET", headers });
  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await res.json().catch(() => null) : await res.text().catch(() => "");
  if (!res.ok) {
    return json(
      { ok: false, error: `HTTP ${res.status} ${res.statusText}`, details: payload },
      res.status,
    );
  }
  return isJson ? json(payload, 200) : new Response(String(payload ?? ""), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": contentType || "text/plain; charset=utf-8" } });
};

Deno.serve(async (req) => {
  try {
    const method = req.method.toUpperCase();
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "GET" && (path.endsWith("/health") || path === "/health")) {
    return json({ status: "ok" });
  }

  if (req.method === "POST" && (path.endsWith("/proxy/api-football") || path === "/proxy/api-football")) {
    const body = await readJson(req);
    const targetUrl = String((body as any)?.url ?? "").trim();
    const apiKey = String((body as any)?.apiKey ?? "").trim();
    if (!apiKey) return json({ ok: false, error: "API key não fornecida" }, 400);
    if (!targetUrl) return json({ ok: false, error: "URL não fornecida" }, 400);
    const allowedPrefix = "https://v3.football.api-sports.io/";
    if (!targetUrl.startsWith(allowedPrefix)) return json({ ok: false, error: "URL não permitida" }, 400);
    return await proxyGet(targetUrl, { "x-apisports-key": apiKey });
  }

  return json({ ok: false, error: "Not Found" }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: message || "Internal Server Error" }, 500);
  }
});
