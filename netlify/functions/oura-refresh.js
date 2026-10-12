const { connectLambda, refreshSummary } = require("./_lib/oura");

// Scheduled hourly. The only place tokens are refreshed, so the single-use
// refresh token can't be raced by concurrent visitors.
// Locally: `netlify functions:invoke oura-refresh`
exports.handler = async (event) => {
  connectLambda(event); // required for Blobs in Lambda-compat functions
  try {
    await refreshSummary();
    return { statusCode: 200 };
  } catch (err) {
    console.error("oura-refresh failed:", err.message);
    return { statusCode: 500 };
  }
};
