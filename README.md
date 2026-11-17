# traffic-cctv-tracker

Membaca CCTV lalu lintas publik dan mengubahnya jadi status jalan: lancar, padat, atau macet.

Rencana:
- Status jalan dari jumlah kendaraan di tiap kamera
- Rute harian dengan notifikasi lewat bot Telegram
- Riwayat: jam berapa biasanya jalan ini padat

Video tidak disimpan. Yang disimpan hanya hasil hitungan.
Stream tetap diputar langsung dari server pemilik kamera.

## Menjalankan

Butuh Node 24+. Tanpa dependency.

```
node scripts/fetch-cameras-dki.mjs     # daftar kamera DKI -> data/cameras-dki.json
node --test "scripts/*.test.mjs"
```

Sumber kamera: CCTV Publik Pemprov DKI Jakarta (jakcctv.jakarta.go.id/publik).
