# Openfloor Terminal — setup guide

A free, Bloomberg-style market terminal with your own portfolio and secure trading.
It runs entirely on free services: GitHub holds the code, and one free Cloudflare Worker
hosts the site, stores your private data, runs scheduled jobs and talks to your brokerages.

Everything is free. The only things you might add are free keys (Finnhub, FRED, SnapTrade,
Alpaca) and a free notification app (ntfy).

**Do steps 1–8 to get the terminal live and locked behind your login.**
Steps 9–13 add optional features. Do them in any order, any time.

> Tip: steps 1–2 are easiest on a computer (dragging a folder into GitHub keeps the folders).
> Everything after that works fine from your iPhone.

---

## Part 1 — Put it online (about 20 minutes)

### Step 1. Make the two free accounts
1. GitHub: go to **github.com** and sign up (skip if you have one).
2. Cloudflare: go to **dash.cloudflare.com** and sign up (skip if you have one — you already use it for the fire budget site).

### Step 2. Put the code on GitHub
1. Unzip **openfloor-terminal.zip** on your computer. You'll get a folder with `public`, `src`, `wrangler.jsonc` and this README.
2. On github.com tap **+** (top right) → **New repository**.
3. Name it `openfloor`. Choose **Private**. Tap **Create repository**.
4. On the new page tap **uploading an existing file**.
5. Drag **everything inside** the unzipped folder (the `public` folder, the `src` folder, `wrangler.jsonc`, `README.md`) onto the page.
6. Tap **Commit changes**.

### Step 3. Make your private database
1. In Cloudflare, open **Storage & Databases** → **D1 SQL Database** → **Create**.
2. Name it `openfloor` and tap **Create**.
3. On the database page, copy the **Database ID** (a long code with dashes).
4. In GitHub, open `wrangler.jsonc`, tap the pencil (✏️) to edit.
5. Replace `PASTE-YOUR-D1-DATABASE-ID-HERE` with the ID you copied. Keep the quote marks.
6. Tap **Commit changes**.

The terminal creates its own tables the first time it runs. You never need to touch the database again.

### Step 4. Create the Worker from your GitHub code
1. In Cloudflare open **Workers & Pages** → **Create** → **Import a repository** (Workers).
2. Connect your GitHub account when asked, then pick the `openfloor` repository.
3. Project name: `openfloor` (it must match the name in `wrangler.jsonc`).
4. Leave the build settings as they are (deploy command `npx wrangler deploy`). Tap **Save and Deploy**.
5. When it finishes, you get a link like `openfloor.yourname.workers.dev`. Don't share it — the next steps lock it.

From now on, every change you commit on GitHub redeploys automatically.

### Step 5. Add your contact email
SEC EDGAR requires every app that reads it to say who is asking.
1. Open your Worker → **Settings** → **Variables and Secrets** → **Add**.
2. Type: **Text**. Name: `CONTACT_EMAIL`. Value: your email. Tap **Deploy**.

### Step 6. Lock the site behind your login (Cloudflare Access)
This puts a login screen in front of the whole site. Only you can get in, with a one-time code sent to your email.
1. In **Workers & Pages**, open your `openfloor` Worker and tap its **Access** tab.
2. Tap **Protect this Worker behind Access** → choose **All traffic**.
3. For who is allowed in, choose **Cloudflare account** (that's only you).
   - Don't choose "Email domain" — with a Gmail address that would let every Gmail user in.
   - To allow a specific email instead, finish here, then go to **Zero Trust → Access → Policies**, edit the policy, and set the rule to **Emails → your address**.
4. Tap **Apply Access**.
5. Cloudflare may ask you to turn on Zero Trust and choose the **Free** plan. It may ask for a card to activate the free plan; you aren't charged.

### Step 7. Tell the server about your login
The server double-checks every private request with Cloudflare's signed login token. It needs three values:
1. In Cloudflare go to **Zero Trust → Access → Applications**, open the application for your Worker → **Configure**.
   Copy the **Application Audience (AUD) Tag**.
2. In **Zero Trust → Settings**, find your **Team domain** (looks like `yourname.cloudflareaccess.com`).
3. Back on your Worker → **Settings → Variables and Secrets**, add three **Text** variables:
   - `POLICY_AUD` = the AUD tag
   - `TEAM_DOMAIN` = your team domain
   - `ALLOWED_EMAIL` = your email
4. Tap **Deploy**.

### Step 8. Open it
1. Open your Worker link on your iPhone. Log in with the code Cloudflare emails you.
2. The dot at the top right should be green and say **LIVE · secured**.
3. Type `SET` and press GO. You'll see what's switched on.
4. Add it to your home screen: Safari → **Share** → **Add to Home Screen**.

Your private practice account ($100,000 of pretend money) already works. Try `TRADE AAPL`.

---

## Part 2 — Optional features

For every key below: Worker → **Settings → Variables and Secrets → Add**, choose **Secret** for keys,
paste the value, tap **Deploy**. Secrets are encrypted and the page never sees them.

### Step 9. Free data keys (2 minutes each)
- **Finnhub** — live stock prices streaming tick by tick, and past earnings beats/misses.
  Sign up at **finnhub.io**, copy your API key. Secret name: `FINNHUB_KEY`.
- **FRED** — dates for CPI, jobs, GDP and other reports in `CAL`, and the report-day study in `STUDY`.
  Go to **fred.stlouisfed.org** → sign up → **My Account → API Keys → Request API Key**. Secret name: `FRED_KEY`.

### Step 10. Phone notifications (morning brief, alerts, unusual activity)
1. Install the free **ntfy** app on your iPhone.
2. In the app tap **+**, and subscribe to a topic name only you know — make it long and random, like
   `openfloor-` followed by 16 random letters and numbers. Anyone who knows the name can read it.
3. Add a **Secret**: `NTFY_TOPIC` = that exact topic name.
4. In the terminal type `BRIEF` → **SEND A TEST NOTIFICATION**.

You'll get a morning brief at 8:45 am Eastern, a market wrap at 4:20 pm, every price alert the minute
it triggers, and important unusual activity in your stocks. Turn each on or off in `BRIEF`.
Your portfolio value is left out unless you switch it on there.

### Step 11. Connect your brokerage accounts
**SnapTrade (most brokerages, free for personal use)** — Robinhood, Schwab, Fidelity, Webull, E*TRADE,
Vanguard, Interactive Brokers, Coinbase, Kraken and more.
1. Go to **snaptrade.com/personal** and create a free account.
2. In the SnapTrade dashboard create your **Personal API key**. You get a **client ID** and a **consumer key**.
3. Add two **Secrets**: `SNAPTRADE_CLIENT_ID` and `SNAPTRADE_CONSUMER_KEY`.
4. In the terminal type `CONN` → **CONNECT (VIEW ONLY)**, or **CONNECT WITH TRADING** for accounts you want to trade from.
   Log in to your brokerage on SnapTrade's page; you're sent back to the terminal when done.

Which brokerages allow trading (not just viewing) is set by each brokerage. View-only ones still show in `PORT`.

**Alpaca (free, best for practising with fake money)**
1. Sign up at **alpaca.markets**. Open the **Paper Trading** account and create **API keys**.
2. Add two **Secrets**: `ALPACA_KEY_ID` and `ALPACA_SECRET`.
3. The terminal tells paper and live keys apart by themselves: paper keys start with **PK**, live keys start with **AK**.
   Paper and live accounts have **separate** keys, so copy them from the account you want (switch accounts at the top left of the Alpaca dashboard).
4. A live Alpaca account shows as **REAL** and can't trade until you set `TRADING_MODE` = `live` (step 13).

**Anything else (401k, pension, bank brokerage)** — type it in or paste a CSV in `CONN`. View only.

**Safety rule for any brokerage key you ever create: never turn on withdrawal or money-transfer permissions.**

### Step 12. Link your paper-trading bot
- To show the bot inside the terminal: add a **Text** variable `BOT_STATE_URL` = the web address of the
  status file your bot publishes on GitHub (a `raw.githubusercontent.com/...` or `yourname.github.io/...` link).
- To let the bot read the terminal's signals: in **Zero Trust → Access → Service credentials**, create a
  **service token**, add a **Service Auth** rule for it to your Worker's Access policy, and have the bot call
  `https://<your-worker-link>/api/bot/signals` with the headers `CF-Access-Client-Id` and `CF-Access-Client-Secret`.
  The token can only read signals, nothing else.

### Step 13. Turn on trading (only when you're ready)
Trading is **off** until you change it. Off means only the built-in practice account can trade.
1. Add a **Secret** `TRADE_PIN` — 4 to 8 digits only you know. Every order and cancel asks for it.
2. Add a **Text** variable `TRADING_MODE`:
   - `paper` — only fake-money accounts (Alpaca paper, SnapTrade paper) can trade. **Start here.**
   - `live` — real-money accounts can trade too.
3. Optional limits (Text variables):
   - `MAX_ORDER_USD` — biggest single order allowed (default `1000`).
   - `MAX_ORDERS_PER_DAY` — most orders per day (default `10`).

How every order is protected:
- You see a full review (price, cost, warnings, broker's own check) before anything is sent.
- The review is signed by your server, can be used once, and expires after 90 seconds.
- Your PIN is checked on the server. Five wrong PINs lock trading for 15 minutes.
- Dollar and daily limits are enforced on the server, not just on the page.
- `ORD` → **PAUSE ALL TRADING** stops everything instantly. Resuming needs your PIN.
- Every attempt — sent, refused, failed or wrong PIN — is saved in the audit log in `ORD`.

---

## How it stays free (and how fast it runs)

| Service | Free limit | What the terminal uses |
|---|---|---|
| Cloudflare Workers | 100,000 requests a day | About 20–30 a minute while the page is open on screen (it pauses when you switch away), plus 1,440 a day for the every-minute scheduled job |
| Cloudflare D1 database | 5 GB, 100,000 writes a day | A few thousand writes a day |
| Cloudflare Workers AI | 10,000 "neurons" a day | About 150 filing summaries a day (the terminal stops at 150) |
| Cloudflare Access | Free for up to 50 people | Just you |
| GitHub | Free private repositories | One |
| ntfy | Free | A handful of notifications a day |

Speed: stock and index prices refresh every 15 seconds, crypto streams tick by tick from Coinbase, and
with a Finnhub key your stocks stream tick by tick too. The server checks your alerts every minute,
records prediction-market odds, funding rates and signals every 15 minutes, and scans for unusual
activity every 15 minutes.

## Good to know
- Yahoo Finance, Nasdaq and CBOE data come from their free public pages, not official paid feeds. They
  can change without notice; if one breaks, the rest of the terminal keeps working. Some exchanges are
  delayed 15–20 minutes. Options are delayed 15 minutes.
- This is a personal research tool. Signal scores, mood and recession scores follow simple, visible
  rules. They are not investment advice.
- If Cloudflare ever shows a "CPU time exceeded" error for the Worker, the scheduled jobs are doing too
  much at once on the free plan — let Claude know and it can split them up.

## Commands
Type `HELP` in the terminal for the full list. A few to start:
`MON` launchpad · `AAPL` any ticker · `EQS` screener · `PORT` portfolio · `TRADE AAPL` trade ticket ·
`ERN` earnings · `CAL` calendar · `REC` recession watch · `PECO` your wallet · `SIG` signal scores ·
`SCAN` unusual activity · `MOOD` sentiment · `BT` backtester · `SET` setup and security.
