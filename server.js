require('dotenv').config();
const express = require('express');
const crypto  = require('crypto');
const path    = require('path');
const fs      = require('fs');
const pptxgen = require('pptxgenjs');

const app = express();

const PUBLIC_DIR = path.join(__dirname, 'public');
const ASSETS_DIR = path.join(PUBLIC_DIR, 'assets');

for (const dir of [PUBLIC_DIR, ASSETS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting by IP (no Firebase required)
const usageMap = new Map();
const FREE_LIMIT = 4;
function getUsage(uid) {
  const now = Date.now(), entry = usageMap.get(uid);
  if (!entry || now > entry.resetAt) return { count: 0, resetAt: now + 86400000 };
  return entry;
}
function incrementUsage(uid) { const e = getUsage(uid); e.count++; usageMap.set(uid, e); return e; }

// Pro token
const SECRET = process.env.SECRET_KEY || 'vybstak-forge-2026';
function generateProToken(id) {
  const sig = crypto.createHmac('sha256', SECRET).update(id).digest('hex');
  return Buffer.from(id + '|' + sig).toString('base64').replace(/=/g,'');
}
function verifyProToken(token) {
  try {
    const d = Buffer.from(token + '==', 'base64').toString('utf8');
    const i = d.lastIndexOf('|'), id = d.slice(0,i), sig = d.slice(i+1);
    const exp = crypto.createHmac('sha256', SECRET).update(id).digest('hex');
    return sig.length === exp.length && crypto.timingSafeEqual(Buffer.from(sig,'hex'), Buffer.from(exp,'hex'));
  } catch { return false; }
}

// Stripe
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Auth helper (Firebase token optional - falls back to IP)
async function getUser(req) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  return { uid: h.slice(7, 30), email: 'user@genesis.app' };
}

function getIP(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '0.0.0.0';
}

// System prompt
const SYSTEM_PROMPT = `You are FORGE — the developer relief engine built by VYBSTAK for indie game developers. You are not a chatbot producing generic advice. You are a veteran producer, publisher scout, and market analyst thinking simultaneously — with the pattern recognition of someone who has watched 10,000 indie games launch, chart, or vanish on Steam, itch.io, and console storefronts.

Your mandate: produce a greenlight report so precise, so honest, and so genuinely useful that the developer reading it cannot imagine entering production without it. Every word earns its place. Nothing generic passes through.

ABSOLUTE QUALITY STANDARDS:
- Name REAL comparable games — never "similar titles" or "other roguelikes". Name the actual comps a publisher would name: their launch year, their rough unit performance if known, why they worked or didn't
- Use REAL verified market figures with source reasoning (SteamDB, VG Insights, GameDiscoverCo, Newzoo, SteamSpy-derived estimates, platform earnings reports)
- Your roadmap milestones must map to real game production: prototype → vertical slice → demo/Next Fest → Early Access or launch → post-launch content. Sequenced for THIS game, not a template
- The verdict score must be earned — sub-60 means sub-60 if the concept deserves it. Most indie pitches deserve honesty, not encouragement
- The one-line verdict must be so specific to this game that it could not apply to any other pitch
- Surface the non-obvious. Anyone can say "the market is crowded." Tell them which comparable will eat their wishlist velocity and which storefront tag they're actually competing in
- Treat SCOPE as the number one killer of indie games. If the pitch is over-scoped for a small team, say so, name what to cut, and name what the vertical slice must prove
- Write the hook analysis like you are a publisher scout deciding in 30 seconds whether to keep reading

TONE: Direct. Incisive. Dev-to-dev. No hedging. No corporate filler. No "it depends." Make a call. You have shipped games and watched games die — talk like it.

STRUCTURE: Respond ONLY with raw JSON starting with { and ending with }. No preamble. No markdown. No backticks. No explanation outside the JSON.

Return exactly this structure:
{
  "concept_title": "The sharpest possible working title — refined if needed",
  "concept_summary": "Two sentences maximum. What this game IS (genre × hook) and why RIGHT NOW is the moment for it.",
  "market_analysis": {
    "overview": "Three to four sentences of genuine games-market intelligence. Name the genre's current trajectory on Steam/console. Name the discovery dynamics (tags, festivals, streamers). Why is now the right window — not 2 years ago, not 2 years from now?",
    "market_size": "Specific genre revenue/units with methodology: e.g. 'Cosy sim genre ≈ $900M/yr on Steam (VG Insights 2025), median indie title 8k units first year'",
    "market_size_value": 900000000,
    "target_audience": [
      "Primary: the specific player archetype — what they play now, what they wishlist, where they hang out (subreddits, Discords, streamers)",
      "Secondary: with size and reachability reasoning",
      "Emerging: the audience segment that will matter in 24 months and why"
    ],
    "trends": [
      "Named trend with specific data point and why it accelerates this game (e.g. demo-driven wishlists, Next Fest conversion rates)",
      "Named trend with named catalyst (a hit game, a platform change, a storefront feature)",
      "Named trend — the counter-intuitive one most indie devs miss"
    ]
  },
  "competitive_landscape": {
    "overview": "Which games own this space right now, what their player expectations have locked in, and where the genuine white space is. Reference wishlist/review-count dynamics where relevant.",
    "competitors": [
      {
        "name": "Real game title (studio, year)",
        "strength": "Their specific structural advantage — mechanics depth, community, content velocity, price anchor",
        "weakness": "The specific exploitable gap — a named design or positioning blind spot this game can attack"
      },
      {
        "name": "Real game title (studio, year)",
        "strength": "Specific strength",
        "weakness": "Specific exploitable weakness"
      },
      {
        "name": "Real game title (studio, year)",
        "strength": "Specific strength",
        "weakness": "Specific exploitable weakness"
      }
    ],
    "your_edge": "Two to three sentences. The genuine defensible hook. What makes this game clip-able, streamable, wishlist-able — mechanical novelty, aesthetic identity, fantasy fulfilment, or community position? If the hook is not yet sharp enough to survive a 15-second trailer, say so and name what must be found in prototyping first."
  },
  "roadmap": [
    {
      "phase": "Phase 01",
      "title": "Prototype",
      "duration": "0–90 days",
      "milestones": [
        "Specific playable-prototype deliverable — the ONE mechanic that must prove fun in isolation",
        "Specific validation milestone — playtest target, named community to test with",
        "Specific kill/continue criterion — what must be true before more money or months go in"
      ]
    },
    {
      "phase": "Phase 02",
      "title": "Vertical Slice",
      "duration": "90–270 days",
      "milestones": [
        "Specific slice deliverable — the 20 minutes that represents final quality",
        "Specific marketing-start milestone — Steam page live, capsule art, first trailer beat",
        "Specific wishlist or community number with reasoning"
      ]
    },
    {
      "phase": "Phase 03",
      "title": "Demo & Momentum",
      "duration": "270–450 days",
      "milestones": [
        "Specific demo/Next Fest milestone with conversion expectation",
        "Specific content-complete or Early Access readiness milestone",
        "Specific partnership milestone — publisher, platform, or creator collab with rationale"
      ]
    },
    {
      "phase": "Phase 04",
      "title": "Launch & Live",
      "duration": "450–720 days",
      "milestones": [
        "Specific launch milestone — wishlist threshold, launch-window strategy, price point",
        "Specific post-launch content cadence milestone",
        "Specific expansion milestone — ports, DLC, sequel positioning, or community systems"
      ]
    }
  ],
  "monetisation": [
    {
      "model": "Primary revenue model name",
      "description": "How this works for THIS game — premium price point vs comps, Early Access ladder, F2P economy, DLC structure. Not generic",
      "potential": "Realistic revenue potential with reasoning anchored to comparable performance"
    },
    {
      "model": "Secondary revenue model",
      "description": "How it works and when it becomes meaningful",
      "potential": "Revenue potential"
    },
    {
      "model": "Emerging revenue model",
      "description": "The revenue line most devs in this genre miss — ports, merch, soundtrack, licensing, platform deals",
      "potential": "Revenue potential"
    }
  ],
  "risks": [
    {
      "risk": "The single biggest existential risk — usually scope, hook weakness, or discovery failure. The one that kills this game if ignored",
      "impact": "High",
      "impact_score": 3,
      "mitigation": "Specific, actionable mitigation with timeline"
    },
    {
      "risk": "Second material risk — market or comp-driven",
      "impact": "High",
      "impact_score": 3,
      "mitigation": "Specific mitigation"
    },
    {
      "risk": "Production risk — the internal failure mode for this team size and scope",
      "impact": "Medium",
      "impact_score": 2,
      "mitigation": "Specific mitigation"
    },
    {
      "risk": "The non-obvious risk most devs in this genre don't see coming",
      "impact": "Medium",
      "impact_score": 2,
      "mitigation": "Specific mitigation"
    }
  ],
  "opportunities": [
    "Named opportunity with specific timing catalyst — why this window opens in the next 12 months (a festival, a platform push, a genre gap)",
    "Named partnership or discovery opportunity — named category of streamer, curator, publisher, or platform program",
    "Named platform or storefront shift that creates asymmetric upside",
    "The adjacent audience or mode this game is perfectly positioned to capture after proving the core loop"
  ],
  "verdict": {
    "score": 78,
    "rating": "STRONG SIGNAL",
    "summary": "Three sentences. Brutally honest. What is the genuine promise of this game, what is the real risk that could kill it, and what is the single most important thing the developer must do in the next 90 days. Write it like you are talking to a dev you respect.",
    "one_line": "One line. Specific to this game. Unforgettable. The line they will remember at 3am mid-crunch when it gets hard."
  }
}

Scoring criteria — be ruthless:
90–100: FORGE SIGNAL — Rare. Hook is sharp, scope is sane, window is open, team has an unfair advantage.
75–89: STRONG SIGNAL — Solid concept with a clear path. Execution and marketing discipline are the variables.
60–74: VIABLE — Works if the dev is exceptional and the scope holds. Average execution stalls at 300 wishlists.
40–59: NEEDS WORK — Core hook or scope has a hole. Name it clearly.
Below 40: BACK TO THE FORGE — Don't sugarcoat it. Explain why and what to fix before another hour goes into production.`;


// VIP codes — comma-separated in env var VIP_CODES
// e.g. VIP_CODES=GENESIS-VIP-001,GENESIS-VIP-002,INVESTOR-001
const VIP_CODES = (process.env.VIP_CODES || 'FORGE-EARLY-ACCESS,VYBSTAK-PRO,VALENCIA-GAMECITY').split(',').map(c=>c.trim().toUpperCase());

function generateVIPToken(code) {
  return crypto.createHmac('sha256', SECRET).update('VIP:'+code).digest('hex').slice(0,32);
}
function verifyVIPToken(token) {
  return VIP_CODES.some(code => generateVIPToken(code) === token);
}

// VIP endpoint
app.post('/api/vip', (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ valid: false });
  const upper = code.trim().toUpperCase();
  if (VIP_CODES.includes(upper)) {
    res.json({ valid: true, token: generateVIPToken(upper) });
  } else {
    res.status(401).json({ valid: false });
  }
});

// Routes
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'forge', timestamp: new Date().toISOString() });
});

app.get('/api/usage', async (req, res) => {
  const ip = getIP(req);
  const { count, resetAt } = getUsage(ip);
  res.json({ used: count, limit: FREE_LIMIT, resetAt });
});

// Enhance endpoint — rewrites the concept into a stronger, more detailed prompt
app.post('/api/enhance', async (req, res) => {
  const { concept } = req.body;
  if (!concept || concept.trim().length < 3) return res.status(400).json({ error: 'Enter a pitch first.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured.' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.FORGE_MODEL || process.env.GENESIS_MODEL || 'claude-sonnet-4-6',
        max_tokens: 400,
        system: `You are a pitch sharpener for FORGE, a greenlight intelligence engine for indie game developers. Your job is to take a rough game pitch and rewrite it into a clearer, sharper, more pitchable version — while preserving the developer's original vision entirely. Do NOT change what game they are making. Sharpen it. Make the hook explicit (genre × twist), name the player fantasy, and hint at the core loop. Keep it to 2-3 sentences maximum. Return ONLY the enhanced pitch text — no quotes, no preamble, no explanation, no markdown.`,
        messages: [{ role: 'user', content: concept.trim() }]
      })
    });

    if (!response.ok) {
      console.error('Enhance API error:', response.status);
      return res.status(502).json({ error: 'Enhance failed.' });
    }

    const data = await response.json();
    const enhanced = (data.content?.[0]?.text || concept).trim();
    res.json({ enhanced });

  } catch(err) {
    console.error('Enhance error:', err);
    res.status(500).json({ error: 'Internal error.' });
  }
});

app.post('/api/forge', async (req, res) => {
  const { concept, proToken } = req.body;
  if (!concept || concept.trim().length < 5) return res.status(400).json({ error: 'Please describe your game.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured.' });

  const vipHeader = req.headers['x-vip-token'];
  const isVIP = vipHeader && verifyVIPToken(vipHeader);
  const isPro = isVIP || (proToken && verifyProToken(proToken));
  const uid = getIP(req);
  const model = isPro
    ? (process.env.FORGE_PRO_MODEL || process.env.GENESIS_PRO_MODEL || 'claude-fable-5')
    : (process.env.FORGE_MODEL || process.env.GENESIS_MODEL || 'claude-sonnet-4-6');

  if (!isPro) {
    const usage = getUsage(uid);
    if (usage.count >= FREE_LIMIT) return res.status(429).json({ error: 'Daily limit reached', code: 'RATE_LIMIT', resetAt: usage.resetAt });
    incrementUsage(uid);
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model, max_tokens: 6000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Analyse this game pitch and return the Forge Engine JSON greenlight report:\n\n${concept.trim()}` }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('Anthropic error:', err);
      return res.status(502).json({ error: 'Forge Engine API error.' });
    }

    const data = await response.json();
    const rawText = data.content?.[0]?.text || '';
    let cleaned = rawText.replace(/^```json\n?|```$/gm, '').trim();
    const fb = cleaned.indexOf('{'), lb = cleaned.lastIndexOf('}');
    if (fb !== -1 && lb !== -1) cleaned = cleaned.slice(fb, lb + 1);

    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch(e) { console.error('Parse error:', e); return res.status(500).json({ error: 'Forge Engine returned malformed data. Try again.' }); }

    const usage = getUsage(uid);
    res.json({ ...parsed, _meta: { isPro, model, teaser: !isPro, freeUsed: isPro ? null : usage.count, freeLimit: FREE_LIMIT } });

  } catch(err) { console.error('Server error:', err); res.status(500).json({ error: 'Internal server error.' }); }
});


// ── LAUNCHPAD — Native PPTX Pitch Deck Generator (Pro only) ─────────
const DECKS_DIR = path.join(PUBLIC_DIR, 'decks');
if (!fs.existsSync(DECKS_DIR)) fs.mkdirSync(DECKS_DIR, { recursive: true });
app.use('/decks', express.static(DECKS_DIR, { maxAge: '1h' }));

// Cleanup old decks (>2h)
setInterval(() => {
  try {
    const files = fs.readdirSync(DECKS_DIR);
    const now = Date.now();
    files.forEach(f => {
      const fp = path.join(DECKS_DIR, f);
      const stat = fs.statSync(fp);
      if (now - stat.mtimeMs > 7200000) fs.unlinkSync(fp);
    });
  } catch(e) {}
}, 600000);


// ── DESIGN SYSTEM ──
const BG='090909', BG2='0D0D0D', SURFACE='131313', CARD='181818';
const BORDER='1F1F1F', RULE='2A2A2A';
const TERRA='C4522A', TERRA_L='D4623A', TERRA_DIM='8A3A1D';
const WHITE='F0EDE8', LIGHT='D0CCC6', DIM='8A8A8A', MUTED='5A5A5A', FAINT='333333';
const FONT_H='Arial Black', FONT_B='Calibri';
const mkShadow=()=>({type:'outer',blur:6,offset:2,angle:135,color:'000000',opacity:0.25});

// Helpers
function addFooter(s, title) {
  s.addShape(s._slideLayout?._presLayout?._presObj?.shapes?.RECTANGLE || 'rect',
    { x:0, y:5.35, w:10, h:0.275, fill:{color:BG2} });
  // Fallback: just use addText for footer
}
function safeText(t, max) { return (t||'').length > max ? (t||'').slice(0, max-1) + '…' : (t||''); }

function buildLaunchpadDeck(report, concept) {
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_16x9'; // 10" x 5.625"
  pres.author = 'FORGE — VYBSTAK Technologies';
  pres.title = report.concept_title || concept || 'Game Pitch';

  const title = report.concept_title || concept || 'Untitled Game';
  const summary = report.concept_summary || '';
  const market = report.market_analysis || {};
  const comp = report.competitive_landscape || {};
  const roadmap = report.roadmap || [];
  const monetisation = report.monetisation || [];
  const risks = report.risks || [];
  const opportunities = report.opportunities || [];
  const verdict = report.verdict || {};

  const addSlideFooter = (s) => {
    s.addShape(pres.shapes.RECTANGLE, { x:0, y:5.25, w:10, h:0.375, fill:{color:BG2} });
    s.addText('FORGE DECK', { x:0.7, y:5.3, w:1.5, h:0.25, fontSize:5.5, fontFace:FONT_B, color:TERRA, charSpacing:4, margin:0 });
    s.addText(safeText(title, 50).toUpperCase(), { x:2.2, y:5.3, w:5, h:0.25, fontSize:5.5, fontFace:FONT_B, color:MUTED, charSpacing:2, margin:0 });
    s.addShape(pres.shapes.RECTANGLE, { x:0, y:5.25, w:10, h:0.008, fill:{color:FAINT} });
  };

  // ═══════════════════════════════════════════════════════════════════
  // SLIDE 1 — TITLE
  // ═══════════════════════════════════════════════════════════════════
  let s = pres.addSlide();
  s.background = { color: BG };
  // Top accent line
  s.addShape(pres.shapes.RECTANGLE, { x:0, y:0, w:10, h:0.035, fill:{color:TERRA} });
  // Bottom accent line
  s.addShape(pres.shapes.RECTANGLE, { x:0, y:5.59, w:10, h:0.035, fill:{color:TERRA} });
  // Engine label
  s.addText('FORGE — DEVELOPER RELIEF ENGINE', { x:0.8, y:0.5, w:4, h:0.25, fontSize:7, fontFace:FONT_B, color:TERRA, charSpacing:6, margin:0 });
  // Left accent bar
  s.addShape(pres.shapes.RECTANGLE, { x:0.8, y:1.15, w:0.06, h:1.8, fill:{color:TERRA} });
  // Title
  s.addText(title.toUpperCase(), { x:1.1, y:1.15, w:6.5, h:1.8, fontSize:40, fontFace:FONT_H, color:WHITE, valign:'middle', lineSpacingMultiple:1.05, margin:0 });
  // Summary
  s.addText(summary, { x:1.1, y:3.2, w:6.0, h:0.8, fontSize:13, fontFace:FONT_B, color:DIM, lineSpacingMultiple:1.6, margin:0 });
  // Score block (right)
  s.addShape(pres.shapes.RECTANGLE, { x:8.0, y:1.15, w:1.5, h:2.2, fill:{color:SURFACE}, line:{color:BORDER, width:0.5}, shadow:mkShadow() });
  s.addShape(pres.shapes.RECTANGLE, { x:8.0, y:1.15, w:1.5, h:0.035, fill:{color:TERRA} });
  s.addText(String(verdict.score||'—'), { x:8.0, y:1.35, w:1.5, h:1.0, fontSize:44, fontFace:FONT_H, color:TERRA, align:'center', valign:'middle', margin:0 });
  s.addText('/100', { x:8.0, y:2.2, w:1.5, h:0.3, fontSize:8, fontFace:FONT_B, color:MUTED, align:'center', margin:0 });
  s.addText((verdict.rating||'FORGE SIGNAL').toUpperCase(), { x:8.0, y:2.55, w:1.5, h:0.3, fontSize:6.5, fontFace:FONT_B, color:TERRA, align:'center', charSpacing:3, margin:0 });
  // Bottom info
  s.addText('VYBSTAK Technologies SL  ·  Valencia, Spain', { x:0.8, y:4.65, w:5, h:0.2, fontSize:7, fontFace:FONT_B, color:MUTED, charSpacing:2, margin:0 });
  s.addText('CONFIDENTIAL', { x:7.2, y:4.65, w:2.3, h:0.2, fontSize:6, fontFace:FONT_B, color:FAINT, align:'right', charSpacing:4, margin:0 });

  // ═══════════════════════════════════════════════════════════════════
  // SLIDE 2 — THE PROBLEM
  // ═══════════════════════════════════════════════════════════════════
  s = pres.addSlide();
  s.background = { color: BG };
  s.addShape(pres.shapes.RECTANGLE, { x:0, y:0, w:10, h:0.035, fill:{color:TERRA} });
  s.addText('01', { x:0.7, y:0.35, w:0.8, h:0.45, fontSize:28, fontFace:FONT_H, color:FAINT, margin:0 });
  s.addText('THE PLAYER', { x:0.7, y:0.75, w:4, h:0.3, fontSize:8, fontFace:FONT_B, color:TERRA, charSpacing:5, margin:0 });
  // Large statement
  const audiences = market.target_audience || [];
  s.addText(safeText(audiences[0] || 'A player fantasy exists in this genre — and nobody is serving it properly.', 220), {
    x:0.7, y:1.5, w:8.5, h:1.5, fontSize:22, fontFace:FONT_H, color:WHITE, lineSpacingMultiple:1.3, margin:0
  });
  // Divider
  s.addShape(pres.shapes.RECTANGLE, { x:0.7, y:3.3, w:1.0, h:0.02, fill:{color:TERRA} });
  // Secondary audiences as cards
  if (audiences.length > 1) {
    audiences.slice(1, 3).forEach((a, i) => {
      const ay = 3.65 + i * 0.7;
      s.addShape(pres.shapes.RECTANGLE, { x:0.7, y:ay, w:8.5, h:0.55, fill:{color:SURFACE} });
      s.addShape(pres.shapes.RECTANGLE, { x:0.7, y:ay, w:0.04, h:0.55, fill:{color:TERRA} });
      s.addText(safeText(a, 160), { x:1.0, y:ay, w:8.0, h:0.55, fontSize:9.5, fontFace:FONT_B, color:DIM, valign:'middle', margin:0 });
    });
  }
  addSlideFooter(s);

  // ═══════════════════════════════════════════════════════════════════
  // SLIDE 3 — MARKET OPPORTUNITY
  // ═══════════════════════════════════════════════════════════════════
  s = pres.addSlide();
  s.background = { color: BG };
  s.addShape(pres.shapes.RECTANGLE, { x:0, y:0, w:10, h:0.035, fill:{color:TERRA} });
  s.addText('02', { x:0.7, y:0.35, w:0.8, h:0.45, fontSize:28, fontFace:FONT_H, color:FAINT, margin:0 });
  s.addText('MARKET WINDOW', { x:0.7, y:0.75, w:5, h:0.3, fontSize:8, fontFace:FONT_B, color:TERRA, charSpacing:5, margin:0 });
  // TAM big number callout
  s.addShape(pres.shapes.RECTANGLE, { x:0.7, y:1.35, w:4.0, h:1.5, fill:{color:SURFACE}, shadow:mkShadow() });
  s.addShape(pres.shapes.RECTANGLE, { x:0.7, y:1.35, w:4.0, h:0.035, fill:{color:TERRA} });
  s.addText('GENRE MARKET SIZE', { x:0.95, y:1.5, w:3.5, h:0.2, fontSize:6, fontFace:FONT_B, color:TERRA, charSpacing:3, margin:0 });
  s.addText(safeText(market.market_size || 'Market size TBD', 80), { x:0.95, y:1.8, w:3.5, h:0.85, fontSize:14, fontFace:FONT_H, color:WHITE, lineSpacingMultiple:1.2, margin:0 });
  // Overview (right column)
  s.addText(safeText(market.overview || '', 350), { x:5.2, y:1.35, w:4.3, h:1.5, fontSize:10.5, fontFace:FONT_B, color:DIM, lineSpacingMultiple:1.6, margin:0 });
  // Trends
  const trends = market.trends || [];
  trends.slice(0, 3).forEach((t, i) => {
    const ty = 3.2 + i * 0.6;
    s.addShape(pres.shapes.RECTANGLE, { x:0.7, y:ty, w:8.8, h:0.48, fill:{color:SURFACE} });
    s.addShape(pres.shapes.RECTANGLE, { x:0.7, y:ty, w:0.035, h:0.48, fill:{color:TERRA} });
    s.addText(safeText(t, 140), { x:1.0, y:ty, w:8.3, h:0.48, fontSize:9, fontFace:FONT_B, color:DIM, valign:'middle', margin:0 });
  });
  addSlideFooter(s);

  // ═══════════════════════════════════════════════════════════════════
  // SLIDE 4 — COMPETITIVE LANDSCAPE
  // ═══════════════════════════════════════════════════════════════════
  s = pres.addSlide();
  s.background = { color: BG };
  s.addShape(pres.shapes.RECTANGLE, { x:0, y:0, w:10, h:0.035, fill:{color:TERRA} });
  s.addText('03', { x:0.7, y:0.35, w:0.8, h:0.45, fontSize:28, fontFace:FONT_H, color:FAINT, margin:0 });
  s.addText('COMPARABLE TITLES', { x:0.7, y:0.75, w:5, h:0.3, fontSize:8, fontFace:FONT_B, color:TERRA, charSpacing:5, margin:0 });
  // Competitor cards — max 3, evenly spaced
  const comps = (comp.competitors || []).slice(0, 3);
  const cGap = 0.2;
  const cW = comps.length > 0 ? (8.6 - (comps.length-1)*cGap) / comps.length : 8.6;
  comps.forEach((c, i) => {
    const cx = 0.7 + i * (cW + cGap);
    s.addShape(pres.shapes.RECTANGLE, { x:cx, y:1.25, w:cW, h:1.85, fill:{color:SURFACE}, shadow:mkShadow() });
    s.addShape(pres.shapes.RECTANGLE, { x:cx, y:1.25, w:cW, h:0.035, fill:{color:TERRA} });
    s.addText(safeText(c.name||'', 25).toUpperCase(), { x:cx+0.25, y:1.42, w:cW-0.5, h:0.3, fontSize:13, fontFace:FONT_H, color:TERRA, margin:0 });
    s.addText([
      { text: 'Strength: ', options:{ bold:true, fontSize:8, color:LIGHT, fontFace:FONT_B } },
      { text: safeText(c.strength||'', 90), options:{ fontSize:8, color:DIM, fontFace:FONT_B, breakLine:true } },
      { text: 'Gap: ', options:{ bold:true, fontSize:8, color:LIGHT, fontFace:FONT_B } },
      { text: safeText(c.weakness||'', 90), options:{ fontSize:8, color:DIM, fontFace:FONT_B } }
    ], { x:cx+0.25, y:1.85, w:cW-0.5, h:1.1, lineSpacingMultiple:1.45, margin:0 });
  });
  // Your moat
  s.addShape(pres.shapes.RECTANGLE, { x:0.7, y:3.45, w:0.05, h:1.2, fill:{color:TERRA} });
  s.addText('YOUR HOOK', { x:0.95, y:3.45, w:2, h:0.22, fontSize:7, fontFace:FONT_B, color:TERRA, charSpacing:4, margin:0 });
  s.addText(safeText(comp.your_edge || '', 280), { x:0.95, y:3.75, w:8.5, h:0.85, fontSize:11, fontFace:FONT_B, color:LIGHT, lineSpacingMultiple:1.55, margin:0 });
  addSlideFooter(s);

  // ═══════════════════════════════════════════════════════════════════
  // SLIDE 5 — REVENUE ARCHITECTURE
  // ═══════════════════════════════════════════════════════════════════
  s = pres.addSlide();
  s.background = { color: BG };
  s.addShape(pres.shapes.RECTANGLE, { x:0, y:0, w:10, h:0.035, fill:{color:TERRA} });
  s.addText('04', { x:0.7, y:0.35, w:0.8, h:0.45, fontSize:28, fontFace:FONT_H, color:FAINT, margin:0 });
  s.addText('REVENUE DESIGN', { x:0.7, y:0.75, w:5, h:0.3, fontSize:8, fontFace:FONT_B, color:TERRA, charSpacing:5, margin:0 });
  monetisation.slice(0, 3).forEach((m, i) => {
    const my = 1.3 + i * 1.2;
    s.addShape(pres.shapes.RECTANGLE, { x:0.7, y:my, w:8.6, h:1.0, fill:{color:SURFACE}, shadow:mkShadow() });
    // Left accent — primary gets full terra, others get dimmer
    s.addShape(pres.shapes.RECTANGLE, { x:0.7, y:my, w:0.045, h:1.0, fill:{color:i===0?TERRA:TERRA_DIM} });
    // Model name
    s.addText(safeText(m.model||'', 40).toUpperCase(), { x:1.0, y:my+0.1, w:3.5, h:0.3, fontSize:13, fontFace:FONT_H, color:i===0?TERRA:WHITE, margin:0 });
    // Description
    s.addText(safeText(m.description||'', 150), { x:1.0, y:my+0.45, w:5.5, h:0.45, fontSize:9, fontFace:FONT_B, color:DIM, lineSpacingMultiple:1.4, margin:0 });
    // Revenue potential (right aligned)
    s.addText(safeText(m.potential||'', 60), { x:6.8, y:my+0.1, w:2.3, h:0.8, fontSize:8.5, fontFace:FONT_B, color:TERRA, align:'right', valign:'middle', margin:0 });
  });
  addSlideFooter(s);

  // ═══════════════════════════════════════════════════════════════════
  // SLIDE 6 — EXECUTION ROADMAP
  // ═══════════════════════════════════════════════════════════════════
  s = pres.addSlide();
  s.background = { color: BG };
  s.addShape(pres.shapes.RECTANGLE, { x:0, y:0, w:10, h:0.035, fill:{color:TERRA} });
  s.addText('05', { x:0.7, y:0.35, w:0.8, h:0.45, fontSize:28, fontFace:FONT_H, color:FAINT, margin:0 });
  s.addText('PRODUCTION ROADMAP', { x:0.7, y:0.75, w:5, h:0.3, fontSize:8, fontFace:FONT_B, color:TERRA, charSpacing:5, margin:0 });
  // Timeline line
  s.addShape(pres.shapes.RECTANGLE, { x:0.7, y:1.36, w:8.6, h:0.015, fill:{color:RULE} });
  // Phase columns
  const phases = roadmap.slice(0, 4);
  const pW = phases.length > 0 ? (8.6 - (phases.length-1)*0.15) / phases.length : 2.0;
  phases.forEach((p, i) => {
    const px = 0.7 + i * (pW + 0.15);
    // Dot on timeline
    s.addShape(pres.shapes.OVAL, { x:px+pW/2-0.07, y:1.29, w:0.14, h:0.14, fill:{color:i===0?TERRA:MUTED} });
    // Phase card
    s.addShape(pres.shapes.RECTANGLE, { x:px, y:1.6, w:pW, h:3.35, fill:{color:SURFACE}, shadow:mkShadow() });
    if(i===0) s.addShape(pres.shapes.RECTANGLE, { x:px, y:1.6, w:pW, h:0.035, fill:{color:TERRA} });
    // Phase label
    s.addText((p.phase||'').toUpperCase(), { x:px+0.15, y:1.72, w:pW-0.3, h:0.18, fontSize:6, fontFace:FONT_B, color:TERRA, charSpacing:3, margin:0 });
    // Phase title
    s.addText(safeText(p.title||'', 20), { x:px+0.15, y:1.92, w:pW-0.3, h:0.3, fontSize:11, fontFace:FONT_H, color:WHITE, margin:0 });
    // Duration
    s.addText(p.duration||'', { x:px+0.15, y:2.22, w:pW-0.3, h:0.2, fontSize:7, fontFace:FONT_B, color:MUTED, margin:0 });
    // Divider inside card
    s.addShape(pres.shapes.RECTANGLE, { x:px+0.15, y:2.48, w:pW-0.3, h:0.008, fill:{color:FAINT} });
    // Milestones — limit to 3
    const ms = (p.milestones||[]).slice(0, 3).map((m, mi, arr) => ({
      text: safeText(m, 65),
      options: { bullet:true, fontSize:7.5, fontFace:FONT_B, color:DIM, breakLine: mi < arr.length - 1, paraSpaceAfter:5 }
    }));
    if(ms.length) s.addText(ms, { x:px+0.15, y:2.58, w:pW-0.3, h:2.2, lineSpacingMultiple:1.25, margin:0 });
  });

  // ═══════════════════════════════════════════════════════════════════
  // SLIDE 7 — RISK REGISTER
  // ═══════════════════════════════════════════════════════════════════
  s = pres.addSlide();
  s.background = { color: BG };
  s.addShape(pres.shapes.RECTANGLE, { x:0, y:0, w:10, h:0.035, fill:{color:TERRA} });
  s.addText('06', { x:0.7, y:0.35, w:0.8, h:0.45, fontSize:28, fontFace:FONT_H, color:FAINT, margin:0 });
  s.addText('WHERE GAMES DIE', { x:0.7, y:0.75, w:5, h:0.3, fontSize:8, fontFace:FONT_B, color:TERRA, charSpacing:5, margin:0 });
  // 2x2 grid with generous gaps
  risks.slice(0, 4).forEach((r, i) => {
    const rx = i % 2 === 0 ? 0.7 : 5.15;
    const ry = i < 2 ? 1.25 : 3.15;
    s.addShape(pres.shapes.RECTANGLE, { x:rx, y:ry, w:4.15, h:1.65, fill:{color:SURFACE}, shadow:mkShadow() });
    // Impact badge
    const isHigh = (r.impact||'').toLowerCase()==='high';
    s.addShape(pres.shapes.RECTANGLE, { x:rx+0.2, y:ry+0.15, w:0.55, h:0.22, fill:{color:isHigh?TERRA:MUTED}, transparency:75 });
    s.addText((r.impact||'MED').toUpperCase(), { x:rx+0.2, y:ry+0.15, w:0.55, h:0.22, fontSize:5.5, fontFace:FONT_B, color:isHigh?TERRA:DIM, align:'center', valign:'middle', charSpacing:1, margin:0 });
    // Risk name
    s.addText(safeText(r.risk||'', 80), { x:rx+0.2, y:ry+0.45, w:3.75, h:0.4, fontSize:10, fontFace:FONT_H, color:WHITE, lineSpacingMultiple:1.1, margin:0 });
    // Mitigation
    s.addText(safeText(r.mitigation||'', 120), { x:rx+0.2, y:ry+0.92, w:3.75, h:0.6, fontSize:8, fontFace:FONT_B, color:MUTED, lineSpacingMultiple:1.35, margin:0 });
  });
  addSlideFooter(s);

  // ═══════════════════════════════════════════════════════════════════
  // SLIDE 8 — GROWTH OPPORTUNITIES
  // ═══════════════════════════════════════════════════════════════════
  s = pres.addSlide();
  s.background = { color: BG };
  s.addShape(pres.shapes.RECTANGLE, { x:0, y:0, w:10, h:0.035, fill:{color:TERRA} });
  s.addText('07', { x:0.7, y:0.35, w:0.8, h:0.45, fontSize:28, fontFace:FONT_H, color:FAINT, margin:0 });
  s.addText('DISCOVERY OPPORTUNITIES', { x:0.7, y:0.75, w:5, h:0.3, fontSize:8, fontFace:FONT_B, color:TERRA, charSpacing:5, margin:0 });
  opportunities.slice(0, 4).forEach((o, i) => {
    const oy = 1.3 + i * 0.9;
    s.addShape(pres.shapes.RECTANGLE, { x:0.7, y:oy, w:8.6, h:0.72, fill:{color:SURFACE} });
    s.addShape(pres.shapes.RECTANGLE, { x:0.7, y:oy, w:0.04, h:0.72, fill:{color:TERRA} });
    // Number badge
    s.addText(String(i+1), { x:0.95, y:oy, w:0.4, h:0.72, fontSize:16, fontFace:FONT_H, color:FAINT, valign:'middle', margin:0 });
    s.addText(safeText(o, 160), { x:1.5, y:oy, w:7.6, h:0.72, fontSize:10.5, fontFace:FONT_B, color:DIM, valign:'middle', lineSpacingMultiple:1.35, margin:0 });
  });
  addSlideFooter(s);

  // ═══════════════════════════════════════════════════════════════════
  // SLIDE 9 — GENESIS VERDICT
  // ═══════════════════════════════════════════════════════════════════
  s = pres.addSlide();
  s.background = { color: BG };
  s.addShape(pres.shapes.RECTANGLE, { x:0, y:0, w:10, h:0.035, fill:{color:TERRA} });
  // Giant score watermark
  s.addText(String(verdict.score||''), { x:-0.3, y:0.2, w:5, h:4.5, fontSize:160, fontFace:FONT_H, color:FAINT, transparency:60, margin:0 });
  // Rating + score
  s.addText('FORGE VERDICT', { x:0.7, y:0.5, w:5, h:0.3, fontSize:8, fontFace:FONT_B, color:TERRA, charSpacing:5, margin:0 });
  s.addText((verdict.rating||'').toUpperCase() + '   ·   ' + (verdict.score||'—') + ' / 100', { x:0.7, y:1.1, w:8, h:0.35, fontSize:11, fontFace:FONT_B, color:TERRA, charSpacing:2, margin:0 });
  // Divider
  s.addShape(pres.shapes.RECTANGLE, { x:0.7, y:1.65, w:1.2, h:0.02, fill:{color:TERRA} });
  // Summary
  s.addText(safeText(verdict.summary||'', 350), { x:0.7, y:1.9, w:8.6, h:1.1, fontSize:12, fontFace:FONT_B, color:DIM, lineSpacingMultiple:1.65, margin:0 });
  // One-liner — big, cinematic
  s.addShape(pres.shapes.RECTANGLE, { x:0.7, y:3.3, w:8.6, h:1.4, fill:{color:SURFACE}, shadow:mkShadow() });
  s.addShape(pres.shapes.RECTANGLE, { x:0.7, y:3.3, w:0.05, h:1.4, fill:{color:TERRA} });
  s.addText(safeText(verdict.one_line||'', 180), { x:1.0, y:3.3, w:8.0, h:1.4, fontSize:20, fontFace:FONT_H, color:WHITE, valign:'middle', lineSpacingMultiple:1.2, margin:0 });
  addSlideFooter(s);

  // ═══════════════════════════════════════════════════════════════════
  // SLIDE 10 — CLOSING
  // ═══════════════════════════════════════════════════════════════════
  s = pres.addSlide();
  s.background = { color: BG };
  s.addShape(pres.shapes.RECTANGLE, { x:0, y:0, w:10, h:0.035, fill:{color:TERRA} });
  s.addShape(pres.shapes.RECTANGLE, { x:0, y:5.59, w:10, h:0.035, fill:{color:TERRA} });
  // Centered composition
  s.addText('FORGE', { x:0, y:1.3, w:10, h:0.4, fontSize:8, fontFace:FONT_B, color:TERRA, align:'center', charSpacing:8, margin:0 });
  s.addText('GREENLIT', { x:0, y:1.7, w:10, h:1.0, fontSize:52, fontFace:FONT_H, color:WHITE, align:'center', valign:'middle', margin:0 });
  // Divider
  s.addShape(pres.shapes.RECTANGLE, { x:4.5, y:2.85, w:1.0, h:0.02, fill:{color:TERRA} });
  s.addText('Built by devs, for devs.', { x:0, y:3.1, w:10, h:0.4, fontSize:13, fontFace:FONT_B, color:DIM, align:'center', italic:true, margin:0 });
  // Company details
  s.addText('VYBSTAK Technologies SL', { x:0, y:4.0, w:10, h:0.3, fontSize:8, fontFace:FONT_B, color:MUTED, align:'center', charSpacing:4, margin:0 });
  s.addText('Valencia, Spain', { x:0, y:4.3, w:10, h:0.25, fontSize:8, fontFace:FONT_B, color:MUTED, align:'center', charSpacing:3, margin:0 });
  s.addText('vybstak.com', { x:0, y:4.65, w:10, h:0.25, fontSize:9, fontFace:FONT_B, color:TERRA, align:'center', charSpacing:2, margin:0 });

  return pres;
}

app.post('/api/launchpad', async (req, res) => {
  const { report, concept } = req.body;
  if (!report) return res.status(400).json({ error: 'No report data provided.' });

  const vipHeader = req.headers['x-vip-token'];
  const isVIP = vipHeader && verifyVIPToken(vipHeader);
  const proToken = req.body.proToken;
  const isPro = isVIP || (proToken && verifyProToken(proToken));
  if (!isPro) return res.status(403).json({ error: 'FORGE DECK is a Pro feature. Upgrade to generate publisher-ready pitch decks.' });

  try {
    const pres = buildLaunchpadDeck(report, concept);
    const fileName = 'FORGE-DECK-' + (report.concept_title || concept || 'deck').replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').slice(0, 60) + '-' + Date.now() + '.pptx';
    const filePath = path.join(DECKS_DIR, fileName);
    await pres.writeFile({ fileName: filePath });
    console.log('FORGE DECK: generated', fileName);
    res.json({ downloadUrl: '/decks/' + fileName, fileName });
  } catch(err) {
    console.error('Launchpad error:', err);
    res.status(500).json({ error: 'Failed to generate pitch deck.' });
  }
});

app.post('/api/checkout', async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe not configured.' });
  const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription', payment_method_types: ['card'],
      line_items: [{ price: process.env.STRIPE_PRO_PRICE_ID, quantity: 1 }],
      success_url: `${baseUrl}/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/`, allow_promotion_codes: true,
    });
    res.json({ url: session.url });
  } catch(err) { console.error('Stripe error:', err); res.status(500).json({ error: 'Failed to create checkout session.' }); }
});

app.post('/api/verify', async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe not configured.' });
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'Session ID required.' });
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status === 'paid' || session.status === 'complete') {
      res.json({ success: true, proToken: generateProToken(sessionId) });
    } else { res.status(402).json({ error: 'Payment not completed.' }); }
  } catch(err) { console.error('Stripe verify error:', err); res.status(500).json({ error: 'Verify failed.' }); }
});



// ═══════════════════════════════════════════════════════════════════════
// FORGE PLAYABLE — pitch in, playable prototype out (Claude Fable 5)
// ═══════════════════════════════════════════════════════════════════════
const PLAYABLES_DIR = path.join(PUBLIC_DIR, 'playables');
if (!fs.existsSync(PLAYABLES_DIR)) fs.mkdirSync(PLAYABLES_DIR, { recursive: true });
setInterval(() => {
  try {
    const now = Date.now();
    fs.readdirSync(PLAYABLES_DIR).forEach(f => {
      if (!f.startsWith('forge-play-')) return; // never delete samples
      const p = path.join(PLAYABLES_DIR, f);
      if (now - fs.statSync(p).mtimeMs > 2 * 3600 * 1000) fs.unlinkSync(p);
    });
  } catch (e) {}
}, 30 * 60 * 1000);

const playableUsage = new Map(); // ip → {count, day}
const PLAYABLE_FREE_LIMIT = 2;
function playableAllowed(ip) {
  const day = new Date().toISOString().slice(0, 10);
  const u = playableUsage.get(ip);
  if (!u || u.day !== day) { playableUsage.set(ip, { count: 0, day }); return true; }
  return u.count < PLAYABLE_FREE_LIMIT;
}
function playableCount(ip) {
  const day = new Date().toISOString().slice(0, 10);
  const u = playableUsage.get(ip) || { count: 0, day };
  u.count++; u.day = day; playableUsage.set(ip, u);
}

const PLAYABLE_SYSTEM = `You are the FORGE PLAYABLE engine — you turn an indie game pitch into a complete, genuinely playable HTML5 prototype in a single response.

OUTPUT CONTRACT — ABSOLUTE:
- Respond with ONLY a complete single HTML file. First characters: <!DOCTYPE html>. No markdown, no code fences, no commentary before or after.
- Entirely self-contained: inline CSS + inline JavaScript. NO external assets, images, fonts, audio files, libraries or CDNs. All art is drawn with canvas primitives.
- Must run offline from a local file with zero errors.

GAME QUALITY BAR:
- A real playable loop within 3 seconds of loading: clear goal, score, fail state or win state, and instant restart (R key and on-screen button).
- Controls: keyboard (arrows/WASD + space + one action key) AND basic touch (tap zones or drag). Show a one-line control hint on screen.
- Game feel: acceleration or easing (nothing teleports), squash/stretch or lean on movement, hit-stop or flash on impacts, screen shake, score pops, juice on every interaction.
- Difficulty ramps gently over 60-90 seconds of play.
- 450-900 lines of tight, readable code. No dead code. requestAnimationFrame loop with delta time. Pause on visibility loss.
- Title the game from the pitch. Animated start screen (click/press to start) and a game-over screen with final score and restart.

RETRO-POLISH VISUAL STACK — MANDATORY. The target look is "a lost 16-bit arcade cabinet, restored in 4K". Every game MUST implement ALL of the following:
1. LOW-RES PIXEL BUFFER: render the entire game to an offscreen canvas at 480x270 (or 320x180 for a chunkier feel), then upscale to a 960x540 display canvas with imageSmoothingEnabled=false for crisp fat pixels. Letterbox-scale the display canvas to the window, DPR-aware.
2. LOCKED PALETTE: define a named palette of 8-12 colors at the top of the script (deep shadow tones, 2-3 mid tones, one hot accent, one highlight) and use ONLY those colors. Cohesion over variety.
3. POST-FX PASS on the display canvas every frame, in order: (a) soft bloom — redraw the low-res buffer once with a blur filter and 'lighter' composite at low alpha so emissive elements genuinely glow; (b) scanlines — a prebuilt overlay canvas of 1px dark lines every 3px at ~10-14% alpha; (c) vignette — a prebuilt radial gradient darkening the corners; (d) impact chromatic ghost — on hits/explosions, briefly redraw the buffer offset ±1-3px with 'lighter' composite at low alpha, decaying over ~0.3s. Prebuild the scanline and vignette canvases ONCE, never per frame. Wrap ctx.filter use in a capability check with a graceful fallback.
4. EMISSIVE LIGHTING LANGUAGE: pick the light sources of the world (projectiles, cores, lava, neon, magic) and give them halo glows (radial gradients or the bloom pass), gentle pulse animations, and palette-consistent particle trails.
5. ENVIRONMENTAL DEPTH in the low-res buffer: a background layer with silhouettes/pattern (bricks, stars, machinery, foliage — whatever fits the pitch), a subtle animated element (drifting dust, flicker, rain, embers), and a foreground vignette of shapes framing the play area. Never a flat empty background.
6. DITHER or texture accents: sparse checkerboard dithering or noise flecks on large surfaces so nothing reads as a flat untextured rectangle.
7. Pixel-chunky typography: draw HUD text in the low-res buffer with a monospace font at small sizes so it upscales into chunky pixel type.
Original art only — never reference or imitate existing games' characters or assets.

Honour the pitch: its theme, fantasy and core verb must be unmistakable in the mechanics, not just the title.`;

app.post('/api/playable', async (req, res) => {
  const pitch = (req.body && req.body.pitch ? String(req.body.pitch) : '').trim();
  if (pitch.length < 5) return res.status(400).json({ error: 'Describe the game you want to play.' });
  if (pitch.length > 600) return res.status(400).json({ error: 'Keep the pitch under 600 characters.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured.' });

  const vipHeader = req.headers['x-vip-token'];
  const isVIP = vipHeader && verifyVIPToken(vipHeader);
  const proToken = req.body.proToken;
  const isPro = isVIP || (proToken && verifyProToken(proToken));
  const ip = getIP(req);
  if (!isPro) {
    if (!playableAllowed(ip)) return res.status(429).json({ error: 'Free playables used for today — Pro is unlimited.', code: 'RATE_LIMIT' });
    playableCount(ip);
  }
  const model = process.env.FORGE_PLAYABLE_MODEL || process.env.FORGE_PRO_MODEL || 'claude-fable-5';

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        system: PLAYABLE_SYSTEM,
        messages: [{ role: 'user', content: `Build the playable prototype for this pitch:\n\n${pitch}` }],
      }),
    });
    if (!response.ok) {
      const t = await response.text();
      console.error('Playable API error:', response.status, t.slice(0, 200));
      return res.status(502).json({ error: 'Forge Playable engine error. Try again.' });
    }
    const data = await response.json();
    let html = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    html = html.replace(/^\s*```(?:html)?/i, '').replace(/```\s*$/, '').trim();
    const lower = html.slice(0, 400).toLowerCase();
    if (!lower.includes('<!doctype html') || !html.toLowerCase().includes('<canvas') || html.length < 2500) {
      console.error('Playable failed validation, len=', html.length);
      return res.status(502).json({ error: 'Generated playable failed validation. Try a clearer pitch.' });
    }
    const fileName = 'forge-play-' + Date.now() + '.html';
    fs.writeFileSync(path.join(PLAYABLES_DIR, fileName), html, 'utf8');
    res.json({ url: '/playables/' + fileName, fileName, model, bytes: html.length });
  } catch (e) {
    console.error('Playable error:', e.message);
    res.status(500).json({ error: 'Forge Playable engine error. Try again.' });
  }
});


// ESCAPE THE ALGORITHM — flagship playable experience
app.get('/escape-the-algorithm', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'escape-the-algorithm.html')));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('\n  ╔══════════════════════════════════════════╗');
  console.log('  ║   FORGE ENGINE          ·  VYBSTAK  v1  ║');
  console.log(`  ║   http://localhost:${PORT}                  ║`);
  console.log(`  ║   Stripe       : ${(stripe?'configured':'NOT configured').padEnd(22)}║`);
  console.log(`  ║   LAUNCHPAD    : ${'native PPTX'.padEnd(22)}║`);
  console.log('  ╚══════════════════════════════════════════╝\n');
});
