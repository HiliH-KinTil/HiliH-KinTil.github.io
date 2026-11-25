/*
 * Keuanganku versi aplikasi: buka dengan PIN 6 angka atau sidik jari.
 * - PIN diatur pemilik lewat web Keuanganku (menu "📱 Aplikasi HP") dan diperiksa oleh Apps Script, bukan oleh HP.
 * - PIN benar = tanda masuk sementara (12 jam, hanya di memori).
 * - Sidik jari: setelah PIN benar, HP boleh menyimpan tanda perangkat (30 hari). Tanda itu hanya dipakai setelah
 *   sidik jari dikenali sensor HP (WebAuthn, pemeriksaan pengguna di HP).
 * - Kalau URL jalur data belum diisi (config.js), aplikasi berjalan dengan data contoh (mode pratinjau, PIN apa saja).
 */
(function () {
  const URL_API = (window.KEU_API_URL || '').trim();
  const DEMO = !URL_API;
  const K_BIO = 'keuBioId', K_TANDA = 'keuTandaHp', K_TERAKHIR = 'keuAktif', K_TOLAK_BIO = 'keuTolakBio';
  const BATAS_DIAM = 3 * 60 * 1000; // minta buka kunci lagi setelah 3 menit di latar belakang
  const simpan = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };
  const ambil = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  // Bersihkan sisa versi lama (kode rahasia & PIN lokal)
  ['keuKode', 'keuPin', 'keuPinGagal'].forEach(k => simpan(k, null));

  let tanda = null;            // tanda masuk yang dipakai sekarang
  let bukaResolve, terbuka = new Promise(r => { bukaResolve = r; });
  let sudahBuka = false;

  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const dariB64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const acakByte = n => crypto.getRandomValues(new Uint8Array(n));

  async function kirim(isi) {
    if (DEMO) {
      await new Promise(r => setTimeout(r, 300));
      if (isi.fn === 'masukPin') return { ok: true, data: { tanda: 'demo-sesi', jam: 12 } };
      if (isi.fn === 'tandaPerangkat') return { ok: true, data: { tanda: 'demo-perangkat', hari: 30 } };
      if (isi.fn === 'cek') return { ok: true, data: { jenis: 'perangkat' } };
      return { ok: true, data: MOCK[isi.fn](...(isi.args || [])) }; // eslint-disable-line no-undef
    }
    let res;
    try { res = await fetch(URL_API, { method: 'POST', body: JSON.stringify(isi), redirect: 'follow' }); }
    catch (e) { throw new Error('Tidak bisa terhubung. Periksa internet lalu coba lagi.'); }
    try { return await res.json(); } catch (e) { throw new Error('Jawaban server tidak terbaca. Coba lagi.'); }
  }

  const bioTersedia = async () => {
    try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); }
    catch (e) { return false; }
  };

  // ---------- Tampilan layar kunci ----------
  const gaya = document.createElement('style');
  gaya.textContent = `
    #kunci { position: fixed; inset: 0; z-index: 9999; display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 10px; padding: 24px; color: #fff; text-align: center; font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      background: radial-gradient(120% 70% at 100% 0%, rgba(255,255,255,.12), transparent 60%), linear-gradient(160deg, #0f766e, #134e4a); }
    #kunci[hidden] { display: none; }
    #kunci .logo { width: 72px; height: 72px; border-radius: 18px; box-shadow: 0 8px 24px rgba(0,0,0,.25); }
    #kunci h1 { font-size: 20px; margin: 6px 0 0; }
    #kunci p { margin: 0; opacity: .9; max-width: 320px; font-size: 14px; }
    #kunci .pesan { min-height: 20px; color: #fde68a; font-size: 13px; max-width: 320px; }
    #kunci .titik { display: flex; gap: 12px; margin: 10px 0 6px; }
    #kunci .titik i { width: 14px; height: 14px; border-radius: 50%; border: 2px solid #fff; }
    #kunci .titik i.isi { background: #fff; }
    #kunci .pad { display: grid; grid-template-columns: repeat(3, 68px); gap: 12px; margin-top: 6px; }
    #kunci .pad button { height: 60px; border-radius: 50%; border: none; background: rgba(255,255,255,.16); color: #fff; font-size: 22px; font-weight: 600; cursor: pointer; }
    #kunci .pad button:active { background: rgba(255,255,255,.32); }
    #kunci .pad button:disabled { opacity: .4; }
    #kunci .pad .kosong { background: none; }
    #kunci .pad .jari { font-size: 26px; }
    #kunci .utama { padding: 12px 22px; border-radius: 12px; border: none; background: #fff; color: #0f766e; font-weight: 700; font-size: 15px; cursor: pointer; }
    #kunci .tipis { background: none; border: none; color: #fff; opacity: .85; text-decoration: underline; cursor: pointer; font-size: 13px; padding: 6px; }
    #kunci .jari-besar { font-size: 54px; line-height: 1; margin: 8px 0; }
    #kunci .demo { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); background: #fde68a; color: #713f12; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 99px; white-space: nowrap; }
  `;
  document.head.appendChild(gaya);
  const layar = document.createElement('div');
  layar.id = 'kunci';
  layar.hidden = true;
  const logo = '<img class="logo" src="ikon-192.png" alt="">';
  const pesan = m => { const el = layar.querySelector('.pesan'); if (el) el.textContent = m || ''; };
  function tampil(html) { layar.innerHTML = (DEMO ? '<span class="demo">Mode contoh · PIN apa saja · data tidak tersimpan</span>' : '') + html; layar.hidden = false; }
  function selesai() {
    layar.hidden = true;
    simpan(K_TERAKHIR, String(Date.now()));
    if (!sudahBuka) { sudahBuka = true; bukaResolve(); }
  }

  // Layar PIN (+ tombol sidik jari kalau sudah diaktifkan di HP ini)
  function layarPin(info) {
    const adaBio = !!(ambil(K_BIO) && ambil(K_TANDA));
    let isi = '', sibuk = false;
    tampil(logo + '<h1>Keuanganku</h1><p>Masukkan PIN untuk membuka.</p><div class="titik">' + '<i></i>'.repeat(6) + '</div>' +
      '<div class="pesan">' + (info || '') + '</div><div class="pad">' + [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => '<button data-n="' + n + '">' + n + '</button>').join('') +
      (adaBio ? '<button class="jari" data-jari aria-label="Buka dengan sidik jari">👆</button>' : '<button class="kosong" disabled></button>') +
      '<button data-n="0">0</button><button data-n="x" aria-label="Hapus">⌫</button></div>');
    const titik = () => layar.querySelectorAll('.titik i').forEach((t, i) => t.classList.toggle('isi', i < isi.length));
    const kunciPad = v => layar.querySelectorAll('.pad button').forEach(b => { if (!b.classList.contains('kosong')) b.disabled = v; });
    layar.querySelector('.pad').onclick = async e => {
      if (e.target.closest('[data-jari]')) return bukaBio();
      const b = e.target.closest('button[data-n]');
      if (!b || sibuk) return;
      if (b.dataset.n === 'x') isi = isi.slice(0, -1); else if (isi.length < 6) isi += b.dataset.n;
      titik();
      if (isi.length < 6) return;
      sibuk = true; kunciPad(true); pesan('Memeriksa…');
      try {
        const d = await kirim({ fn: 'masukPin', pin: isi });
        if (d.ok) { tanda = d.data.tanda; pesan(''); return setelahPin(); }
        pesan(d.error || 'PIN tidak diterima.');
      } catch (err) { pesan(err.message); }
      isi = ''; titik(); sibuk = false; kunciPad(false);
    };
    if (adaBio && !info) setTimeout(bukaBio, 300);
  }

  // Setelah PIN benar: tawarkan sidik jari sekali (kalau HP mendukung dan belum aktif)
  async function setelahPin() {
    if (ambil(K_BIO) && ambil(K_TANDA)) return selesai();
    if (ambil(K_TOLAK_BIO) || !(await bioTersedia())) return selesai();
    tampil(logo + '<div class="jari-besar">👆</div><h1>Buka dengan sidik jari?</h1><p>Lain kali cukup tempel sidik jari. PIN tetap bisa dipakai kapan saja.</p>' +
      '<div class="pesan"></div><button class="utama" id="kBioYa">Aktifkan sidik jari</button><button class="tipis" id="kBioNanti">Nanti saja</button>');
    layar.querySelector('#kBioNanti').onclick = () => { simpan(K_TOLAK_BIO, '1'); selesai(); };
    layar.querySelector('#kBioYa').onclick = async () => {
      pesan('Tempel sidik jari…');
      try {
        const cred = await navigator.credentials.create({ publicKey: {
          rp: { name: 'Keuanganku', id: location.hostname },
          user: { id: acakByte(16), name: 'keuanganku', displayName: 'Keuanganku' },
          challenge: acakByte(32),
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
          timeout: 60000,
        } });
        const d = await kirim({ fn: 'tandaPerangkat', t: tanda });
        if (!d.ok) throw new Error(d.error || 'Gagal mengaktifkan sidik jari.');
        simpan(K_BIO, b64(cred.rawId)); simpan(K_TANDA, d.data.tanda);
        selesai();
      } catch (err) {
        pesan(err && err.name === 'NotAllowedError' ? 'Dibatalkan. Bisa diaktifkan lagi nanti.' : (err.message || 'Sidik jari gagal diaktifkan.'));
      }
    };
  }

  // Buka dengan sidik jari: sensor HP memeriksa jari, lalu tanda perangkat dipakai
  async function bukaBio() {
    const id = ambil(K_BIO), t = ambil(K_TANDA);
    if (!id || !t) return layarPin();
    pesan('Tempel sidik jari…');
    try {
      await navigator.credentials.get({ publicKey: {
        challenge: acakByte(32), allowCredentials: [{ type: 'public-key', id: dariB64(id) }], userVerification: 'required', timeout: 60000,
      } });
    } catch (err) { return pesan(err && err.name === 'NotAllowedError' ? 'Sidik jari dibatalkan. Pakai PIN atau coba lagi.' : 'Sidik jari tidak bisa dipakai. Pakai PIN.'); }
    try {
      const d = await kirim({ fn: 'cek', t });
      if (d.ok) { tanda = t; return selesai(); }
      // Tanda kedaluwarsa (30 hari) atau PIN sudah diganti: minta PIN sekali, sidik jari diaktifkan ulang otomatis
      simpan(K_TANDA, null); simpan(K_BIO, null); simpan(K_TOLAK_BIO, null);
      layarPin('Sidik jari perlu diperbarui. Masukkan PIN sekali.');
    } catch (err) { pesan(err.message); }
  }

  document.addEventListener('DOMContentLoaded', () => { document.body.appendChild(layar); layarPin(); });

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
      const d = await kirim({ fn, args: args || [], t: tanda });
      if (d.ok) return d.data;
      if (d.sesi) { tanda = null; layarPin('Sesi berakhir. Buka kunci lagi, lalu ulangi.'); }
      throw new Error(d.error || 'Gagal menghubungi server.');
    },
    kunci() { layarPin(); },
  };
})();
