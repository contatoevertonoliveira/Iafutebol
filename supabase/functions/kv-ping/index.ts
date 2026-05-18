import * as kv from "../make-server-1119702f/kv_store.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.pathname.endsWith("/health")) {
    return json({ ok: true, kvLoaded: Boolean(kv) });
  }
  return json({ ok: true });
});
