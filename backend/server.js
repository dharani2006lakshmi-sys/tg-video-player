require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const bigInt = require('big-integer');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_ID = parseInt(process.env.API_ID);
const API_HASH = process.env.API_HASH;
const SESSION_STRING = process.env.SESSION_STRING;

if (!API_ID || !API_HASH || !SESSION_STRING) {
  console.error('Missing API_ID, API_HASH, or SESSION_STRING in environment variables.');
  process.exit(1);
}

const stringSession = new StringSession(SESSION_STRING);
const client = new TelegramClient(stringSession, API_ID, API_HASH, {
  connectionRetries: 5,
});

let videos = [];
let nextId = 1;

function humanFileSize(bytes) {
  if (!bytes) return 'unknown size';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = Number(bytes);
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

client.connect().then(() => {
  console.log("Connected to Telegram using MTProto.");
  
  client.addEventHandler(async (event) => {
    const msg = event.message;
    if (!msg.media) return;
    
    let isVideo = false;
    let mimeType = 'video/mp4';
    let duration = null;
    let fileName = `video_${Date.now()}.mp4`;
    let fileSize = msg.media.document ? Number(msg.media.document.size) : 0;
    
    // Check if the message contains a video
    if (msg.media.document) {
      const attributes = msg.media.document.attributes || [];
      const isVidAttr = attributes.find(a => a.className === 'DocumentAttributeVideo');
      const filenameAttr = attributes.find(a => a.className === 'DocumentAttributeFilename');
      
      if (msg.media.document.mimeType && msg.media.document.mimeType.startsWith('video/')) {
        isVideo = true;
        mimeType = msg.media.document.mimeType;
      } else if (isVidAttr) {
        isVideo = true;
      }
      
      if (filenameAttr) fileName = filenameAttr.fileName;
      if (isVidAttr) duration = isVidAttr.duration;
    }
    
    if (!isVideo) return;
    
    const entry = {
      id: nextId++,
      messageId: msg.id,
      peer: msg.peerId,
      fileName,
      fileSize,
      sizeLabel: humanFileSize(fileSize),
      mimeType,
      duration,
      tooLarge: fileSize > 4 * 1024 * 1024 * 1024, // > 4GB
      addedAt: new Date().toISOString(),
    };
    
    videos.unshift(entry);
    
    try {
      await client.sendMessage(msg.peerId, { message: `Added "${entry.fileName}" (${entry.sizeLabel}) to your player ✅`, replyTo: msg.id });
    } catch (e) {
      console.log("Could not reply:", e.message);
    }
  }, new NewMessage({ incoming: true }));
}).catch(err => {
  console.error("Failed to connect to Telegram:", err);
});

// REST API
app.get('/api/videos', (req, res) => {
  res.json(videos.map(v => ({
    id: v.id,
    fileName: v.fileName,
    sizeLabel: v.sizeLabel,
    duration: v.duration,
    mimeType: v.mimeType,
    tooLarge: v.tooLarge,
    addedAt: v.addedAt,
    thumbUrl: `/api/thumb/${v.id}`,
    streamUrl: `/api/stream/${v.id}`,
  })));
});

app.get('/api/videos/:id', (req, res) => {
  const v = videos.find(x => x.id === Number(req.params.id));
  if (!v) return res.status(404).json({ error: 'Video not found' });
  res.json(v);
});

app.delete('/api/videos/:id', (req, res) => {
  const before = videos.length;
  videos = videos.filter(x => x.id !== Number(req.params.id));
  if (videos.length === before) return res.status(404).json({ error: 'Video not found' });
  res.json({ ok: true });
});

// Stream handler for chunked downloading with Range support
app.get('/api/stream/:id', async (req, res) => {
  const v = videos.find(x => x.id === Number(req.params.id));
  if (!v) return res.status(404).json({ error: 'Video not found' });
  if (v.tooLarge) return res.status(413).json({ error: 'File exceeds 4GB limit' });

  try {
    const messages = await client.getMessages(v.peer, { ids: v.messageId });
    if (!messages || messages.length === 0) return res.status(404).json({ error: 'Message not found on Telegram' });
    const message = messages[0];

    const range = req.headers.range;
    let start = 0;
    let end = v.fileSize - 1;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      start = parseInt(parts[0], 10);
      end = parts[1] ? parseInt(parts[1], 10) : end;
    }
    
    const chunkSize = end - start + 1;

    res.status(range ? 206 : 200);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${v.fileSize}`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', chunkSize);
    res.setHeader('Content-Type', v.mimeType || 'video/mp4');

    // Stream using GramJS iterDownload
    let downloaded = 0;
    for await (const chunk of client.iterDownload({
      file: message.media,
      requestSize: 1024 * 1024, // 1MB chunks
      offset: bigInt(start),
    })) {
      // iterDownload offset handles the start, but it might return more than we need for the exact range.
      // We must slice the chunk to fit the exact end boundary if needed.
      let toWrite = chunk;
      if (downloaded + chunk.length > chunkSize) {
        toWrite = chunk.slice(0, chunkSize - downloaded);
      }
      
      if (!res.write(toWrite)) {
        await new Promise(resolve => res.once('drain', resolve));
      }
      
      downloaded += toWrite.length;
      if (downloaded >= chunkSize) break;
    }
    res.end();

  } catch (err) {
    console.error('Stream error:', err);
    if (!res.headersSent) res.status(502).json({ error: 'Could not fetch video from Telegram' });
  }
});

// Thumbnail proxy
app.get('/api/thumb/:id', async (req, res) => {
  const v = videos.find(x => x.id === Number(req.params.id));
  if (!v) return res.status(404).end();

  try {
    const messages = await client.getMessages(v.peer, { ids: v.messageId });
    if (!messages || messages.length === 0) return res.status(404).end();
    
    const buffer = await client.downloadMedia(messages[0].media, { thumb: 1 });
    if (!buffer) return res.status(404).end();

    res.setHeader('Content-Type', 'image/jpeg');
    res.send(buffer);
  } catch (err) {
    res.status(502).end();
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Telegram video player MTProto backend is running.' });
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
