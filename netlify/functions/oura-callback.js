const { connectLambda, store, exchangeCode, refreshSummary } = require("./_lib/oura");

const STATE_TTL_MS = 10 * 60 * 1000;

const page = (statusCode, message) => ({
  statusCode,
  headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
  body: message,
});

exports.handler = async (event) => {
  connectLambda(event); // required for Blobs in Lambda-compat functions
  const { code, state, error } = event.queryStringParameters || {};
  if (error) return page(400, `Oura authorization denied: ${error}`);
  if (!code || !state) return page(400, "Missing code or state");

  try {
    const key = `state:${state}`;
    const saved = await store().get(key, { type: "json" });
    if (!saved || Date.now() - saved.createdAt > STATE_TTL_MS) {
      if (saved) await store().delete(key);
      return page(400, "Invalid or expired state");
    }
    await store().delete(key); // one-time use

    await exchangeCode(code);
    await refreshSummary();
    return page(200, "Oura connected. You can close this tab.");
  } catch (err) {
    console.error(err);
    return page(500, "Oura authorization failed");
  }
};
