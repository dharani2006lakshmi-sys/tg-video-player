require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const PUBLIC_URL = process.env.PUBLIC_URL; // e.g. https://your-app.onrender.com
const ALLOWED_CHAT_ID = process.env.ALLOWED_CHAT_ID || null; // optional: lock bot to your chat only

if (!BOT_TOKEN) {
  console.error('Missing BOT_TOKEN in environment variables.');
  process.exit(1);
}

const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const TG_FILE_API = `https://api.telegram.org/file/bot${BOT_TOKEN}`;

// ---------------------------------------------------------------------------
// In-memory video store.
// Swap this for a real database (Supabase/Postgres/SQLite) if you want videos
// to survive server restarts — Render free instances restart on redeploys
// and after idling, which wipes this array.
// ---------------------------------------------------------------------------
let videos = [];
let nextId = 1;

const bot = new TelegramBot(BOT_TOKEN, { polling: !PUBLIC_URL });

// If PUBLIC_URL is set, use webhook mode (recommended for Render).
// Otherwise fall back to polling (handy for local testing).
if (PUBLIC_URL) {
  const webhookPath = `/webhook/${BOT_TOKEN}`;
  bot.setWebHook(`${PUBLIC_URL}${webhookPath}`).then(() => {
    console.log('Webhook set to', `${PUBLIC_URL}${webhookPath}`);
  }).catch(err => console.error('Failed to set webhook:', err.message));

  app.post(webhookPath, express.json(), (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });
} else {
  console.log('Running in polling mode (no PUBLIC_URL set).');
}

function isAllowed(msg) {
  if (!ALLOWED_CHAT_ID) return true;
  return String(msg.chat.id) === String(ALLOWED_CHAT_ID);
}

function humanFileSize(bytes) {
  if (!bytes) return 'unknown size';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

// Telegram Bot API caps file downloads at 20MB. Files larger than that
// can't be fetched via getFile, so we flag them instead of breaking.
const MAX_BOT_API_BYTES = 20 * 1024 * 1024;

async function registerVideo({ fileId, fileName, fileSize, mimeType, duration, thumbFileId, chatId }) {
  const entry = {
    id: nextId++,
    fileId,
    fileName: fileName || `video_${Date.now()}.mp4`,
    fileSize: fileSize || 0,
    sizeLabel: humanFileSize(fileSize),
    mimeType: mimeType || 'video/mp4',
    duration: duration || null,
    thumbFileId: thumbFileId || null,
    chatId,
    tooLarge: fileSize ? fileSize > MAX_BOT_API_BYTES : false,
    addedAt: new Date().toISOString(),
  };
  videos.unshift(entry);
  return entry;
}

// ---------------------------------------------------------------------------
// Telegram message handlers
// ---------------------------------------------------------------------------
bot.on('video', async (msg) => {
  if (!isAllowed(msg)) return;
  const v = msg.video;
  const entry = await registerVideo({
    fileId: v.file_id,
    fileName: v.file_name,
    fileSize: v.file_size,
    mimeType: v.mime_type,
    duration: v.duration,
    thumbFileId: v.thumb ? v.thumb.file_id : null,
    chatId: msg.chat.id,
  });

  if (entry.tooLarge) {
    bot.sendMessage(msg.chat.id, `Got "${entry.fileName}" (${entry.sizeLabel}) — but it's over Telegram's 20MB bot download limit, so it can't be streamed yet. Let me know if you want the larger-file workaround.`);
  } else {
    bot.sendMessage(msg.chat.id, `Added "${entry.fileName}" (${entry.sizeLabel}) to your player ✅`);
  }
});

// Videos sent as files/documents (Telegram routes some video files this way)
bot.on('document', async (msg) => {
  if (!isAllowed(msg)) return;
  const d = msg.document;
  const isVideo = d.mime_type && d.mime_type.startsWith('video/');
  if (!isVideo) {
    bot.sendMessage(msg.chat.id, `That file isn't a video, so I skipped it.`);
    return;
  }
  const entry = await registerVideo({
    fileId: d.file_id,
    fileName: d.file_name,
    fileSize: d.file_size,
    mimeType: d.mime_type,
    thumbFileId: d.thumb ? d.thumb.file_id : null,
    chatId: msg.chat.id,
  });

  if (entry.tooLarge) {
    bot.sendMessage(msg.chat.id, `Got "${entry.fileName}" (${entry.sizeLabel}) — but it's over Telegram's 20MB bot download limit, so it can't be streamed yet.`);
  } else {
    bot.sendMessage(msg.chat.id, `Added "${entry.fileName}" (${entry.sizeLabel}) to your player ✅`);
  }
});

bot.onText(/\/start/, (msg) => {
  if (!isAllowed(msg)) return;
  bot.sendMessage(msg.chat.id, `Send me any video and I'll add it to your web player. Use /list to see what's there.`);
});

bot.onText(/\/list/, (msg) => {
  if (!isAllowed(msg)) return;
  if (videos.length === 0) {
    bot.sendMessage(msg.chat.id, `No videos yet. Send me one!`);
    return;
  }
  const lines = videos.slice(0, 20).map(v => `#${v.id} — ${v.fileName} (${v.sizeLabel})${v.tooLarge ? ' ⚠️ too large' : ''}`);
  bot.sendMessage(msg.chat.id, lines.join('\n'));
});

// ---------------------------------------------------------------------------
// REST API for the frontend
// ---------------------------------------------------------------------------
app.get('/api/videos', (req, res) => {
  res.json(videos.map(v => ({
    id: v.id,
    fileName: v.fileName,
    sizeLabel: v.sizeLabel,
    duration: v.duration,
    mimeType: v.mimeType,
    tooLarge: v.tooLarge,
    addedAt: v.addedAt,
    thumbUrl: v.thumbFileId ? `/api/thumb/${v.id}` : null,
    streamUrl: `/api/stream/${v.id}`,
  })));
});

app.get('/api/videos/:id', (req, res) => {
  const v = videos.find(x => x.id === Number(req.params.id));
  if (!v) return res.status(404).json({ error: 'Video not found' });
  res.json({
    id: v.id,
    fileName: v.fileName,
    sizeLabel: v.sizeLabel,
    duration: v.duration,
    mimeType: v.mimeType,
    tooLarge: v.tooLarge,
    addedAt: v.addedAt,
    thumbUrl: v.thumbFileId ? `/api/thumb/${v.id}` : null,
    streamUrl: `/api/stream/${v.id}`,
  });
});

app.delete('/api/videos/:id', (req, res) => {
  const before = videos.length;
  videos = videos.filter(x => x.id !== Number(req.params.id));
  if (videos.length === before) return res.status(404).json({ error: 'Video not found' });
  res.json({ ok: true });
});

// Resolve a Telegram file_id to its current temporary download path.
// Telegram file paths can expire/change, so we resolve fresh on every stream request.
async function resolveFilePath(fileId) {
  const { data } = await axios.get(`${TG_API}/getFile`, { params: { file_id: fileId } });
  if (!data.ok) throw new Error(data.description || 'getFile failed');
  return data.result.file_path;
}

// Stream proxy — supports HTTP Range requests so seeking/scrubbing works.
app.get('/api/stream/:id', async (req, res) => {
  const v = videos.find(x => x.id === Number(req.params.id));
  if (!v) return res.status(404).json({ error: 'Video not found' });
  if (v.tooLarge) return res.status(413).json({ error: 'File exceeds the 20MB bot API download limit' });

  try {
    const filePath = await resolveFilePath(v.fileId);
    const fileUrl = `${TG_FILE_API}/${filePath}`;

    const range = req.headers.range;
    const headers = range ? { Range: range } : {};

    const upstream = await axios.get(fileUrl, {
      headers,
      responseType: 'stream',
      validateStatus: () => true,
    });

    res.status(upstream.status);
    res.setHeader('Content-Type', v.mimeType || 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    if (upstream.headers['content-range']) res.setHeader('Content-Range', upstream.headers['content-range']);
    if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);

    upstream.data.pipe(res);
  } catch (err) {
    console.error('Stream error:', err.message);
    res.status(502).json({ error: 'Could not fetch video from Telegram' });
  }
});

// Thumbnail proxy
app.get('/api/thumb/:id', async (req, res) => {
  const v = videos.find(x => x.id === Number(req.params.id));
  if (!v || !v.thumbFileId) return res.status(404).end();

  try {
    const filePath = await resolveFilePath(v.thumbFileId);
    const fileUrl = `${TG_FILE_API}/${filePath}`;
    const upstream = await axios.get(fileUrl, { responseType: 'stream' });
    res.setHeader('Content-Type', 'image/jpeg');
    upstream.data.pipe(res);
  } catch (err) {
    res.status(502).end();
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Telegram video player backend is running.' });
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
