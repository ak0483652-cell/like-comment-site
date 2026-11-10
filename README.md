# Screenshot Submit Site

## Kaise chalayein
1. Node.js (v18+) install karein.
2. Is folder mein terminal kholein:
   ```
   npm install
   ADMIN_PASSWORD=apna-strong-password npm start
   ```
   (Windows PowerShell: `$env:ADMIN_PASSWORD="apna-strong-password"; npm start`)
3. Site: http://localhost:3000
4. Admin panel: http://localhost:3000/admin

## Pages
- `/` : admin ka set kiya link clickable dikhta hai; user like + comment screenshot submit karta hai
- `/admin` : password se login, link set/badalna, saari submissions + screenshots, download, approve/reject/delete

## Data kahan save hota hai
- `data/submissions.json` aur `data/uploads/` (screenshots sirf admin ko dikhte hain)

## Online daalne ke liye
Render / Railway / VPS par deploy karein. `ADMIN_PASSWORD` environment variable zaroor set karein
aur `data/` folder ke liye persistent disk/volume lagayein, warna restart par data ud sakta hai.
