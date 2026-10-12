## Context: adding live API data to my portfolio

My portfolio (https://eliorocha.dev) is a static HTML/CSS/JS site hosted on Netlify
(free plan). I want to add live data: my GitHub activity and my Oura ring stats.

### Decided approach
- Stay on Netlify. Use Netlify Functions as a thin backend so API secrets live in
  env vars and never reach the browser. The frontend fetches from my own
  /.netlify/functions/* endpoints.
- Netlify free plan is credit-based (300 credits/mo, hard cap pauses the site).
  Function compute is cheap; production deploys (15 credits each) and bandwidth are
  the real costs. Cache API responses with Cache-Control headers.

### GitHub
- No OAuth/callback needed: it's my own public data. Use a fine-grained personal
  access token in an env var. GraphQL API gives the contribution calendar and
  recent repos (GitHub username: elio1222).

### Oura
- Oura deprecated personal access tokens (Dec 2025); OAuth2 is the only option.
  I need to register an app at developer.ouraring.com, do a one-time authorization
  flow (login endpoint -> Oura approval -> callback endpoint exchanges code for
  tokens).
- Oura refresh tokens are SINGLE-USE: each refresh returns a new one that must be
  saved immediately. Plan: store tokens in Netlify Blobs; a scheduled function
  (hourly) refreshes the token and saves a small public-safe summary (sleep,
  readiness, activity scores, steps); a public endpoint only serves that saved
  summary. This avoids concurrent requests racing on the refresh token.
- Protect the login endpoint (secret key) and use an OAuth state param.

### Local testing plan
- Use the Netlify CLI (`netlify dev`, ~localhost:8888) to run site + functions.
- Secrets in a gitignored .env, or pulled from the linked Netlify site.
- Add a localhost callback URL as a second redirect URI in the Oura app.
- Blobs uses a local sandboxed store under netlify dev.
- Scheduled functions don't auto-run locally; invoke them manually.
- Oura has sandbox routes with sample data for building the UI first.
- Local and production must each authorize separately and keep their own tokens.

### Suggested order
1. GitHub function working locally
2. Oura UI built against sandbox data
3. Real Oura OAuth locally
4. Deploy, authorize production once