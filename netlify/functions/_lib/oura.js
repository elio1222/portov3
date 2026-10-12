const { getStore, connectLambda } = require("@netlify/blobs");

const AUTHORIZE_URL = "https://cloud.ouraring.com/oauth/authorize";
const TOKEN_URL = "https://api.ouraring.com/oauth/token";
const API_BASE = "https://api.ouraring.com";
const SCOPE = "personal daily";
const TIMEOUT_MS = 10000;
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

const store = () => getStore("oura");

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: env("OURA_CLIENT_ID"),
    redirect_uri: env("OURA_REDIRECT_URI"),
    response_type: "code",
    scope: SCOPE,
    state,
  });
  return `${AUTHORIZE_URL}?${params}`;
}

// Single-use refresh tokens: whatever comes back from the token endpoint is
// persisted before anything else happens.
async function requestTokens(grantParams) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...grantParams,
      client_id: env("OURA_CLIENT_ID"),
      client_secret: env("OURA_CLIENT_SECRET"),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token || !body.refresh_token) {
    throw new Error(
      `Oura token request failed (${res.status}): ${body.error_description || body.error || "no tokens returned"}`
    );
  }

  const tokens = {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: Date.now() + (body.expires_in || 3600) * 1000,
  };
  await store().setJSON("tokens", tokens);
  return tokens;
}

const exchangeCode = (code) =>
  requestTokens({
    grant_type: "authorization_code",
    code,
    redirect_uri: env("OURA_REDIRECT_URI"),
  });

async function refreshTokens() {
  const current = await store().get("tokens", { type: "json" });
  if (!current?.refresh_token) {
    throw new Error("No stored tokens. Authorize via oura-login first.");
  }
  return requestTokens({
    grant_type: "refresh_token",
    refresh_token: current.refresh_token,
  });
}

async function getValidTokens({ force = false } = {}) {
  const tokens = await store().get("tokens", { type: "json" });
  if (!tokens) throw new Error("No stored tokens. Authorize via oura-login first.");
  if (force || tokens.expires_at - Date.now() < REFRESH_MARGIN_MS) {
    return refreshTokens();
  }
  return tokens;
}

class OuraApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function ouraGet(path, params, accessToken) {
  const prefix = process.env.OURA_SANDBOX === "true" ? "/v2/sandbox" : "/v2";
  const res = await fetch(`${API_BASE}${prefix}/usercollection/${path}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 403) {
    throw new OuraApiError(403, "Missing permissions or expired Oura subscription");
  }
  if (res.status === 429) throw new OuraApiError(429, "Rate limited by Oura");
  if (!res.ok) throw new OuraApiError(res.status, `Oura API error on ${path}`);
  const body = await res.json();
  return Array.isArray(body.data) ? body.data : [];
}

const isoDay = (d) => d.toISOString().slice(0, 10);
// Oura days are local calendar days, so "today" must be local too. In UTC the
// date flips mid-evening in the US and today's partial activity gets picked.
const TIMEZONE = "America/New_York";
const localDay = (d) => d.toLocaleDateString("en-CA", { timeZone: TIMEZONE });

// Ask for a 7-day window and take the newest entry, so "today's data isn't
// synced yet" falls back to the latest available day instead of failing.
async function fetchSummary(accessToken) {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const params = { start_date: isoDay(start), end_date: isoDay(end) };
  const latest = (rows) => rows.sort((a, b) => a.day.localeCompare(b.day)).at(-1);

  const [sleep, readiness, activity, sessions] = await Promise.all([
    ouraGet("daily_sleep", params, accessToken),
    ouraGet("daily_readiness", params, accessToken),
    ouraGet("daily_activity", params, accessToken),
    ouraGet("sleep", params, accessToken),
  ]);

  const s = latest(sleep);
  const r = latest(readiness);
  // Today's activity is partial, so prefer the latest completed day.
  const today = localDay(end);
  const a = latest(activity.filter((x) => x.day < today)) ?? latest(activity);
  const night = latest(sessions.filter((x) => x.type === "long_sleep"));

  // Flat shape consumed by js/activity.js
  return {
    day: [s?.day, r?.day, a?.day].filter(Boolean).sort().at(-1) ?? null,
    sleep: s?.score ?? null,
    readiness: r?.score ?? null,
    activity: a?.score ?? null,
    steps: a?.steps ?? null,
    activeCalories: a?.active_calories ?? null,
    sleepSeconds: night?.total_sleep_duration ?? null,
    sleepEfficiency: night?.efficiency ?? null,
    restingHr: night?.lowest_heart_rate ?? null,
    hrv: night?.average_hrv ?? null,
    updatedAt: new Date().toISOString(),
  };
}

// Fetch with the stored tokens, forcing one refresh if Oura rejects them.
async function refreshSummary() {
  let tokens = await getValidTokens();
  let summary;
  try {
    summary = await fetchSummary(tokens.access_token);
  } catch (err) {
    if (err.status !== 401) throw err;
    tokens = await getValidTokens({ force: true });
    summary = await fetchSummary(tokens.access_token);
  }
  await store().setJSON("summary", summary);
  return summary;
}

module.exports = { connectLambda, store, env, buildAuthorizeUrl, exchangeCode, refreshSummary };
