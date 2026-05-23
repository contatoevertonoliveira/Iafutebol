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

const readJson = async (req: Request) => {
  try {
    return await req.json();
  } catch {
    return {};
  }
};

const validateGoogleGeminiKey = async (payload: any) => {
  const apiKey = String(payload?.apiKey ?? "").trim();
  const model = String(payload?.model ?? "").trim();
  if (!apiKey) return json({ valid: false, error: "API key não fornecida" }, 400);
  const m = model || "gemma-4-26b-a4b-it";

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: "Retorne exatamente: OK" }] }],
      generationConfig: { temperature: 0.0, maxOutputTokens: 8 },
    }),
  });

  if (response.ok) return json({ valid: true, message: "API key válida", model: m });

  const contentType = response.headers.get("content-type") || "";
  const details = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");

  return json(
    { valid: false, error: `API retornou status ${response.status}`, details, model: m },
    response.status,
  );
};

const validateApiFootballKey = async (payload: any) => {
  const apiKey = String(payload?.apiKey ?? "").trim();
  if (!apiKey) return json({ valid: false, error: "API key não fornecida" }, 400);

  const response = await fetch("https://v3.football.api-sports.io/timezone", {
    method: "GET",
    headers: { "x-apisports-key": apiKey },
  });

  if (response.ok) {
    const data = await response.json().catch(() => null);
    return json({ valid: true, message: "API key válida", results: Number(data?.results ?? 0) || 0 });
  }

  const details = await response.text().catch(() => "");
  return json({ valid: false, error: `API retornou status ${response.status}`, details }, response.status);
};

Deno.serve(async (req) => {
  const method = String((req as any)?.method ?? "").toUpperCase();
  const isPreflight =
    method === "OPTIONS" || (req.headers.has("origin") && req.headers.has("access-control-request-method"));
  if (isPreflight) return new Response(null, { status: 204, headers: CORS_HEADERS });

  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "GET" && (path === "/health" || path.endsWith("/health"))) return json({ status: "ok" });

  if (req.method !== "POST") return json({ ok: false, error: "Not Found" }, 404);

  const body = await readJson(req);

  try {
    if (path.endsWith("/validate-api/google-gemini") || path === "/validate-api/google-gemini") {
      return await validateGoogleGeminiKey(body);
    }
    if (path.endsWith("/validate-api/api-football") || path === "/validate-api/api-football") {
      return await validateApiFootballKey(body);
    }
    return json({ ok: false, error: "Not Found" }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ valid: false, error: message || "Erro ao validar API key" }, 500);
  }
});
