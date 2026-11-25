/*
 * Keuanganku versi aplikasi: kunci PIN + jalur data ke Apps Script.
 * - Kode rahasia (dari Apps Script, buatKodeAplikasi) dimasukkan sekali dan disimpan di HP ini.
 * - PIN 6 angka dibuat di HP ini, disimpan sebagai sidik (hash), dan diminta setiap aplikasi dibuka
 *   atau setelah ditinggal lebih dari 3 menit.
 * - Kalau URL jalur data belum diisi (config.js), aplikasi berjalan dengan data contoh (mode pratinjau).
 */
(function () {
  const URL_API = (window.KEU_API_URL || '').trim();
  const DEMO = !URL_API;
  const K_KODE = 'keuKode', K_PIN = 'keuPin', K_GAGAL = 'keuPinGagal', K_TERAKHIR = 'keuAktif';
  const BATAS_DIAM = 3 * 60 * 1000; // kunci lagi setelah 3 menit di latar belakang
  const MAKS_SALAH_PIN = 5;
  const simpan = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  const ambil = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };

  let bukaResolve, terbuka = new Promise(r => { bukaResolve = r; });
  let sudahBuka = false;

  async function sidik(teks) {
    const data = new TextEncoder().encode('keuanganku|' + teks);
    const h = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function kirim(fn, args, kode) {
    const res = await fetch(URL_API, { method: 'POST', body: JSON.stringify({ k: kode, fn, args: args || [] }), redirect: 'follow' });
    let d;
    try { d = await res.json(); } catch (e) { throw new Error('Jawaban server tidak terbaca. Periksa internet lalu coba lagi.'); }
    return d;
  }

  // ---------- Layar kunci ----------
  const gaya = document.createElement('style');
  gaya.textContent = `
    #kunci { position: fixed; inset: 0; z-index: 9999; display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 10px; padding: 24px; color: #fff; text-align: center; font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      background: radial-gradient(120% 70% at 100% 0%, rgba(255,255,255,.12), transparent 60%), linear-gradient(160deg, #0f766e, #134e4a); }
    #kunci[hidden] { display: none; }
    #kunci .logo { width: 72px; height: 72px; border-radius: 18px; box-shadow: 0 8px 24px rgba(0,0,0,.25); }
    #kunci h1 { font-size: 20px; margin: 6px 0 0; }
    #kunci p { margin: 0; opacity: .9; max-width: 320px; font-size: 14px; }
    #kunci .pesan { min-height: 20px; color: #fde68a; font-size: 13px; }
    #kunci .titik { display: flex; gap: 12px; margin: 10px 0 6px; }
    #kunci .titik i { width: 14px; height: 14px; border-radius: 50%; border: 2px solid #fff; }
    #kunci .titik i.isi { background: #fff; }
    #kunci .pad { display: grid; grid-template-columns: repeat(3, 68px); gap: 12px; margin-top: 6px; }
    #kunci .pad button { height: 60px; border-radius: 50%; border: none; background: rgba(255,255,255,.16); color: #fff; font-size: 22px; font-weight: 600; cursor: pointer; }
    #kunci .pad button:active { background: rgba(255,255,255,.32); }
    #kunci .pad button.kosong { background: none; }
    #kunci input { width: min(320px, 100%); padding: 12px 14px; border-radius: 12px; border: none; font: 600 16px ui-monospace, monospace; text-align: center; letter-spacing: .04em; }
    #kunci .utama { padding: 12px 22px; border-radius: 12px; border: none; background: #fff; color: #0f766e; font-weight: 700; font-size: 15px; cursor: pointer; }
    #kunci .utama:disabled { opacity: .6; }
    #kunci .tipis { background: none; border: none; color: #fff; opacity: .85; text-decoration: underline; cursor: pointer; font-size: 13px; }
    #kunci .demo { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); background: #fde68a; color: #713f12; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 99px; }
  `;
  document.head.appendChild(gaya);

  const layar = document.createElement('div');
  layar.id = 'kunci';
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(layar));
  const logo = '<img class="logo" src="ikon-192.png" alt="">';

  function tampil(html) { layar.innerHTML = (DEMO ? '<span class="demo">Mode contoh · data tidak tersimpan</span>' : '') + html; layar.hidden = false; }
  function tutupKunci() {
    layar.hidden = true;
    simpan(K_TERAKHIR, String(Date.now()));
    if (!sudahBuka) { sudahBuka = true; bukaResolve(); }
  }

  // Masukkan kode rahasia (sekali saja)
  function layarKode(pesan) {
    tampil(logo + '<h1>Hubungkan Keuanganku</h1><p>Masukkan kode rahasia dari Apps Script (fungsi <b>buatKodeAplikasi</b>). Cukup sekali di HP ini.</p>' +
      '<input id="kKode" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="xxxxxx-xxxxxx-xxxxxx-xxxxxx">' +
      '<div class="pesan" id="kPesan">' + (pesan || '') + '</div><button class="utama" id="kOk">Hubungkan</button>');
    const ok = layar.querySelector('#kOk');
    ok.onclick = async () => {
      const kode = layar.querySelector('#kKode').value.trim();
      if (!kode) return;
      ok.disabled = true; layar.querySelector('#kPesan').textContent = 'Memeriksa…';
      try {
        const d = await kirim('cek', [], kode);
        if (d.ok) { simpan(K_KODE, kode); layarBuatPin(); }
        else layar.querySelector('#kPesan').textContent = d.error || 'Kode tidak diterima.';
      } catch (e) { layar.querySelector('#kPesan').textContent = e.message; }
      ok.disabled = false;
    };
  }

  // Papan angka PIN
  function papan(judul, teks, selesai, bawah) {
    let isi = '';
    tampil(logo + '<h1>' + judul + '</h1><p>' + teks + '</p><div class="titik">' + '<i></i>'.repeat(6) + '</div><div class="pesan" id="kPesan"></div>' +
      '<div class="pad">' + [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => '<button data-n="' + n + '">' + n + '</button>').join('') +
      '<button class="kosong" disabled></button><button data-n="0">0</button><button data-n="x" aria-label="Hapus">⌫</button></div>' + (bawah || ''));
    const titik = () => layar.querySelectorAll('.titik i').forEach((t, i) => t.classList.toggle('isi', i < isi.length));
    layar.querySelector('.pad').onclick = e => {
      const b = e.target.closest('button[data-n]');
      if (!b) return;
      if (b.dataset.n === 'x') isi = isi.slice(0, -1);
      else if (isi.length < 6) isi += b.dataset.n;
      titik();
      if (isi.length === 6) { const p = isi; isi = ''; setTimeout(() => { titik(); selesai(p); }, 120); }
    };
    return m => { layar.querySelector('#kPesan').textContent = m; };
  }

  function layarBuatPin() {
    const pesan = papan('Buat PIN', 'Buat PIN 6 angka untuk membuka Keuanganku di HP ini.', async p1 => {
      const pesan2 = papan('Ulangi PIN', 'Masukkan PIN yang sama sekali lagi.', async p2 => {
        if (p1 !== p2) { layarBuatPin(); setTimeout(() => layar.querySelector('#kPesan').textContent = 'PIN tidak sama, ulangi dari awal.', 0); return; }
        simpan(K_PIN, await sidik(p1)); simpan(K_GAGAL, '0'); tutupKunci();
      });
    });
    return pesan;
  }

  function layarPin() {
    const pesan = papan('Keuanganku', 'Masukkan PIN untuk membuka.', async p => {
      if (await sidik(p) === ambil(K_PIN)) { simpan(K_GAGAL, '0'); tutupKunci(); return; }
      const gagal = Number(ambil(K_GAGAL) || 0) + 1;
      simpan(K_GAGAL, String(gagal));
      if (gagal >= MAKS_SALAH_PIN) {
        // Terlalu banyak salah: hapus kode & PIN dari HP ini, harus dihubungkan ulang dengan kode rahasia
        simpan(K_KODE, null); simpan(K_PIN, null); simpan(K_GAGAL, null);
        layarKode('PIN salah ' + MAKS_SALAH_PIN + ' kali. Demi keamanan, hubungkan ulang dengan kode rahasia.');
        return;
      }
      pesan('PIN salah. Sisa ' + (MAKS_SALAH_PIN - gagal) + ' kali percobaan.');
    }, '<button class="tipis" id="kLupa">Lupa PIN?</button>');
    layar.querySelector('#kLupa').onclick = () => {
      if (confirm('Hubungkan ulang dengan kode rahasia dan buat PIN baru? Data di sheet tidak berubah.')) {
        simpan(K_KODE, null); simpan(K_PIN, null); layarKode();
      }
    };
  }

  function mulai() {
    if (DEMO) { if (!ambil(K_PIN)) return layarBuatPin(); return layarPin(); }
    if (!ambil(K_KODE)) return layarKode();
    if (!ambil(K_PIN)) return layarBuatPin();
    layarPin();
  }
  document.addEventListener('DOMContentLoaded', mulai);

  // Kunci lagi setelah ditinggal lama
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (layar.hidden) simpan(K_TERAKHIR, String(Date.now())); return; }
    const t = Number(ambil(K_TERAKHIR) || 0);
    if (sudahBuka && layar.hidden && Date.now() - t > BATAS_DIAM) layarPin();
  });

  // ---------- Dipakai call() di Index.html ----------
  window.APLIKASI = {
    demo: DEMO,
    async panggil(fn, args) {
      await terbuka;
      if (DEMO) { await new Promise(r => setTimeout(r, 250)); return MOCK[fn](...args); } // eslint-disable-line no-undef
      const d = await kirim(fn, args, ambil(K_KODE));
      if (d.ok) return d.data;
      if (d.kode) { simpan(K_KODE, null); layarKode('Kode rahasia sudah tidak berlaku. Masukkan kode yang baru.'); }
      throw new Error(d.error || 'Gagal menghubungi server.');
    },
    kunci() { layarPin(); },
  };
})();
