# 9Drive Mobile

Proyek ini lahir dari fork [zenhosta/9drive](https://github.com/zenhosta/9drive) — sebuah storage gateway untuk Google Drive. Versi ini mengambil konsep yang sama tapi dibangun ulang dari nol dengan stack yang berbeda dan fokus ke pengalaman mobile.

Masih dalam tahap pengembangan aktif.

---

## Kenapa ini ada?

Backend aslinya pakai TypeScript/Express. Gw rewrite ke Python (FastAPI) karena lebih familiar dan lebih gampang di-maintain untuk jangka panjang. Frontend webnya diganti ke React Native supaya bisa jalan di Android.

Tujuan utamanya: satu app yang bisa ngatur beberapa akun Google Drive sekaligus, dengan routing upload otomatis ke akun yang paling banyak ruang kosongnya.

---

## Stack

**Backend**
- Python 3.12+
- FastAPI
- SQLAlchemy + MySQL
- Google Drive API

**Mobile**
- React Native (Expo SDK 56)
- expo-router
- expo-secure-store

---

## Fitur yang sudah jalan

- Register & login (email/password)
- Connect beberapa akun Google Drive
- Upload file — otomatis masuk ke Drive yang paling banyak ruang
- List, hapus, rename file
- Virtual folder
- Sync file dari folder `9drive` di Google Drive ke database
- Storage summary & quota tracker per akun
- Batch delete & move file

---

## Cara jalanin (development)

### Backend

```bash
cd backend-python
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Buat file `.env`:

```env
DATABASE_URL=mysql+pymysql://root:root@localhost:3306/9drive
APP_PORT=4000
FRONTEND_URL=http://localhost:8081
JWT_ACCESS_SECRET=isi-random-string-panjang
TOKEN_ENCRYPTION_KEY=isi-32-karakter-tepat
GOOGLE_CLIENT_ID=isi-dari-google-cloud
GOOGLE_CLIENT_SECRET=isi-dari-google-cloud
GOOGLE_REDIRECT_URI=http://localhost:4000/connected-accounts/google/callback
```

Jalanin MySQL via Docker:

```bash
docker compose up -d
```

Jalanin server:

```bash
python main.py
```

### Mobile

```bash
cd frontend-mobile
npm install --legacy-peer-deps
npx expo start
```

Scan QR pakai Expo Go di Android, atau tekan `w` untuk buka di browser.

---

## Yang masih dalam pengerjaan

- Upload file dari mobile (Android)
- Preview file (gambar, PDF)
- Google Sign-in langsung dari app
- Dark/light mode
- Notifikasi upload selesai
- Build APK via EAS

---

## Kontribusi

PR dan issue terbuka untuk siapa saja. Kalau mau kontribusi, fork dulu terus buat branch baru dari `versi-xinac`.

---

## Lisensi

MIT
