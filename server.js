const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'; // <-- deploy se pehle badal dena
const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'submissions.json');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]');

const readDb = () => JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
const writeDb = (rows) => fs.writeFileSync(DB_FILE, JSON.stringify(rows, null, 2));

// admin dwara set kiya hua link (sabhi users ko dikhega)
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
if (!fs.existsSync(CONFIG_FILE)) fs.writeFileSync(CONFIG_FILE, JSON.stringify({ link: '', title: '' }));
const readConfig = () => JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const writeConfig = (c) => fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2));

const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) =>
      cb(null, crypto.randomBytes(16).toString('hex') + (EXT[file.mimetype] || '.png')),
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 2 },
  fileFilter: (req, file, cb) => cb(null, !!EXT[file.mimetype]),
});

const app = express();
app.use(express.json());

// ---------- simple admin session ----------
const sessions = new Set();
const getCookie = (req, name) => {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
};
const requireAdmin = (req, res, next) =>
  sessions.has(getCookie(req, 'sid')) ? next() : res.status(401).json({ error: 'Unauthorized' });

// ---------- rate limit (per IP, 10 submissions / hour) ----------
const hits = new Map();
const rateLimit = (req, res, next) => {
  const ip = req.ip, now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
  if (list.length >= 10) return res.status(429).json({ error: 'Bahut zyada submissions. Thodi der baad try karein.' });
  list.push(now);
  hits.set(ip, list);
  next();
};

// ---------- public ----------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/api/config', (req, res) => res.json(readConfig()));

app.post(
  '/api/submit',
  rateLimit,
  upload.fields([{ name: 'like_screenshot', maxCount: 1 }, { name: 'comment_screenshot', maxCount: 1 }]),
  (req, res) => {
    const link = readConfig().link; // us waqt ka active link
    const name = String(req.body.name || '').trim().slice(0, 80);
    const like = req.files && req.files.like_screenshot && req.files.like_screenshot[0];
    const comment = req.files && req.files.comment_screenshot && req.files.comment_screenshot[0];

    const cleanup = () => [like, comment].forEach((f) => f && fs.unlink(f.path, () => {}));

    if (!like || !comment) {
      cleanup();
      return res.status(400).json({ error: 'Like aur comment dono ke screenshot (PNG/JPG/WEBP/GIF) zaroori hain.' });
    }

    const rows = readDb();
    rows.unshift({
      id: crypto.randomBytes(6).toString('hex'),
      name,
      link,
      like_screenshot: like.filename,
      comment_screenshot: comment.filename,
      status: 'pending',
      created_at: new Date().toISOString(),
    });
    writeDb(rows);
    res.json({ ok: true });
  }
);

// ---------- admin ----------
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.post('/api/admin/login', (req, res) => {
  if (req.body && req.body.password === ADMIN_PASSWORD) {
    const sid = crypto.randomBytes(24).toString('hex');
    sessions.add(sid);
    res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`);
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Galat password' });
});

app.post('/api/admin/logout', requireAdmin, (req, res) => {
  sessions.delete(getCookie(req, 'sid'));
  res.json({ ok: true });
});

app.post('/api/admin/config', requireAdmin, (req, res) => {
  const link = String((req.body && req.body.link) || '').trim();
  const title = String((req.body && req.body.title) || '').trim().slice(0, 120);
  if (link && (!/^https?:\/\/\S+$/i.test(link) || link.length > 500))
    return res.status(400).json({ error: 'Sahi link daalein (http:// ya https:// se shuru).' });
  writeConfig({ link, title });
  res.json({ ok: true });
});

app.get('/api/admin/config', requireAdmin, (req, res) => res.json(readConfig()));

app.get('/api/admin/submissions', requireAdmin, (req, res) => res.json(readDb()));

app.post('/api/admin/submissions/:id/status', requireAdmin, (req, res) => {
  const status = req.body.status;
  if (!['pending', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Bad status' });
  const rows = readDb();
  const row = rows.find((r) => r.id === req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  row.status = status;
  writeDb(rows);
  res.json({ ok: true });
});

app.delete('/api/admin/submissions/:id', requireAdmin, (req, res) => {
  const rows = readDb();
  const row = rows.find((r) => r.id === req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  [row.like_screenshot, row.comment_screenshot].forEach((f) => fs.unlink(path.join(UPLOAD_DIR, f), () => {}));
  writeDb(rows.filter((r) => r.id !== row.id));
  res.json({ ok: true });
});

// screenshots sirf admin ko dikhte hain
app.get('/admin/img/:file', requireAdmin, (req, res) => {
  const file = path.basename(req.params.file);
  res.sendFile(path.join(UPLOAD_DIR, file));
});

app.use((err, req, res, next) => {
  res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Screenshot 8MB se chhota hona chahiye.' : 'Upload error' });
});

app.listen(PORT, () => console.log(`Site chal rahi hai: http://localhost:${PORT}  |  Admin: http://localhost:${PORT}/admin`));
