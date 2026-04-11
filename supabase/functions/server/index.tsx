import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import * as kv from "./kv_store.tsx";
const app = new Hono();

// Enable logger
app.use('*', logger(console.log));

// Enable CORS for all routes and methods
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

// Health check endpoint
app.get("/make-server-1119702f/health", (c) => {
  return c.json({ status: "ok" });
});

// Validate Football-Data.org API key
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
      return c.json({
        valid: false,
        error: `API retornou status ${response.status}`,
        details: errorText,
      }, response.status);
    }
  } catch (error) {
    console.error("❌ Erro ao validar API key:", error);
    return c.json({
      valid: false,
      error: error.message || "Erro ao validar API key",
    }, 500);
  }
});

// Validate API-Football.com API key
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
      return c.json({
        valid: false,
        error: `API retornou status ${response.status}`,
        details: errorText,
      }, response.status);
    }
  } catch (error) {
    console.error("❌ Erro ao validar API key:", error);
    return c.json({
      valid: false,
      error: error.message || "Erro ao validar API key",
    }, 500);
  }
});

// Proxy Football-Data.org requests (evita CORS no navegador)
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

// Proxy API-Football.com requests (evita CORS e protege a key no browser)
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

Deno.serve(app.fetch);
