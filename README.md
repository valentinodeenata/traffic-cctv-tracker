# traffic-cctv-tracker

Peta lalu lintas Jabodetabek dari CCTV publik. Tiap 5 menit, sekitar 210 kamera dibaca oleh model deteksi kendaraan,
lalu tiap kamera diberi status **Lancar**, **Ramai**, atau **Padat**.

**Live:** https://traffic.valentinodeenata.com

- Peta penuh dengan 475 titik kamera (DKI, jalan tol, Bina Marga), status per kamera, dan filter per status
- Video live langsung dari server pemilik kamera
- Tab "Deteksi AI": frame terakhir dengan kotak kendaraan, hijau = bergerak, oranye = berhenti
- Grafik 24 jam per kamera: jumlah kendaraan, yang berhenti, dan garis "biasanya jam segini"
- Halaman status sistem: kamera online, durasi tiap putaran, pemakaian penyimpanan
- **Rute**: cari alamat atau klik peta, pilih motor (otomatis tanpa tol) atau mobil. Garis rute diwarnai sesuai lalu lintas saat ini
  (biru lancar, kuning ramai, merah padat, merah tua macet), lengkap dengan 2–3 alternatif dan daftar kamera di sepanjang jalan.
  Rute bisa disimpan, tapi hanya di browser pemakainya

## Cara status ditentukan

Jumlah kendaraan saja tidak cukup. Jalan lebar selalu kelihatan ramai, dan lampu merah selalu punya antrean.
Jadi tiap kamera dibandingkan dengan kondisi normalnya sendiri.

1. Ambil 2 frame berjarak 2 detik, deteksi kendaraan di keduanya, cocokkan kotaknya. Kendaraan yang hampir tidak bergeser dihitung berhenti.
2. "Biasanya" = median kamera itu di jam yang sama (±1 jam) selama 7 hari terakhir.
3. **Padat**: kendaraan berhenti ≥ max(4, 2× biasanya + 1) dan minimal separuh dari yang terlihat, di 2 dari 3 putaran terakhir (±10 menit). Satu lampu merah tidak cukup.
4. **Ramai**: kendaraan terlihat ≥ max(8, 1,5× biasanya + 2), atau kondisi padat baru muncul di putaran terakhir.
5. Mobil parkir selalu "berhenti", jadi otomatis masuk ke angka biasanya dan tidak memicu status.

Aturannya ada di [`scripts/levels.mjs`](scripts/levels.mjs). Kasus nyata dari lapangan dijadikan test.

## Rute

Warna jalan berasal dari Routing API TomTom (data GPS kendaraan). Kamera kita jadi buktinya: kalau garisnya merah,
kamera di titik itu bisa langsung dibuka. Kamera dicocokkan ke rute kalau jaraknya ≤ 60 m dari garis ([`scripts/route.mjs`](scripts/route.mjs)).

Key TomTom hanya ada di server. Server jadi perantara dengan batas harian (600 rute, 80 pencarian) supaya tetap di kuota
gratis TomTom, dan permintaan yang sama dalam 3 menit dijawab dari memori. Tanpa `TOMTOM_API_KEY`, panel rute nonaktif dan peta tetap jalan.

## Akurasi deteksi

Dicek pada 50 frame siang hari dari semua sumber kamera (`scripts/eval-sample.mjs`):

| Model | Kendaraan terdeteksi | Precision | Recall (perkiraan) |
|---|---|---|---|
| YOLOX-nano, 416 px | 198 | ±94% | ±55% |
| **YOLOX-s, 640 px** (dipakai) | 321 | setara | ±80% |

Yang masih sering terlewat: bus gelap dari samping, dan kendaraan yang sangat jauh di kamera tol.

## Tech stack

| | |
|---|---|
| Runtime | Node.js 24, tanpa framework. Server HTTP dari `node:http`, database dari `node:sqlite`, test dari `node:test` |
| Deteksi | YOLOX-s (Apache-2.0) di onnxruntime-node, CPU saja. Pre-processing dan pengambilan frame pakai ffmpeg |
| Database | SQLite (WAL). Hanya angka, tidak ada gambar atau video |
| Frontend | Satu file HTML, MapLibre GL + OpenFreeMap, hls.js untuk video live |
| Rute | TomTom Routing + Search API lewat server (key tidak pernah sampai ke browser) |
| Server | VPS 2 vCPU / 2 GB, systemd, Caddy (HTTPS otomatis) |
| CI/CD | GitHub Actions: test → build rilis → deploy lewat SSH → smoke test → rollback otomatis kalau gagal |

Dependency npm cuma satu: `onnxruntime-node`.

## Arsitektur

```
CCTV publik (HLS / JPEG)
      │ ffmpeg, 2 frame per kamera tiap 5 menit, 8 kamera paralel
      ▼
collector.mjs ── detect.mjs (YOLOX-s) ── levels.mjs (status per kamera)
      │                                        │
      ▼                                        ▼
SQLite (angka saja)                     web.mjs (API + halaman peta)
                                               │
                                     Caddy → traffic.valentinodeenata.com
```

Satu proses melakukan semuanya: ambil frame, hitung, simpan, dan melayani UI. Frame terakhir per kamera disimpan di RAM saja
supaya tab "Deteksi AI" bisa menampilkannya.

## Penyimpanan

Server hanya menyimpan angka. Data mentah per 5 menit disimpan 7 hari, ringkasan per jam 180 hari, log putaran 90 hari.
Collector membersihkan sendiri sekali sehari (`maintain()` di `scripts/db.mjs`). API mengirim `Cache-Control`,
dan browser menyimpan respons terakhir di localStorage, jadi halaman langsung tampil saat dibuka lagi.

## Status fitur

- [x] Daftar kamera Jabodetabek dari 3 portal publik
- [x] Deteksi kendaraan + deteksi kendaraan berhenti
- [x] Status Lancar / Ramai / Padat berdasarkan kondisi normal tiap kamera
- [x] Peta live, video, tampilan deteksi AI, grafik 24 jam
- [x] Deploy otomatis dengan rollback
- [x] Rute dengan warna lalu lintas, alternatif, kamera di sepanjang rute, rute tersimpan di browser
- [ ] Riwayat dan pola: jam terbaik untuk berangkat
- [ ] Untuk logistik: ganjil-genap, larangan truk, cek rute pengiriman

## Menjalankan di lokal

Butuh Node 24+ dan ffmpeg.

```
npm install
curl -L -o models/yolox_s.onnx https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_s.onnx

node scripts/fetch-cameras.mjs             # daftar kamera -> data/cameras.json
node scripts/collector.mjs --once          # 1 putaran: ambil frame, hitung, simpan ke data/traffic.db
node scripts/collector.mjs --once --save   # sama, plus simpan frame ke snapshots/
PORT=8790 node scripts/collector.mjs       # jalan terus tiap 5 menit + UI di http://127.0.0.1:8790
node scripts/detect.mjs foto.jpg           # hitung kendaraan di satu gambar
node scripts/eval-sample.mjs 50 yolox_nano,yolox_s   # bandingkan model, frame beranotasi di snapshots/
npm test
```

`DETECT_MODEL=yolox_nano` untuk model yang lebih ringan. Untuk panel rute, isi `TOMTOM_API_KEY=...` di file `.env` (tidak ikut ke git).

## Deploy

Push ke `main` → CI menjalankan test, membangun rilis (kode, `node_modules` Linux, model dengan checksum),
mengirimnya ke VPS lewat SSH, lalu me-restart service `traffic-collector`. Kalau collector mati atau API tidak menjawab
30 detik setelahnya, CI otomatis rollback ke rilis sebelumnya. Setup server sekali saja: lihat `deploy/bootstrap-server.sh`.

## Sumber kamera

CCTV Publik Pemprov DKI Jakarta (jakcctv.jakarta.go.id/publik), CCTV jalan tol BPJT Kementerian PU (bpjt.pu.go.id/cctv),
CCTV Bina Marga (binamarga.pu.go.id). Video tidak disimpan dan selalu diputar dari server pemiliknya.
Kamera Jasa Marga di portal BPJT butuh token, jadi tidak ditampilkan live.
