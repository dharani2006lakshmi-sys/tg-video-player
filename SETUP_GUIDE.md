# Telegram Video Player — Setup Guide

A web video player that connects to a Telegram bot. Send a video to the bot,
it shows up in your player and streams directly from Telegram's servers.

## How it works

```
You → send video → Telegram Bot → Backend (Render) → stores file_id
                                         │
Browser ← streams video ← Backend ←──────┘ (fetches from Telegram on demand)
```

The backend never permanently stores video files — it just remembers the
Telegram `file_id` and re-fetches the stream from Telegram each time you play
something. This keeps your server storage at zero.

**Important limit:** Telegram's Bot API caps file downloads at **20MB**.
Videos bigger than that will show up in your list but can't be played — see
"Going beyond 20MB" at the bottom if you need this.

---

## Part 1 — Create your Telegram bot

1. Open Telegram, message **[@BotFather](https://t.me/BotFather)**
2. Send `/newbot`, follow the prompts (choose a name and username)
3. BotFather gives you a **bot token** like `123456789:AAH...` — save it,
   you'll need it in Part 2
4. (Optional but recommended) Message **[@userinfobot](https://t.me/userinfobot)**
   to get your personal **chat ID** — this lets you lock the bot so only you
   can add videos

---

## Part 2 — Deploy the backend to Render

1. Push the `backend/` folder to a GitHub repo (or use Render's "deploy from
   zip" if available)
2. On [render.com](https://render.com), create a **New Web Service**
   - Build command: `npm install`
   - Start command: `npm start`
   - Environment: Node
3. Add these environment variables in Render's dashboard:

   | Key | Value |
   |---|---|
   | `BOT_TOKEN` | the token from BotFather |
   | `PUBLIC_URL` | leave blank for now |
   | `ALLOWED_CHAT_ID` | your chat ID from @userinfobot (optional) |

4. Deploy. Once it's live, copy your Render URL (e.g.
   `https://tg-video-player.onrender.com`)
5. Go back to environment variables, set `PUBLIC_URL` to that exact URL
   (no trailing slash), and redeploy. This makes the bot switch from polling
   to webhook mode, which is what you want in production.

**Note on Render's free tier:** free instances spin down after 15 minutes of
inactivity and spin back up on the next request (takes ~30-50s). Your video
list is stored in memory, so a restart clears it — videos you previously sent
will need to be re-sent, OR you can upgrade to a paid instance / wire up a
real database (see the comment in `server.js` near `let videos = []`).

---

## Part 3 — Deploy the frontend to Vercel

1. Open `frontend/config.js` and change:
   ```js
   const API_BASE = "https://YOUR-RENDER-BACKEND-URL.onrender.com";
   ```
   to your actual Render URL from Part 2.
2. Push the `frontend/` folder to a GitHub repo (can be the same repo, just a
   different folder, or a separate one)
3. On [vercel.com](https://vercel.com), import the repo. Since this is a
   plain static site (no build step), set:
   - Framework preset: **Other**
   - Build command: *(leave empty)*
   - Output directory: `.` (or wherever `index.html` lives)
4. Deploy. You'll get a URL like `https://your-app.vercel.app`

---

## Part 4 — Test it

1. Open your Telegram bot, send `/start`
2. Send any video file (under 20MB) directly in the chat
3. Bot replies confirming it was added
4. Open your Vercel URL — the video should appear in the **Reel Log** sidebar
   within a few seconds (it polls every 8s, or hit the refresh icon)
5. Click it to load and play

---

## Player features

- Play/pause, scrub bar with buffered range indicator
- Skip back/forward 10s
- Volume slider + mute
- Playback speed (0.5x–2x)
- Fullscreen
- Picture-in-picture
- Keyboard shortcuts: `k`/`space` play-pause, `j`/`l` skip 10s, `←`/`→` skip
  5s, `↑`/`↓` volume, `m` mute, `f` fullscreen
- Video list sidebar with thumbnails, file size, duration

---

## Going beyond 20MB

The Bot API's `getFile` method refuses files over 20MB — this is a hard
Telegram limit on bot accounts, not something fixable in code. If you need to
stream larger files (movies, long recordings), the workaround is to
authenticate as your **user account** instead of a bot, using the MTProto
protocol (via a library like [GramJS](https://gram.js.org/)). That lets you
download any file your account can see, with no 20MB cap.

This is a meaningfully bigger build — it needs a Telegram API ID/hash from
[my.telegram.org](https://my.telegram.org), a login flow (phone number + OTP),
and session string storage. Let me know if you hit the wall and want this
added — I can build it as a separate backend mode so you don't lose the
simple bot setup you already have.

---

## File structure

```
backend/
  server.js          — Express server, Telegram webhook, streaming proxy
  package.json
  .env.example        — copy to .env for local testing

frontend/
  index.html          — player markup
  style.css            — "screening room" dark theme
  app.js               — player controls + video list logic
  config.js            — set your backend URL here
```
