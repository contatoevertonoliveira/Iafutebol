const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-automation-token, x-client-info",
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

const textResponse = (text: string, status = 200, contentType = "text/plain; charset=utf-8") =>
  new Response(text, { status, headers: { ...CORS_HEADERS, "Content-Type": contentType } });

const readJson = async (req: Request) => {
  try {
    return await req.json();
  } catch {
    return {};
  }
};

const proxyPost = async (targetUrl: string, headers: Record<string, string>, body: unknown) => {
  const response = await fetch(targetUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
  });

  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  if (isJson) {
    const data = await response.json().catch(() => null);
    if (!response.ok) return json({ error: `API retornou status ${response.status}`, details: data }, response.status);
    return json(data, 200);
  }

  const t = await response.text().catch(() => "");
  if (!response.ok) return json({ error: `API retornou status ${response.status}`, details: t }, response.status);
  return textResponse(t, 200, contentType || "text/plain; charset=utf-8");
};

Deno.serve(async (req) => {
  try {
    const method = req.method.toUpperCase();
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "GET" && (path === "/health" || path.endsWith("/health"))) return json({ status: "ok" });

  if (req.method !== "POST") return json({ ok: false, error: "Not Found" }, 404);

  const payload = await readJson(req);
  const targetUrl = String((payload as any)?.url ?? "").trim();
  const apiKey = String((payload as any)?.apiKey ?? "").trim();
  const body = (payload as any)?.body ?? {};

  if (!apiKey) return json({ error: "API key não fornecida" }, 400);
  if (!targetUrl) return json({ error: "URL não fornecida" }, 400);

  if (path.endsWith("/proxy/deepseek") || path === "/proxy/deepseek") {
    const allowedPrefix = "https://api.deepseek.com/v1/";
    if (!targetUrl.startsWith(allowedPrefix)) return json({ error: "URL não permitida" }, 400);
    return await proxyPost(targetUrl, { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body);
  }

  if (path.endsWith("/proxy/openai") || path === "/proxy/openai") {
    const allowedPrefix = "https://api.openai.com/v1/";
    if (!targetUrl.startsWith(allowedPrefix)) return json({ error: "URL não permitida" }, 400);
    return await proxyPost(targetUrl, { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body);
  }

  if (path.endsWith("/proxy/anthropic") || path === "/proxy/anthropic") {
    const allowedPrefix = "https://api.anthropic.com/v1/";
    if (!targetUrl.startsWith(allowedPrefix)) return json({ error: "URL não permitida" }, 400);
    return await proxyPost(
      targetUrl,
      { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body,
    );
  }

  if (path.endsWith("/proxy/google") || path === "/proxy/google") {
    const allowedPrefix = "https://generativelanguage.googleapis.com/";
    if (!targetUrl.startsWith(allowedPrefix)) return json({ error: "URL não permitida" }, 400);
    const requestUrl = (() => {
      try {
        const u = new URL(targetUrl);
        if (!u.searchParams.has("key")) u.searchParams.set("key", apiKey);
        return u.toString();
      } catch {
        return targetUrl;
      }
    })();
    return await proxyPost(requestUrl, { "Content-Type": "application/json" }, body);
  }

    return json({ ok: false, error: "Not Found" }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: message || "Internal Server Error" }, 500);
  }
});
