# Screenshot Submit Site (Supabase + Vercel / Render)

Admin link set karta hai, users us link par click karke like/comment karte hain aur dono ke screenshot submit karte hain.
Saare screenshot Supabase Storage mein save hote hain aur admin panel (`/admin`) mein dikhte hain.

## 1) Supabase setup (5 minute)
1. supabase.com par naya project banayein.
2. **SQL Editor** -> New query -> `supabase.sql` ka poora content paste karke **Run**.
   (Isse tables aur private `screenshots` bucket ban jayega.)
3. **Project Settings -> API** se ye do cheezein copy karein:
   - Project URL  -> `SUPABASE_URL`
   - `service_role` key -> `SUPABASE_SERVICE_ROLE_KEY` (SECRET hai, kisi ko mat dena)

## 2) Vercel par deploy
1. Folder ko GitHub par push karein (`.env` push nahi hota, `.gitignore` mein hai).
2. vercel.com -> **Add New -> Project** -> repo import karein.
3. **Environment Variables** mein daalein:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ADMIN_PASSWORD`
   - `SESSION_SECRET` (koi bhi lamba random text)
4. **Deploy**. Site: `https://aapka-project.vercel.app`, admin: `/admin`.

## 3) Render par deploy
1. render.com -> **New -> Web Service** -> repo chunein.
2. Build Command: `npm install`  |  Start Command: `npm start`
3. Upar wale 4 environment variables daalein. Disk ki zaroorat nahi, data Supabase mein hai.

## Local par chalane ke liye
```
cp .env.example .env     # aur values bhar dein
npm install
npm run dev              # Node 20.6+ chahiye
```

## Notes
- Har screenshot max 2MB (browser khud chhota kar deta hai).
- Rate limit (ek IP se 10/ghanta) serverless par best-effort hai.
- Admin login cookie 24 ghante chalti hai.
