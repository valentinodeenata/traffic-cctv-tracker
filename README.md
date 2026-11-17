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
node scripts/fetch-cameras.mjs         # daftar kamera Jabodetabek -> data/cameras.json
node --test "scripts/*.test.mjs"
```

Sumber kamera: CCTV Publik Pemprov DKI Jakarta (jakcctv.jakarta.go.id/publik),
CCTV jalan tol BPJT Kementerian PU (bpjt.pu.go.id/cctv), CCTV Bina Marga (binamarga.pu.go.id).
