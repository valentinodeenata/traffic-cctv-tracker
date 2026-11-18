# traffic-cctv-tracker

Peta macet Jabodetabek dari CCTV publik. Bisa langsung dibuka di https://traffic.valentinodeenata.com

![Rute Bundaran HI ke Blok M dengan warna lalu lintas dan dua rute alternatif](docs/rute.webp)

Tiap 5 menit, server ngambil gambar dari sekitar 210 kamera yang lagi online. Model deteksi menghitung kendaraan di tiap gambar.
Dari situ tiap kamera dapat status Lancar, Ramai, atau Padat.

## Yang bisa dilakukan

- Lihat semua kamera di peta. Warnanya ikut status masing-masing.
- Buka kamera buat nonton video live-nya. Videonya diputar langsung dari server pemilik kamera.
- Cek apa yang dihitung AI di tab "Deteksi AI". Kotak hijau artinya kendaraan bergerak, oranye artinya berhenti.
- Lihat grafik 24 jam tiap kamera, lengkap dengan garis "biasanya jam segini".
- Cari rute pakai motor atau mobil. Kalau motor, rutenya otomatis nggak lewat tol.
- Garis rute diwarnai sesuai kondisi sekarang. Biru lancar, kuning ramai, merah padat, merah tua macet.
- Kamera yang dilewati rute muncul di daftar, jadi videonya bisa langsung dicek.
- Simpan rute yang sering dipakai. Rutenya cuma disimpan di browser kamu.

![Peta kamera Jabodetabek dengan status Lancar, Ramai, Padat](docs/peta.webp)

## Kenapa nggak cuma ngitung mobil

Jumlah kendaraan aja nggak cukup buat bilang jalan macet. Jalan lebar hampir selalu kelihatan penuh. Lampu merah juga pasti ada antreannya.

Jadi tiap kamera diambil 2 gambar dengan jeda 2 detik. Kendaraan yang hampir nggak geser dihitung berhenti.
Angkanya lalu dibandingkan sama kondisi normal kamera itu di jam yang sama selama 7 hari terakhir.

- **Padat**: yang berhenti minimal 4 kendaraan, minimal dua kali lipat dari biasanya, dan minimal separuh dari yang kelihatan.
  Kondisinya harus muncul di 2 dari 3 putaran terakhir (sekitar 10 menit). Satu kali lampu merah nggak cukup.
- **Ramai**: kendaraan yang kelihatan jauh lebih banyak dari biasanya (minimal 8). Bisa juga karena kondisi padat baru muncul sekali.
- **Lancar**: selain dua kondisi di atas.

Mobil yang parkir selalu kehitung berhenti. Karena ada tiap hari, dia masuk ke angka "biasanya" dan nggak bikin status naik.

Detailnya ada di [`scripts/levels.mjs`](scripts/levels.mjs). Kasus yang ketemu di lapangan aku jadikan test.

## Seberapa akurat

Aku cek 50 gambar siang hari dari semua sumber kamera pakai [`scripts/eval-sample.mjs`](scripts/eval-sample.mjs).

| Model | Kendaraan ketemu | Precision | Recall (perkiraan) |
|---|---|---|---|
| YOLOX-nano, 416 px | 198 | ±94% | ±55% |
| **YOLOX-s, 640 px** (yang dipakai) | 321 | setara | ±80% |

YOLOX-nano jarang salah, tapi cuma nangkep sekitar separuh kendaraan. Gambar kamera tol ukurannya 720p sampai 1080p.
Begitu dikecilkan ke 416 px, mobil yang agak jauh hilang. YOLOX-s pakai 640 px dan nemu 62% lebih banyak.

Yang masih sering lolos: bus warna gelap yang kelihatan dari samping, sama kendaraan yang jauh banget di kamera tol.

## Warna rute

Warna jalan di rute datang dari TomTom, yang datanya dari GPS kendaraan. Kamera di sini jadi pembuktinya.
Kalau garisnya merah, kamera di titik itu bisa langsung dibuka. Kamera dianggap ada di rute kalau jaraknya paling jauh 60 m dari garis.

Key TomTom cuma ada di server. Server membatasi 600 rute dan 80 pencarian per hari biar tetap di kuota gratis.
Rute yang sama dalam 3 menit diambil dari cache. Kalau key-nya kosong, panel rute mati tapi peta tetap jalan.
Kodenya ada di [`scripts/route.mjs`](scripts/route.mjs).

## Dibuat pakai

- Node.js 24 tanpa framework
- `node:sqlite` buat database, `node:test` buat test
- YOLOX-s lewat onnxruntime-node, jalan di CPU
- ffmpeg buat ngambil gambar dari stream
- MapLibre GL dan OpenFreeMap buat peta
- hls.js buat video live
- TomTom Routing dan Search API buat rute
- VPS 2 vCPU / 2 GB dengan systemd dan Caddy
- GitHub Actions buat test dan deploy

Dependency npm-nya cuma satu, `onnxruntime-node`.

## Cara kerjanya

```
CCTV publik (HLS / JPEG)
      │ ffmpeg, 2 gambar per kamera tiap 5 menit, 8 kamera sekaligus
      ▼
collector.mjs ── detect.mjs (YOLOX-s) ── levels.mjs (status per kamera)
      │                                        │
      ▼                                        ▼
SQLite (angka saja)                     web.mjs (API + halaman peta) ── route.mjs (TomTom)
                                               │
                                     Caddy → traffic.valentinodeenata.com
```

Semuanya jalan di satu proses Node. Proses ini ngambil gambar, ngitung, nyimpen hasilnya, sekaligus melayani halaman peta.
Gambar terakhir tiap kamera cuma ditaruh di RAM buat tab "Deteksi AI". Yang masuk disk cuma angka.

## Penyimpanan

Data per 5 menit disimpan 7 hari. Ringkasan per jam disimpan 180 hari. Log tiap putaran disimpan 90 hari.
Data lama dibersihkan sendiri sekali sehari ([`scripts/db.mjs`](scripts/db.mjs)).

Browser juga nyimpen respons terakhir. Jadi waktu halaman dibuka lagi, petanya langsung muncul sambil nunggu data baru.

## Progress

- [x] Kamera dari 3 portal publik
- [x] Hitung kendaraan dan deteksi yang berhenti
- [x] Status tiap kamera dibanding kondisi normalnya
- [x] Peta, video live, tampilan deteksi AI, grafik 24 jam
- [x] Rute dengan warna lalu lintas
- [x] Deploy otomatis dengan rollback
- [ ] Jam terbaik buat berangkat, dari riwayat beberapa minggu
- [ ] Fitur logistik: ganjil-genap, larangan truk, cek rute pengiriman

## Jalanin sendiri

Butuh Node 24+ dan ffmpeg.

```
npm install
curl -L -o models/yolox_s.onnx https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_s.onnx

node scripts/fetch-cameras.mjs             # daftar kamera -> data/cameras.json
node scripts/collector.mjs --once          # 1 putaran: ambil gambar, hitung, simpan ke data/traffic.db
node scripts/collector.mjs --once --save   # sama, tapi gambarnya ikut disimpan ke snapshots/
PORT=8790 node scripts/collector.mjs       # jalan terus tiap 5 menit, UI di http://127.0.0.1:8790
node scripts/detect.mjs foto.jpg           # hitung kendaraan di satu gambar
node scripts/eval-sample.mjs 50 yolox_nano,yolox_s   # bandingin model, hasilnya di snapshots/
npm test
```

Mau model yang lebih ringan? Pakai `DETECT_MODEL=yolox_nano`.
Panel rute butuh `TOMTOM_API_KEY=...` di file `.env`. File ini nggak ikut ke git.

## Deploy

Tiap push ke `main`, CI jalanin test lalu bikin paket rilis. Paketnya dikirim ke VPS lewat SSH, terus collector di-restart.
Kalau 30 detik kemudian collector mati atau API nggak jawab, CI otomatis balik ke rilis sebelumnya.
Setup server cukup sekali, lihat [`deploy/bootstrap-server.sh`](deploy/bootstrap-server.sh).

## Sumber kamera

- CCTV Publik Pemprov DKI Jakarta (jakcctv.jakarta.go.id/publik)
- CCTV jalan tol BPJT Kementerian PU (bpjt.pu.go.id/cctv)
- CCTV Bina Marga (binamarga.pu.go.id)

Videonya nggak disimpan sama sekali. Semuanya diputar langsung dari server pemiliknya.
Kamera Jasa Marga di portal BPJT butuh token, jadi belum bisa ditampilkan.
