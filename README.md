# traffic-cctv-tracker

Membaca CCTV lalu lintas publik dan mengubahnya jadi status jalan: lancar, padat, atau macet.

Rencana:
- Status jalan dari jumlah kendaraan di tiap kamera
- Rute harian dengan notifikasi lewat bot Telegram
- Riwayat: jam berapa biasanya jalan ini padat

Video tidak disimpan. Yang disimpan hanya hasil hitungan.
Stream tetap diputar langsung dari server pemilik kamera.

## Menjalankan

Butuh Node 24+ dan ffmpeg.

```
npm install
curl -L -o models/yolox_s.onnx https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_s.onnx
```

Deteksi kendaraan pakai YOLOX-s (Apache-2.0) lewat onnxruntime-node. `DETECT_MODEL=yolox_nano` untuk model yang lebih ringan.
Cek akurasi: `node scripts/eval-sample.mjs 50 yolox_nano,yolox_s` (frame beranotasi di `snapshots/`).

```
node scripts/fetch-cameras.mjs         # daftar kamera Jabodetabek -> data/cameras.json
node scripts/collector.mjs --once      # 1 putaran: ambil frame, hitung kendaraan, simpan ke data/traffic.db
node scripts/collector.mjs --once --save   # sama, plus simpan frame ke snapshots/ untuk cek akurasi
node scripts/detect.mjs foto.jpg       # hitung kendaraan di satu gambar
node scripts/collector.mjs             # jalan terus, tiap 5 menit
npm test
```

Sumber kamera: CCTV Publik Pemprov DKI Jakarta (jakcctv.jakarta.go.id/publik),
CCTV jalan tol BPJT Kementerian PU (bpjt.pu.go.id/cctv), CCTV Bina Marga (binamarga.pu.go.id).

## Deploy

Push ke `main` → CI menjalankan test, membangun rilis (kode, `node_modules` Linux, model dengan checksum),
mengirimnya ke VPS lewat SSH, lalu me-restart service `traffic-collector`. Kalau collector tidak jalan
30 detik setelahnya, CI otomatis rollback ke rilis sebelumnya.

Setup server sekali saja: lihat komentar di `deploy/bootstrap-server.sh`.
Database ada di server: `/var/lib/traffic/traffic.db`. Monitor: https://traffic.valentinodeenata.com

Penyimpanan: server hanya menyimpan angka (tidak ada gambar). Data mentah per 5 menit 7 hari, ringkasan per jam 180 hari,
log putaran 90 hari; collector membersihkan sendiri sekali sehari (`maintain()` di `scripts/db.mjs`).
