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

Deno.serve(app.fetch);