const { connectLambda, store } = require("./_lib/oura");

// Public endpoint: serves only the saved, public-safe summary.
exports.handler = async (event) => {
  connectLambda(event); // required for Blobs in Lambda-compat functions
  try {
    const summary = await store().get("summary", { type: "json" });
    if (!summary) {
      return {
        statusCode: 503,
        headers: { "Cache-Control": "no-store" },
        body: JSON.stringify({ error: "No data yet" }),
      };
    }
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300, s-maxage=900",
      },
      body: JSON.stringify(summary),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: "Unavailable" }) };
  }
};
