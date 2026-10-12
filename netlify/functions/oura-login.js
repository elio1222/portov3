const crypto = require("crypto");
const { connectLambda, store, env, buildAuthorizeUrl } = require("./_lib/oura");

function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Visit /.netlify/functions/oura-login?key=<OURA_LOGIN_KEY> to start the flow.
exports.handler = async (event) => {
  connectLambda(event); // required for Blobs in Lambda-compat functions
  try {
    const key = event.queryStringParameters?.key || "";
    if (!safeEqual(key, env("OURA_LOGIN_KEY"))) {
      return { statusCode: 401, body: "Unauthorized" };
    }

    const state = crypto.randomBytes(24).toString("hex");
    await store().setJSON(`state:${state}`, { createdAt: Date.now() });

    return {
      statusCode: 302,
      headers: { Location: buildAuthorizeUrl(state), "Cache-Control": "no-store" },
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: "Login failed" };
  }
};
