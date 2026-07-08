# Deploy public demo

App nay can mot server Node public de nguoi dung khac mang van truy cap duoc.

## Cach hoat dong

- `localhost:4174`: chi dung tren may dang chay server.
- `192.168.x.x:4174`: chi dung trong cung mang LAN/Wi-Fi.
- Public URL nhu `https://ten-app.onrender.com`: dung duoc tu bat ky mang nao.

## Lua chon nhanh nhat: Render Web Service

Render phu hop cho ban demo Node server hien tai vi app da co san:

- `package.json` voi script `start`
- `server.js` doc bien moi truong `PORT`
- server bind `0.0.0.0`
- `render.yaml` de Render tu nhan cau hinh deploy

### Cach A: Deploy bang render.yaml

1. Day project len GitHub.
2. Vao Render dashboard.
3. Chon New > Blueprint.
4. Ket noi repo GitHub vua day len.
5. Render se doc `render.yaml` va tao Web Service.

### Cach B: Tao Web Service thu cong

- Service type: Web Service
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Publish/Static directory: bo trong
- Plan: Free

Sau khi deploy, Render se cap URL dang:

`https://ten-app.onrender.com`

Moi nguoi chi can mo URL nay, dang ky Gmail, tim Gmail cua nhau, ket ban va chat.

## Luu y ve du lieu

Ban hien tai luu users/messages vao file `chat-db.json`.

Dieu nay on cho demo nhanh, nhung hosting free co the mat file khi redeploy, restart hoac khi instance bi reset. Khi muon dung nghiem tuc, nen chuyen sang database public:

- Firebase Auth + Firestore
- Supabase Postgres
- Render Postgres / Railway Postgres
- MongoDB Atlas

Neu dung goi co persistent disk, dat bien moi truong:

`DATA_DIR=/var/data`

Khi do server se luu database tai `/var/data/chat-db.json`.

## Demo tam thoi khong deploy

Neu chi muon dua link tam trong vai gio, co the dung tunnel:

- Cloudflare Tunnel
- ngrok
- LocalTunnel

Tunnel se bien server local cua ban thanh mot URL public tam thoi. Nhuoc diem: may ban phai bat lien tuc, tat may la link chet.

## Bao mat can them truoc khi dung that

- Xac minh Gmail bang email verification hoac Google Sign-In that.
- Dung HTTPS public.
- Doi session token sang cookie HttpOnly hoac JWT co han su dung.
- Them rate limit de tranh spam dang ky/tin nhan.
- Luu database that thay vi file JSON.
