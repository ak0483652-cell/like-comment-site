const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_PASSWORD } = process.env;
const BUCKET = process.env.SUPABASE_BUCKET || 'screenshots';
const SECRET = process.env.SESSION_SECRET || ADMIN_PASSWORD || '';
const envOk = !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && ADMIN_PASSWORD);

const sb = createClient(SUPABASE_URL || 'http://localhost', SUPABASE_SERVICE_ROLE_KEY || 'missing', {
  auth: { persistSession: false, autoRefreshToken: false },
});

const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
const MAX_FILE = 2 * 1024 * 1024; // Vercel ki request limit ~4.5MB hai, isliye 2MB x 2 files

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE, files: 2 },
  fileFilter: (req, file, cb) => cb(null, !!EXT[file.mimetype]),
});

const app = express();
app.set('trust proxy', 1);
app.use(express.json());

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.use('/api', (req, res, next) =>
  envOk ? next() : res.status(500).json({ error: 'Server setup adhura hai: environment variables set karein.' })
);

// ---------- stateless admin session (serverless ke liye cookie signed hai) ----------
const sign = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('hex');
const makeToken = () => {
  const exp = String(Date.now() + 24 * 3600e3);
  return exp + '.' + sign(exp);
};
const validToken = (t) => {
  if (!t) return false;
  const [exp, sig] = t.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const getCookie = (req, name) => {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
};
const requireAdmin = (req, res, next) =>
  envOk && validToken(getCookie(req, 'sid')) ? next() : res.status(401).json({ error: 'Unauthorized' });
const sameSecret = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

// ---------- best-effort rate limit (per IP, 10 submissions / hour) ----------
const hits = new Map();
const rateLimit = (req, res, next) => {
  const ip = req.ip, now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
  if (list.length >= 10) return res.status(429).json({ error: 'Bahut zyada submissions. Thodi der baad try karein.' });
  list.push(now);
  hits.set(ip, list);
  next();
};

const getConfig = async () => {
  const { data, error } = await sb.from('config').select('link,title').eq('id', 1).maybeSingle();
  if (error) throw error;
  return data || { link: '', title: '' };
};

// ---------- public ----------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/api/config', ah(async (req, res) => res.json(await getConfig())));

app.post(
  '/api/submit',
  rateLimit,
  upload.fields([{ name: 'like_screenshot', maxCount: 1 }, { name: 'comment_screenshot', maxCount: 1 }]),
  ah(async (req, res) => {
    const like = req.files && req.files.like_screenshot && req.files.like_screenshot[0];
    const comment = req.files && req.files.comment_screenshot && req.files.comment_screenshot[0];
    if (!like || !comment) {
      return res.status(400).json({ error: 'Like aur comment dono ke screenshot (PNG/JPG/WEBP/GIF) zaroori hain.' });
    }
    const name = String(req.body.name || '').trim().slice(0, 80);
    const cfg = await getConfig();

    const id = crypto.randomUUID();
    const likePath = `${id}/like${EXT[like.mimetype]}`;
    const commentPath = `${id}/comment${EXT[comment.mimetype]}`;

    const [u1, u2] = await Promise.all([
      sb.storage.from(BUCKET).upload(likePath, like.buffer, { contentType: like.mimetype }),
      sb.storage.from(BUCKET).upload(commentPath, comment.buffer, { contentType: comment.mimetype }),
    ]);
    if (u1.error || u2.error) {
      await sb.storage.from(BUCKET).remove([likePath, commentPath]);
      throw u1.error || u2.error;
    }

    const { error } = await sb.from('submissions').insert({
      id, name, link: cfg.link || '', like_path: likePath, comment_path: commentPath,
    });
    if (error) {
      await sb.storage.from(BUCKET).remove([likePath, commentPath]);
      throw error;
    }
    res.json({ ok: true });
  })
);

// ---------- admin ----------
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

app.post('/api/admin/login', (req, res) => {
  if (req.body && typeof req.body.password === 'string' && sameSecret(req.body.password, ADMIN_PASSWORD)) {
    const secure = req.secure ? '; Secure' : '';
    res.setHeader('Set-Cookie', `sid=${makeToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${secure}`);
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Galat password' });
});

app.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/admin/config', requireAdmin, ah(async (req, res) => res.json(await getConfig())));

app.post('/api/admin/config', requireAdmin, ah(async (req, res) => {
  const link = String((req.body && req.body.link) || '').trim();
  const title = String((req.body && req.body.title) || '').trim().slice(0, 120);
  if (link && (!/^https?:\/\/\S+$/i.test(link) || link.length > 500))
    return res.status(400).json({ error: 'Sahi link daalein (http:// ya https:// se shuru).' });
  const { error } = await sb.from('config').upsert({ id: 1, link, title });
  if (error) throw error;
  res.json({ ok: true });
}));

app.get('/api/admin/submissions', requireAdmin, ah(async (req, res) => {
  const { data, error } = await sb.from('submissions').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  const paths = data.flatMap((r) => [r.like_path, r.comment_path]);
  const urls = {};
  if (paths.length) {
    const { data: signed, error: e2 } = await sb.storage.from(BUCKET).createSignedUrls(paths, 3600);
    if (e2) throw e2;
    (signed || []).forEach((s) => { if (s.signedUrl) urls[s.path] = s.signedUrl; });
  }
  res.json(data.map((r) => ({ ...r, like_url: urls[r.like_path] || '', comment_url: urls[r.comment_path] || '' })));
}));

app.post('/api/admin/submissions/:id/status', requireAdmin, ah(async (req, res) => {
  const status = req.body && req.body.status;
  if (!['pending', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Bad status' });
  const { error } = await sb.from('submissions').update({ status }).eq('id', req.params.id);
  if (error) throw error;
  res.json({ ok: true });
}));

app.delete('/api/admin/submissions/:id', requireAdmin, ah(async (req, res) => {
  const { data: row, error } = await sb.from('submissions').select('*').eq('id', req.params.id).maybeSingle();
  if (error) throw error;
  if (!row) return res.status(404).json({ error: 'Not found' });
  await sb.storage.from(BUCKET).remove([row.like_path, row.comment_path]);
  const { error: e2 } = await sb.from('submissions').delete().eq('id', row.id);
  if (e2) throw e2;
  res.json({ ok: true });
}));

// screenshot download (admin only) -> Supabase ke signed download link par redirect
app.get('/admin/dl', requireAdmin, ah(async (req, res) => {
  const p = String(req.query.path || '');
  if (!/^[0-9a-f-]{36}\/(like|comment)\.(png|jpg|webp|gif)$/.test(p)) return res.status(400).send('Bad path');
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(p, 60, { download: true });
  if (error || !data) return res.status(404).send('Not found');
  res.redirect(data.signedUrl);
}));

app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Screenshot 2MB se chhota hona chahiye.' });
  console.error(err);
  res.status(500).json({ error: 'Server error. Thodi der baad try karein.' });
});

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Site chal rahi hai: http://localhost:${PORT}  |  Admin: http://localhost:${PORT}/admin`));
}

module.exports = app;
