# Rencana paket Rabu: cuaca, layu, event desa, suara ambient

Status: DISETUJUI Ardian 2026-11-09 dengan 3 perubahan (lihat "Keputusan" di bawah). Dikerjakan bertahap. Ditulis 2026-11-09 untuk BACKLOG item 3 (cuaca + event desa) dan
item 1 (suara ambient). Semua angka adalah draf; letaknya nanti di `server/src/rules.ts` dan disetel
saat tes.

**Aturan nama:** semua ini disebut **cuaca** atau **event desa** (weather / village event). Jangan pernah
disebut "season": Season = halving PANEN.

## Keputusan Ardian (2026-11-09)

1. **Musim ulat dan Pesticide DIPOTONG** (Bonus di GDD). Yang dikerjakan: hujan, kemarau, layu,
   letusan + Volcanic soil + Clean ash, reaksi TaniBot dengan alasan di Log, visual, dan suara ambient.
   Bagian ulat di bawah tetap ditulis sebagai catatan untuk nanti, tapi TIDAK dibuat sekarang.
2. **Layu di mode demo:** baru mundur satu tahap setelah sekitar **10 hari demo** tanpa air
   (peringatan Thirsty / Wilting tetap muncul lebih dulu). Mode normal tetap 2 hari.
   Prinsip "pemain tidak pernah terjebak" tetap berlaku.
3. **Tidak ada push** sampai server siap dirilis ke VPS: web dan server dirilis bersamaan, dengan izin
   Ardian. Web harus tetap aman kalau server lama belum mengirim data cuaca.

Tahapan (lapor setelah tiap tahap, commit lokal saja): 1) aturan server + tes otomatis (server palsu),
2) TaniBot + Log, 3) visual web + suara ambient + screenshot 4 ukuran.

---

## 1. Aturan main

### Prinsip umum

- Cuaca berlaku untuk **seluruh desa sekaligus**: semua pemain mengalami cuaca yang sama pada hari yang sama.
- Cuaca dihitung dari **nomor hari desa** dengan rumus tetap, jadi tidak perlu tabel baru dan server
  yang restart tetap memberi cuaca yang sama. Mode normal memakai hari normal; mode demo memakai hari demo
  (1 menit), dengan event lebih sering (lihat bagian 4).
- **Tidak ada yang bisa mematikan pohon atau menghapus NFT.** Paling buruk: pohon berhenti tumbuh
  atau mundur satu tahap.
- Hari biasa ("Clear"): aturan seperti sekarang.

### Tabel cuaca dan event

| Cuaca / event | Peluang per hari (draf, mode normal) | Aturan |
|---|---|---|
| **Clear** (cerah) | sisanya, sekitar 55% | Siram 1x seperti sekarang. |
| **Rain** (hujan) | 20% | Semua pohon **otomatis tersiram gratis** sepanjang hari. Tombol Water bertuliskan "Watered by rain". |
| **Drought** (kemarau) | 12% | Pohon butuh **2x siram** hari itu. Satu kali siram hanya memberi setengah hari tumbuh; siram kedua menggenapkan. |
| ~~**Caterpillars** (musim ulat)~~ DIPOTONG | (8%, nanti) | Ulat muncul **terutama di durian** (draf: durian 60%, rambutan 25%, mangga 10% per pohon). Pohon berulat **berhenti tumbuh** sampai diobati dengan **Pesticide**. |
| **Eruption** (letusan Gunung Tandur) | jarang, sekitar 1x per 10 hari | 3 tahap, lihat di bawah. |

### Layu (GDD)

- **2 hari desa tanpa air = pohon mundur satu tahap** (mode normal). **Mode demo: sekitar 10 hari demo** (Keputusan 2). Hari hujan dihitung sebagai hari tersiram.
  - fruiting → tree (buah hilang, tumbuh lagi dari 60%)
  - tree → sprout
  - sprout → seed
- Pohon berstatus seed tidak bisa mundur lagi. Pohon "old" dan Memorial tidak terpengaruh.
- Setelah mundur, hitungan 2 hari dimulai lagi, jadi pohon tidak terus mundur tiap menit.
- Tampilan layu: label "Thirsty" (1 hari kering) lalu "Wilting!" (hampir mundur), dan daun pohon menguning.
- **Masa aman saat rilis:** hitungan hari kering mulai dari waktu rilis, bukan dari masa lalu.
  Tanpa ini, kebun pemain yang lama tidak disiram akan langsung mundur begitu fitur aktif.

### Ulat dan Pesticide (DIPOTONG, catatan untuk nanti)

- **Pesticide** adalah barang baru di Shop seharga **10 PANEN**, dan dibakar seperti barang Shop lain
  (memakai `burn` yang sudah ada).
- "Spray" di pohon berulat: ulat hilang, pohon tumbuh lagi. Pesticide juga melindungi pohon itu
  selama 1 hari.
- Ulat tidak pernah membunuh pohon. Kalau dibiarkan, pohon hanya berhenti tumbuh.

### Letusan Gunung Tandur (event desa)

1. **Peringatan** (draf: 2 jam sebelumnya di mode normal, 20 detik di mode demo): banner
   "Mount Tandur is rumbling!", asap kawah menebal, layar bergetar kecil sekali.
2. **Letusan** (draf: 1 jam di mode normal, 30 detik di mode demo): lava menyala, langit merah, abu turun.
   Semua pohon yang tidak old tertutup **abu**: tumbuh berhenti sampai abunya dibersihkan, atau sampai
   tahap 3 dimulai. Tombol baru **"Clean ash"** (gratis).
3. **Volcanic soil** (draf: 1 hari setelah letusan): pohon yang sudah bersih tumbuh **+30% lebih cepat**
   (bisa bertumpuk dengan pupuk), dan **peluang Gold naik** saat panen (draf: +5 poin persen).
- Letusan tidak pernah membunuh pohon atau menghapus NFT.

---

## 2. Reaksi TaniBot

TaniBot mendapat tahu cuaca hari ini (untuk aturan maupun untuk otak AI). Setiap aksi tetap diperiksa
aturan game, dan setiap alasan masuk Log.

| Keadaan | Aksi TaniBot | Contoh alasan di Log |
|---|---|---|
| Rain | Tidak menyiram (hemat). | "It's raining: the trees are watered for free." |
| Drought | Menyiram 2x. | "Drought: watered the Durian a second time." |
| Pohon "Wilting!" | Menyiram dulu, sebelum aksi lain. | "The Mango was wilting: watered it first." |
| ~~Caterpillars~~ (dipotong) | Menyemprot kalau ada Pesticide. Gaya Balanced/Turbo boleh membeli Pesticide (burn, dalam batas harian kontrak); Thrifty tidak membeli. | "Caterpillars on the Durian: sprayed pesticide (10 PANEN burned)." |
| Eruption (abu) | Membersihkan abu semua pohon. | "Ash from Mount Tandur: cleaned the trees." |
| Volcanic soil | Menyiram supaya bonus tidak terbuang. | "Volcanic soil: kept the trees watered for faster growth." |

- Di mode demo TaniBot sudah cepat bereaksi; untuk abu dan ulat ia bereaksi di putaran cepat berikutnya.
- Saran AI yang melanggar aturan (misalnya membeli melebihi budget) tetap ditolak, sama seperti sekarang.

---

## 3. Tampilan

- **Langit** (`web/src/art/sky.tsx`, memakai ulang pita warna, awan, matahari, bulan):
  - Rain: langit abu-abu, awan gelap, garis hujan piksel, kadang kilat kecil.
  - Drought: langit lebih kuning dan panas, matahari lebih besar, udara bergelombang tipis.
  - Caterpillars: langit biasa; ulat kecil piksel di pohon yang kena dan label "Caterpillars!".
  - Eruption: pita langit merah, lava menyala di kawah, abu piksel turun, asap tebal.
  - Volcanic soil: kilau tanah gelap keunguan di bedengan (kecil).
- **Partikel:** hujan dan abu dibatasi jumlahnya supaya HP tetap lancar.
- **Getaran layar:** kecil (1–2 piksel) saat peringatan dan saat letusan. Mati kalau perangkat memakai
  "reduce motion".
- **Banner** "Mount Tandur is rumbling!" memakai gaya peringatan emas dari notifikasi baru.
  Saat letusan berubah jadi merah "Eruption! Clean the ash off your trees."
- **Chip cuaca** di HUD, di grid yang sama (misalnya "☂ Rain", "☀ Drought"); tombol (i) menjelaskan aturannya.
- **Label pohon:** "Thirsty", "Wilting!", "Water 1/2" (kemarau), "Caterpillars!", "Ash".
- **Share card baru** "I survived the eruption!": langit merah dan abu di kartu, TaniBot memegang sapu.
  Muncul sekali per pemain setelah letusan pertama yang dialaminya.
- **Landing page tetap selalu siang tanpa cuaca.**

---

## 4. Mode demo (supaya juri bisa melihat)

- Satu hari demo = 1 menit, dan pola event dibuat **berulang tetap** supaya juri hampir pasti melihat
  semuanya dalam 10–15 menit:
  - Siklus 10 hari demo (10 menit): Clear, Rain, Clear, Drought, Clear, Clear, **Eruption**
    (peringatan, letusan, lalu Volcanic soil), Clear, Rain, Clear.
- **Kebun juri** dimulai di dekat letusan (misalnya 3 menit sebelum peringatan), supaya letusan muncul
  di awal tur juri.
- Mode normal memakai peluang di bagian 1 (acak tapi tetap dari nomor hari).
- Hanya di build dev: `?weather=rain|drought|caterpillars|eruption` untuk mengunci cuaca saat membuat
  screenshot dan video (seperti `?time=`). Tidak ada di versi produksi.

---

## 5. Yang berubah

### Server (`server/`)

- `rules.ts`: jadwal cuaca dari nomor hari (normal + demo), angka draf, aturan layu, kemarau 2x,
  pertumbuhan Volcanic soil, bonus Gold.
- `game.ts`:
  - pertumbuhan pohon memperhitungkan hujan (otomatis tersiram), kemarau, ulat, dan abu;
  - layu memakai jalur sinkron NFT yang sudah ada (perubahan tahap → `update_tree`);
  - aksi baru `POST /api/clean` (abu) dan `POST /api/spray` (ulat), barang Shop `pesticide`;
  - `weather` dikirim di state game (hari ini, tahap letusan, sisa waktu, cuaca besok).
- Database: hanya **tambah kolom** di tabel pohon (abu, ulat, jumlah siram hari ini, hari terakhir
  tersiram). Tidak ada tabel atau data yang dihapus.
- `tanibot.ts` + `brain.ts`: reaksi di bagian 2; cuaca masuk ke input otak AI.
- `judge.ts`: kebun juri dimulai di dekat letusan.
- Tes baru (bagian 6).

### Web (`web/`)

- Langit, partikel, getaran, banner, chip cuaca, label pohon, tombol Clean ash / Spray, Pesticide di Shop.
- Share card "eruption".
- Penjelasan di How to play (1 halaman kecil "Weather and events").
- **Suara ambient** (`audio.ts`):
  - siang: burung dan angin; malam: jangkrik; hujan: suara hujan; letusan: gemuruh pelan.
  - Ikut tombol **Sound (sfx)**, terpisah dari musik.
  - File suara hanya **CC0**, dicatat di `docs/ASSETS.md`.

### Kontrak: TIDAK diubah

- `update_tree` di `pohon` sudah boleh menurunkan tahap (hanya umur dan jumlah panen yang tidak boleh
  turun), jadi layu tidak butuh kontrak baru.
- Pesticide memakai `burn` yang sudah ada di `panen`.
- Bonus Volcanic soil dan cuaca hanya di server.

---

## 6. Risiko dan cara uji

### Risiko

| Risiko | Cara mengatasi |
|---|---|
| Kebun lama langsung layu saat rilis | Masa aman: hari kering dihitung mulai saat rilis. |
| Pemain kesal pohonnya mundur | Peringatan "Thirsty" dan "Wilting!" sehari sebelumnya; TaniBot menyiram dulu; tidak pernah mati. |
| Lebih banyak transaksi NFT (tahap turun lalu naik lagi) | Game yang bayar gas; dihitung saat tes; layu dibatasi 1 tahap per 2 hari. |
| TaniBot menghabiskan budget untuk Pesticide | Hanya Balanced/Turbo, tetap di bawah batas harian kontrak, dicatat di Log. |
| HP jadi lambat karena partikel | Jumlah partikel dibatasi, cek di 390 dan 402; reduce motion mematikan getaran. |
| Juri tidak sempat melihat letusan | Siklus demo tetap + kebun juri dimulai dekat letusan. |
| Kata "season" tercampur | Semua teks pakai "weather" / "village event"; cek dengan grep sebelum rilis. |

### Cara uji (semua di Mac, server palsu `CHAIN_MODE=fake`)

- **Tes otomatis server** (`npm test`):
  - jadwal cuaca selalu sama untuk hari yang sama; siklus demo benar;
  - hujan = tersiram, kemarau butuh 2x, ulat menghentikan tumbuh, Spray membakar 10 PANEN;
  - layu: 2 hari kering = mundur tepat 1 tahap, tidak mundur dari seed, old/Memorial aman, masa aman rilis;
  - letusan: abu menghentikan tumbuh, Clean ash, Volcanic soil mempercepat + bonus Gold,
    tidak pernah membunuh atau menghapus pohon;
  - TaniBot: tiap reaksi + alasan di Log + batas budget.
- **Tes web** (`npm test`, typecheck, build) dan `tools/ui-test-4sizes.sh`.
- **Uji browser:** `?weather=...` di 390, 402, 430, dan 1440, siang/malam; screenshot sebelum/sesudah;
  reduce motion.
- **Uji siklus demo nyata:** satu kebun demo di server palsu dibiarkan 15 menit, lalu cek Log dan state.
- **Uji testnet sebelum rilis:** satu kebun demo di testnet; cek NFT turun tahap di nearblocks
  (`update_tree`) dan Pesticide terbakar (`burn`).

### Langkah rilis ke VPS (setiap langkah menunggu izin Ardian)

1. Semua tes lulus. Web dan server dirilis **bersamaan** (Keputusan 3): push web (Vercel) hanya setelah
   server baru siap dan dengan izin. Web baru tetap aman dengan server lama: tampilan cuaca muncul hanya
   kalau server mengirim `weather`.
2. **STOP, minta izin.** Cek Entropy baca-saja: PID **3665978** dan waktu jalannya terus bertambah.
3. Backup database VPS (`/var/backups/nearvest`, sama seperti backup harian).
4. Siapkan rilis di Mac (`deploy/stage.sh`), kirim ke `/opt/nearvest/releases/nearvest-<commit>`.
5. Pindahkan link `/opt/nearvest/app` ke rilis baru dan **restart hanya `nearvest`** (tidak apt, tidak pm2).
6. Cek `/health`, satu kebun demo di situs live, Log TaniBot, dan Entropy masih PID 3665978.
7. **Rollback** kalau ada masalah: kembalikan link ke rilis lama dan restart `nearvest`. Kolom baru di
   database tidak mengganggu rilis lama.

---

## 7. Perkiraan waktu dan yang bisa dipotong

| Bagian | Perkiraan |
|---|---|
| Server: aturan cuaca, layu, kemarau, hujan + tes | 3–4 jam |
| Server: letusan (abu, Clean ash, Volcanic soil) + tes | 2 jam |
| Server: ulat + Pesticide + tes | 1,5 jam |
| TaniBot (aturan + AI + Log) + tes | 1,5–2 jam |
| Web: langit, partikel, banner, chip, label, tombol | 3–4 jam |
| Share card letusan + How to play | 1 jam |
| Suara ambient (cari CC0, pasang, catat lisensi) | 1,5 jam |
| Uji browser, screenshot, uji testnet, rilis | 2 jam |
| **Total** | **sekitar 15–18 jam** (Rabu penuh, sisa bisa masuk Kamis pagi) |

**Kalau waktu mepet, potong dari atas ke bawah:**

1. ~~Musim ulat + Pesticide~~: sudah dipotong (Keputusan 1).
2. Share card letusan (letusannya tetap ada).
3. Suara ambient tambahan (simpan siang/malam + hujan saja, buang gemuruh).
4. Getaran layar dan efek kilat.
5. Kemarau 2x (hujan dan layu tetap ada).

**Jangan dipotong:** hujan, layu (ini dari GDD), letusan + Volcanic soil, dan reaksi TaniBot dengan
alasan di Log. Itulah yang paling terlihat oleh juri.
