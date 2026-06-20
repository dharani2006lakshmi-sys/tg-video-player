require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const bigInt = require('big-integer');

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_ID = parseInt(process.env.API_ID);
const API_HASH = process.env.API_HASH;
const SESSION_STRING = process.env.SESSION_STRING;

if (!API_ID || !API_HASH) {
  console.error('Missing API_ID or API_HASH in environment variables.');
  process.exit(1);
}

// ==========================================
// WEB LOGIN MODE
// If SESSION_STRING is missing, serve a web UI to generate it!
// ==========================================
if (!SESSION_STRING) {
  console.log("No SESSION_STRING found. Starting Web Login mode on port", PORT);
  
  const stringSession = new StringSession('');
  const client = new TelegramClient(stringSession, API_ID, API_HASH, {
    connectionRetries: 5,
    useWSS: true
  });
  
  let phoneResolver;
  let codeResolver;
  let passwordResolver;
  
  const renderPage = (body) => `
    <html>
      <head><title>Telegram Setup</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body style="font-family: sans-serif; background: #111; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh;">
        <div style="background: #222; padding: 2rem; border-radius: 8px; max-width: 400px; width: 100%;">
          ${body}
        </div>
      </body>
    </html>
  `;

  app.get('/', (req, res) => {
    res.send(renderPage(`
      <h2 style="color: #0088cc;">Step 1: Setup Backend</h2>
      <p>Enter your Telegram phone number with country code (e.g. +91934...)</p>
      <form method="POST" action="/send_code">
        <input type="text" name="phone" style="width: 100%; padding: 10px; margin-bottom: 15px; border-radius: 4px; border: none; font-size: 16px;" placeholder="+91..." required />
        <button type="submit" style="width: 100%; padding: 12px; background: #0088cc; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer;">Send Code via Telegram</button>
      </form>
    `));
  });

  app.post('/send_code', (req, res) => {
    const phone = req.body.phone;
    
    // Start login process in background
    client.start({
      phoneNumber: async () => phone,
      password: async () => new Promise(r => passwordResolver = r),
      phoneCode: async () => new Promise(r => codeResolver = r),
      onError: (err) => console.log(err),
    }).catch(console.error);

    setTimeout(() => {
      res.send(renderPage(`
        <h2 style="color: #0088cc;">Step 2: Enter Code</h2>
        <p>A login code was just sent to your Telegram app.</p>
        <form method="POST" action="/submit_code">
          <input type="text" name="code" style="width: 100%; padding: 10px; margin-bottom: 15px; border-radius: 4px; border: none; font-size: 16px;" placeholder="Enter 5-digit code" required />
          <p style="font-size: 12px; color: #aaa;">If you have a Two-Step Verification Password, enter it below. Otherwise leave blank:</p>
          <input type="password" name="password" style="width: 100%; padding: 10px; margin-bottom: 15px; border-radius: 4px; border: none; font-size: 16px;" placeholder="Password (Optional)" />
          <button type="submit" style="width: 100%; padding: 12px; background: #0088cc; color: white; border: none; border-radius: 4px; font-weight: bold; cursor: pointer;">Generate Session String</button>
        </form>
      `));
    }, 1500);
  });

  app.post('/submit_code', (req, res) => {
    const code = req.body.code;
    const password = req.body.password;
    
    if (codeResolver) codeResolver(code);
    if (passwordResolver) passwordResolver(password);
    
    setTimeout(() => {
      const session = client.session.save();
      res.send(renderPage(`
        <h2 style="color: #4CAF50;">Success! 🎉</h2>
        <p>Your backend is authorized. Copy the massive text block below and add it to Render as your <b>SESSION_STRING</b> environment variable:</p>
        <textarea readonly style="width: 100%; height: 150px; padding: 10px; border-radius: 4px; border: none; background: #333; color: #fff; font-family: monospace; font-size: 10px;">${session}</textarea>
        <p style="margin-top: 15px; color: #aaa; font-size: 14px;">Once you save it in Render, Render will restart automatically and your backend will be fully online.</p>
      `));
    }, 2500);
  });

  app.listen(PORT, () => console.log(`Web Login Server running on port ${PORT}`));

} else {

  // ==========================================
  // NORMAL VIDEO PLAYER MODE
  // ==========================================
  const stringSession = new StringSession(SESSION_STRING);
  const client = new TelegramClient(stringSession, API_ID, API_HASH, {
    connectionRetries: 5,
    useWSS: true
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
        tooLarge: fileSize > 4 * 1024 * 1024 * 1024,
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

      let downloaded = 0;
      for await (const chunk of client.iterDownload({
        file: message.media,
        requestSize: 1024 * 1024,
        offset: bigInt(start),
      })) {
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

  app.get('/', (req, res) => res.json({ status: 'ok', message: 'Telegram MTProto backend is running.' }));
  app.get('/health', (req, res) => res.json({ ok: true }));

  app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
}
