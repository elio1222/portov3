## Context: Designing a personalized portfolio website

My portfolio (https://eliorocha.dev) is a static HTML/CSS/JS site hosted on Netlify
(free plan). I want to add live data: my GitHub activity and my Oura ring stats.

### Style
- Each section is built upon a game theme. For example, the Education section is Clash
  of clans based. The Activity section is Minecraft based, etc. The goal of the portfolio
  is that every section should have a unique theme based on my own interests
- Each theme should implement the small cartoon that I have myself in the hero section.
- The style of the website should aim to be minimalistic and simple. It should be easy
  on the eye of the viewer and appealing. Small visual details matter, animations are 
  cool when they are simple. 
- The website should also be mobile responsive, making it easy for mobile users to navigate
  the portfolio
- I also like Drake's music and Kanye West's music, UFC, Jiu-Jitsu, Charles Olivera

### Personal Interests
- Somethings I like include: Mario, Minecraft, Marvel Rivals, The Odyssey, Clash of Clans,
  Spiderman, Blackjack, Graph Theory, Black Ops 4, Poker, Card Games, Scion tc 2007, 
  Hackathons, Money Heist, The Boys, Space, The Martian, Earth, Puzzles, Chess

### Decided approach
- Stay on Netlify. Use Netlify Functions as a thin backend so API secrets live in
  env vars and never reach the browser. The frontend fetches from my own
  /.netlify/functions/* endpoints.
- Netlify free plan is credit-based (300 credits/mo, hard cap pauses the site).
  Function compute is cheap; production deploys (15 credits each) and bandwidth are
  the real costs. Cache API responses with Cache-Control headers.

### Local testing plan
- Use the Netlify CLI (`netlify dev`, ~localhost:8888) to run site + functions.
- Secrets in a gitignored .env, or pulled from the linked Netlify site.
- Add a localhost callback URL as a second redirect URI in the Oura app.
- Blobs uses a local sandboxed store under netlify dev.
- Scheduled functions don't auto-run locally; invoke them manually.
- Oura has sandbox routes with sample data for building the UI first.
- Local and production must each authorize separately and keep their own tokens.