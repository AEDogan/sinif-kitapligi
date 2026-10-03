const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 8080;
const DB_FILE = path.join(__dirname, 'veritabani.json');
const MAX_BODY_SIZE = 256 * 1024; // 256 KB DoS Koruması

// Brute-force koruması (IP başına başarısız giriş sayacı)
const girisDenemeleri = new Map();
function bruteForceKontrol(ip) {
  const simdi = Date.now();
  const kayit = girisDenemeleri.get(ip);
  if (!kayit) return true;
  if (simdi - kayit.ilkDeneme > 60 * 1000) {
    girisDenemeleri.delete(ip);
    return true;
  }
  return kayit.sayi < 12;
}
function basarisizGirisKaydet(ip) {
  const simdi = Date.now();
  const kayit = girisDenemeleri.get(ip) || { sayi: 0, ilkDeneme: simdi };
  if (simdi - kayit.ilkDeneme > 60 * 1000) {
    kayit.sayi = 1;
    kayit.ilkDeneme = simdi;
  } else {
    kayit.sayi++;
  }
  girisDenemeleri.set(ip, kayit);
}

function bugunTarihFormatli() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function simdiTarihSaatFormatli() {
  const d = new Date();
  return d.toLocaleDateString('tr-TR') + ' ' + d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function benzersizId(onEk) {
  return `${onEk}-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function varsayilanVeritabaniOlustur() {
  return {
    ayarlar: {
      SinifAdi: 'Kitap Kurtları',
      KulupBaraji: 3,
      AdminKullanici: 'admin',
      AdminSifre: 'admin123'
    },
    ogretmenler: [],
    havuz: [],
    ogrenciler: [],
    okunanlar: []
  };
}

function dbOku() {
  if (fs.existsSync(DB_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (parsed && parsed.ayarlar && Array.isArray(parsed.ogrenciler)) {
        if (!Array.isArray(parsed.ogretmenler)) parsed.ogretmenler = [];
        if (!Array.isArray(parsed.havuz)) parsed.havuz = [];
        if (!Array.isArray(parsed.okunanlar)) parsed.okunanlar = [];
        return parsed;
      }
    } catch (e) {
      // bozuk dosya durumunda varsayılana dön
    }
  }
  const ilk = varsayilanVeritabaniOlustur();
  dbKaydet(ilk);
  return ilk;
}

function dbKaydet(db) {
  const tempFile = DB_FILE + '.tmp';
  fs.writeFileSync(tempFile, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tempFile, DB_FILE);
}

// Atomik API İşleyici (Google Apps Script ile birebir aynı iş mantığı ve güvenlik)
function apiIslemCalistir(params, ip) {
  if (!bruteForceKontrol(ip)) {
    return { success: false, message: 'Çok fazla hatalı giriş denemesi yaptınız. Lütfen 1 dakika bekleyin.' };
  }

  const action = String(params.action || '').trim();
  const db = dbOku();
  const bugun = bugunTarihFormatli();

  // Yardımcı doğrulamalar
  const dogrulaAdmin = (k, s) =>
    String(k || '').trim() === String(db.ayarlar.AdminKullanici || 'admin').trim() &&
    String(s || '').trim() === String(db.ayarlar.AdminSifre || 'admin123').trim();

  const dogrulaOgretmen = (pin) => {
    const p = String(pin || '').trim();
    if (!p) return null;
    return db.ogretmenler.find(o => String(o.pin).trim() === p) || null;
  };

  const adminPanelVerisi = () => {
    const sinifOgrSayilari = {};
    const ogrSinifMap = {};
    db.ogrenciler.forEach(o => {
      const s = o.sinif || '3-A Sınıfı';
      ogrSinifMap[o.id] = s;
      sinifOgrSayilari[s] = (sinifOgrSayilari[s] || 0) + 1;
    });

    const sinifOnayli = {};
    const sinifSayfa = {};
    let okulOnayli = 0;
    let okulSayfa = 0;

    db.okunanlar.forEach(k => {
      const s = ogrSinifMap[k.ogrenciId];
      if (!s) return;
      const tSayfa = Math.max(1, Number(k.toplamSayfa) || 1);
      const kSayfa = Math.min(tSayfa, Math.max(0, Number(k.kaldigiSayfa) || 0));
      if (k.durum === 'Onaylandı') {
        sinifOnayli[s] = (sinifOnayli[s] || 0) + 1;
        sinifSayfa[s] = (sinifSayfa[s] || 0) + tSayfa;
        okulOnayli++;
        okulSayfa += tSayfa;
      } else if (k.durum === 'Onay Bekliyor') {
        sinifSayfa[s] = (sinifSayfa[s] || 0) + tSayfa;
        okulSayfa += tSayfa;
      } else if (k.durum === 'Devam Ediyor') {
        sinifSayfa[s] = (sinifSayfa[s] || 0) + kSayfa;
        okulSayfa += kSayfa;
      }
    });

    return {
      success: true,
      ogretmenler: db.ogretmenler.map(ogrt => ({
        ...ogrt,
        ogrenciSayisi: sinifOgrSayilari[ogrt.sinif] || 0,
        onayliKitapSayisi: sinifOnayli[ogrt.sinif] || 0,
        toplamSayfa: sinifSayfa[ogrt.sinif] || 0
      })),
      okulIstatistik: {
        ogretmenSayisi: db.ogretmenler.length,
        ogrenciSayisi: db.ogrenciler.length,
        onayliKitapSayisi: okulOnayli,
        toplamSayfa: okulSayfa,
        kulupBaraji: Number(db.ayarlar.KulupBaraji) || 3
      }
    };
  };

  // 1. ÖĞRENCİ GİRİŞİ
  if (action === 'ogrenciGiris') {
    const pin = String(params.pin || '').trim();
    const ogr = db.ogrenciler.find(o => String(o.pin).trim() === pin);
    if (!ogr) {
      basarisizGirisKaydet(ip);
      return { success: false, message: 'PIN kodu bulunamadı. Lütfen kontrol edip tekrar dene veya öğretmeninden öğren!' };
    }

    const ogrt = db.ogretmenler.find(t => t.id === ogr.ogretmenId || t.sinif === ogr.sinif);
    const ogrSinif = ogr.sinif || (ogrt ? ogrt.sinif : db.ayarlar.SinifAdi);
    const ogretmenAdi = ogrt ? ogrt.adSoyad : '';

    const aktifHavuz = db.havuz.filter(k => {
      const sinifUygun = !k.sinif || k.sinif === 'Ortak' || k.sinif === ogrSinif;
      const tarihUygun = !k.aktifTarih || String(k.aktifTarih).slice(0, 10) <= bugun;
      return sinifUygun && tarihUygun;
    });

    const ogrKayitlar = db.okunanlar.filter(k => k.ogrenciId === ogr.id);
    const devamEdenler = ogrKayitlar.filter(k => k.durum === 'Devam Ediyor');
    const tamamlananlar = ogrKayitlar.filter(k => k.durum === 'Onaylandı' || k.durum === 'Onay Bekliyor');

    const onayliSayi = tamamlananlar.filter(k => k.durum === 'Onaylandı').length;
    let toplamSayfa = 0;
    tamamlananlar.forEach(k => {
      if (k.durum === 'Onaylandı' || k.durum === 'Onay Bekliyor') {
        toplamSayfa += Math.max(1, Number(k.toplamSayfa) || 1);
      }
    });
    devamEdenler.forEach(k => {
      toplamSayfa += Math.max(0, Number(k.kaldigiSayfa) || 0);
    });

    const baraj = Number(db.ayarlar.KulupBaraji) || 3;
    return {
      success: true,
      ogrenci: {
        id: ogr.id,
        adSoyad: ogr.adSoyad,
        numara: ogr.numara,
        sinif: ogrSinif,
        ogretmenAdi: ogretmenAdi,
        avatar: ogr.avatar || '🦊'
      },
      havuz: aktifHavuz,
      istatistik: {
        onaylananKitap: onayliSayi,
        toplamSayfa: toplamSayfa,
        kulupBaraji: baraj,
        kulupteMi: onayliSayi >= baraj,
        sinifAdi: ogrSinif,
        ogretmenAdi: ogretmenAdi
      },
      devamEdenler: devamEdenler,
      tamamlananlar: tamamlananlar
    };
  }

  // 2. ÖĞRENCİ AVATAR GÜNCELLEME
  if (action === 'ogrenciAvatarGuncelle') {
    const pin = String(params.pin || '').trim();
    const izinli = ['🦊', '🐼', '🦁', '🦉', '🦄', '🐸', '🚀', '🐱', '🐰', '🐨'];
    const avatar = izinli.includes(params.avatar) ? params.avatar : '🦊';
    const ogr = db.ogrenciler.find(o => String(o.pin).trim() === pin);
    if (!ogr) return { success: false, message: 'Öğrenci bulunamadı.' };
    ogr.avatar = avatar;
    dbKaydet(db);
    return { success: true, avatar: avatar, message: `Avatarın güncellendi! ${avatar}` };
  }

  // 3. KİTAP İLERLEME KAYDET
  if (action === 'kitapIlerlemeKaydet') {
    const pin = String(params.pin || '').trim();
    const kitapId = String(params.kitapId || '').trim();
    const ogr = db.ogrenciler.find(o => String(o.pin).trim() === pin);
    if (!ogr) return { success: false, message: 'Geçersiz öğrenci PIN kodu!' };

    const ogrSinif = ogr.sinif || db.ayarlar.SinifAdi;
    const havuzKitabi = db.havuz.find(k => {
      if (k.kitapId !== kitapId) return false;
      const sinifUygun = !k.sinif || k.sinif === 'Ortak' || k.sinif === ogrSinif;
      const tarihUygun = !k.aktifTarih || String(k.aktifTarih).slice(0, 10) <= bugun;
      return sinifUygun && tarihUygun;
    });

    if (!havuzKitabi) {
      return { success: false, message: 'Bu kitap henüz aktif değil veya sınıfınıza ait değil!' };
    }

    const toplamSayfa = Math.max(1, Number(havuzKitabi.sayfaSayisi) || 1);
    let kaldigiSayfa = Math.max(1, Number(params.kaldigiSayfa) || 1);
    if (kaldigiSayfa > toplamSayfa) kaldigiSayfa = toplamSayfa;

    const bitirildiMi = Boolean(params.bitirildiMi) || (kaldigiSayfa >= toplamSayfa);
    if (bitirildiMi) kaldigiSayfa = toplamSayfa;

    const yildiz = Math.min(5, Math.max(1, Number(params.yildiz) || 5));
    const yorum = String(params.yorum || '').trim().slice(0, 500);
    const yeniDurum = bitirildiMi ? 'Onay Bekliyor' : 'Devam Ediyor';
    const tarihStr = simdiTarihSaatFormatli();

    const mevcut = db.okunanlar.find(k => k.ogrenciId === ogr.id && k.kitapId === kitapId && k.durum !== 'Onaylandı');
    if (mevcut) {
      mevcut.toplamSayfa = toplamSayfa;
      mevcut.kaldigiSayfa = kaldigiSayfa;
      mevcut.durum = yeniDurum;
      mevcut.yildiz = yildiz;
      if (yorum) mevcut.yorum = yorum;
      mevcut.tarih = tarihStr;
      if (bitirildiMi) mevcut.ogretmenNotu = '';
    } else {
      db.okunanlar.unshift({
        islemId: benzersizId('ISLEM'),
        ogrenciId: ogr.id,
        kitapId: kitapId,
        kitapAdi: havuzKitabi.kitapAdi,
        yazar: havuzKitabi.yazar,
        toplamSayfa: toplamSayfa,
        kaldigiSayfa: kaldigiSayfa,
        yildiz: yildiz,
        yorum: yorum,
        tarih: tarihStr,
        durum: yeniDurum,
        ogretmenNotu: ''
      });
    }

    dbKaydet(db);
    const msg = bitirildiMi
      ? `Tebrikler! "${havuzKitabi.kitapAdi}" bitti ve öğretmenin onayına gönderildi! 🎉`
      : `"${havuzKitabi.kitapAdi}" ${kaldigiSayfa}. sayfaya kadar kaydedildi! 📖`;
    return { success: true, message: msg, bitirildiMi: bitirildiMi };
  }

  // 4. ÖĞRENCİ YANLIŞLIKLA "BİTİRDİM" DEDİYSE GERİ AL
  if (action === 'ogrenciKitapGeriAl') {
    const pin = String(params.pin || '').trim();
    const kitapId = String(params.kitapId || '').trim();
    const ogr = db.ogrenciler.find(o => String(o.pin).trim() === pin);
    if (!ogr) return { success: false, message: 'Öğrenci doğrulanamadı.' };

    const kayit = db.okunanlar.find(k => k.ogrenciId === ogr.id && k.kitapId === kitapId && k.durum === 'Onay Bekliyor');
    if (!kayit) return { success: false, message: 'Geri alınacak onay bekleyen kitap bulunamadı.' };

    kayit.durum = 'Devam Ediyor';
    kayit.kaldigiSayfa = Math.max(1, (Number(kayit.toplamSayfa) || 10) - 1);
    dbKaydet(db);
    return { success: true, message: 'Kitap tekrar "Şu An Okuduğum Kitaplar" listene alındı! 📖' };
  }

  // 5. ÖĞRETMEN GİRİŞİ
  if (action === 'ogretmenGiris') {
    const ogrt = dogrulaOgretmen(params.pin);
    if (!ogrt) {
      basarisizGirisKaydet(ip);
      return { success: false, message: 'Hatalı Öğretmen PIN kodu!' };
    }

    const sinifOgrencileri = db.ogrenciler.filter(o => !o.sinif || o.sinif === ogrt.sinif || o.ogretmenId === ogrt.id);
    const ogrMap = {};
    sinifOgrencileri.forEach(o => { ogrMap[o.id] = o; });

    const bekleyenler = [];
    const devamEdenler = [];
    const onaylananlar = [];

    db.okunanlar.forEach(k => {
      const ogr = ogrMap[k.ogrenciId];
      if (!ogr) return;
      const item = { ...k, ogrenciAdi: ogr.adSoyad };
      if (k.durum === 'Onay Bekliyor') bekleyenler.push(item);
      else if (k.durum === 'Devam Ediyor') devamEdenler.push(item);
      else if (k.durum === 'Onaylandı') onaylananlar.push(item);
    });

    const ogrenciler = sinifOgrencileri.map(ogr => {
      const kList = db.okunanlar.filter(k => k.ogrenciId === ogr.id);
      let toplamSayfa = 0;
      kList.forEach(k => {
        if (k.durum === 'Onaylandı' || k.durum === 'Onay Bekliyor') toplamSayfa += Math.max(1, Number(k.toplamSayfa) || 1);
        else if (k.durum === 'Devam Ediyor') toplamSayfa += Math.max(0, Number(k.kaldigiSayfa) || 0);
      });
      return {
        ...ogr,
        sinif: ogr.sinif || ogrt.sinif,
        okunanKitap: kList.filter(k => k.durum === 'Onaylandı').length,
        toplamSayfa: toplamSayfa
      };
    });

    const sinifHavuzu = db.havuz.filter(k => !k.sinif || k.sinif === 'Ortak' || k.sinif === ogrt.sinif);

    return {
      success: true,
      ogretmen: ogrt,
      bekleyenler: bekleyenler,
      devamEdenler: devamEdenler,
      onaylananlar: onaylananlar,
      ogrenciler: ogrenciler,
      havuz: sinifHavuzu,
      ayarlar: { ...db.ayarlar, SinifAdi: ogrt.sinif }
    };
  }

  // 6. KİTAP ONAYLA / İADE ET / ONAY GERİ AL / SİL (BOLA Korumalı)
  if (['kitapOnayla', 'kitapIadeEt', 'kitapOnayGeriAl', 'kitapSil'].includes(action)) {
    const ogrt = dogrulaOgretmen(params.pin);
    if (!ogrt) return { success: false, message: 'Yetkisiz işlem!' };

    const kayit = db.okunanlar.find(k => k.islemId === params.islemId);
    if (!kayit) return { success: false, message: 'Kayıt bulunamadı.' };

    const ogr = db.ogrenciler.find(o => o.id === kayit.ogrenciId);
    if (!ogr || (ogr.sinif && ogr.sinif !== ogrt.sinif && ogr.ogretmenId !== ogrt.id)) {
      return { success: false, message: 'Bu kayıt sizin sınıfınızdaki bir öğrenciye ait değil!' };
    }

    if (action === 'kitapOnayla') {
      kayit.durum = 'Onaylandı';
      kayit.ogretmenNotu = '';
      dbKaydet(db);
      return { success: true, message: 'Kitap onaylandı! ⭐' };
    }
    if (action === 'kitapIadeEt') {
      kayit.durum = 'Devam Ediyor';
      kayit.ogretmenNotu = String(params.ogretmenNotu || 'Öğretmenin bu kitabı biraz daha gözden geçirmeni istiyor.').trim().slice(0, 300);
      dbKaydet(db);
      return { success: true, message: 'Kitap öğrenciye notunuzla birlikte iade edildi. 🔄' };
    }
    if (action === 'kitapOnayGeriAl') {
      kayit.durum = 'Onay Bekliyor';
      dbKaydet(db);
      return { success: true, message: 'Onay geri alındı ve Onay Bekleyenler listesine taşındı.' };
    }
    if (action === 'kitapSil') {
      db.okunanlar = db.okunanlar.filter(k => k.islemId !== params.islemId);
      dbKaydet(db);
      return { success: true, message: 'Kayıt tamamen silindi.' };
    }
  }

  // 7. HAVUZA KİTAP EKLE / GÜNCELLE / SİL
  if (action === 'havuzaKitapEkle') {
    const ogrt = dogrulaOgretmen(params.pin);
    if (!ogrt) return { success: false, message: 'Yetkisiz işlem!' };

    const ad = String(params.kitapAdi || '').trim();
    const yazar = String(params.yazar || '').trim();
    const sayfa = Math.max(1, Number(params.sayfaSayisi) || 1);
    const tur = String(params.tur || 'Genel').trim();
    const aktifTarih = params.aktifTarih ? String(params.aktifTarih).slice(0, 10) : bugun;

    if (!ad || !yazar) return { success: false, message: 'Kitap adı ve yazar zorunludur.' };

    db.havuz.push({
      kitapId: benzersizId('HAVUZ'),
      kitapAdi: ad,
      yazar: yazar,
      sayfaSayisi: sayfa,
      tur: tur,
      sinif: ogrt.sinif,
      aktifTarih: aktifTarih
    });
    dbKaydet(db);
    return {
      success: true,
      message: aktifTarih > bugun
        ? `"${ad}" eklendi! Öğrencilerinize ${aktifTarih} tarihinde açılacak. 📅`
        : `"${ad}" kütüphaneye eklendi ve şu an aktif! ✨`
    };
  }

  if (action === 'havuzKitapGuncelle') {
    const ogrt = dogrulaOgretmen(params.pin);
    if (!ogrt) return { success: false, message: 'Yetkisiz işlem!' };

    const kitap = db.havuz.find(k => k.kitapId === params.kitapId);
    if (!kitap) return { success: false, message: 'Kitap bulunamadı.' };
    if (kitap.sinif && kitap.sinif !== 'Ortak' && kitap.sinif !== ogrt.sinif) {
      return { success: false, message: 'Başka sınıfa ait kitabı düzenleyemezsiniz.' };
    }

    kitap.kitapAdi = String(params.kitapAdi || kitap.kitapAdi).trim();
    kitap.yazar = String(params.yazar || kitap.yazar).trim();
    kitap.sayfaSayisi = Math.max(1, Number(params.sayfaSayisi) || kitap.sayfaSayisi);
    kitap.tur = String(params.tur || kitap.tur).trim();
    kitap.aktifTarih = params.aktifTarih ? String(params.aktifTarih).slice(0, 10) : bugun;

    // Okunanlardaki kitap adı/sayfa bilgisini de senkronize et
    db.okunanlar.forEach(ok => {
      if (ok.kitapId === kitap.kitapId) {
        ok.kitapAdi = kitap.kitapAdi;
        ok.yazar = kitap.yazar;
        ok.toplamSayfa = kitap.sayfaSayisi;
      }
    });

    dbKaydet(db);
    return { success: true, message: `"${kitap.kitapAdi}" bilgileri güncellendi.` };
  }

  if (action === 'havuzdanKitapSil') {
    const ogrt = dogrulaOgretmen(params.pin);
    if (!ogrt) return { success: false, message: 'Yetkisiz işlem!' };

    const kitap = db.havuz.find(k => k.kitapId === params.kitapId);
    if (!kitap) return { success: false, message: 'Kitap bulunamadı.' };
    if (kitap.sinif && kitap.sinif !== 'Ortak' && kitap.sinif !== ogrt.sinif) {
      return { success: false, message: 'Başka sınıfa ait kitabı silemezsiniz.' };
    }

    db.havuz = db.havuz.filter(k => k.kitapId !== params.kitapId);
    dbKaydet(db);
    return { success: true, message: 'Kitap kütüphaneden kaldırıldı.' };
  }

  // 8. ÖĞRENCİ EKLE / TOPLU EKLE / GÜNCELLE / SİL (PIN Benzersizlik Kontrollü)
  if (action === 'ogrenciEkle') {
    const ogrt = dogrulaOgretmen(params.pin);
    if (!ogrt) return { success: false, message: 'Yetkisiz işlem!' };

    const ad = String(params.adSoyad || '').trim();
    const no = String(params.numara || '').trim();
    if (!ad) return { success: false, message: 'Öğrenci adı zorunludur.' };

    const mevcutPinler = new Set(db.ogrenciler.map(o => String(o.pin).trim()));
    let ogrPin = String(params.ogrenciPin || '').trim();

    if (ogrPin) {
      if (mevcutPinler.has(ogrPin)) {
        return { success: false, message: `Bu PIN kodu (${ogrPin}) başka bir öğrencide zaten kullanılıyor! Lütfen farklı bir PIN girin veya boş bırakın.` };
      }
    } else {
      for (let i = 0; i < 1000; i++) {
        const aday = Math.floor(100000 + Math.random() * 900000).toString();
        if (!mevcutPinler.has(aday)) {
          ogrPin = aday;
          break;
        }
      }
    }

    db.ogrenciler.push({
      id: benzersizId('OGR'),
      adSoyad: ad,
      numara: no,
      pin: ogrPin,
      sinif: ogrt.sinif,
      ogretmenId: ogrt.id,
      avatar: '🦊'
    });
    dbKaydet(db);
    return { success: true, message: `${ad} (${ogrt.sinif}) eklendi! PIN: ${ogrPin}`, pin: ogrPin };
  }

  if (action === 'ogrenciTopluEkle') {
    const ogrt = dogrulaOgretmen(params.pin);
    if (!ogrt) return { success: false, message: 'Yetkisiz işlem!' };

    const liste = Array.isArray(params.ogrenciler) ? params.ogrenciler : [];
    if (liste.length === 0) return { success: false, message: 'Eklenecek öğrenci bulunamadı.' };

    const mevcutPinler = new Set(db.ogrenciler.map(o => String(o.pin).trim()));
    let eklenen = 0;

    liste.forEach((item, idx) => {
      const ad = String(item.adSoyad || '').trim();
      const no = String(item.numara || '').trim();
      if (!ad) return;

      let ogrPin = '';
      for (let i = 0; i < 1000; i++) {
        const aday = Math.floor(100000 + Math.random() * 900000).toString();
        if (!mevcutPinler.has(aday)) {
          ogrPin = aday;
          mevcutPinler.add(aday);
          break;
        }
      }

      db.ogrenciler.push({
        id: `${benzersizId('OGR')}-${idx}`,
        adSoyad: ad,
        numara: no,
        pin: ogrPin,
        sinif: ogrt.sinif,
        ogretmenId: ogrt.id,
        avatar: '🦊'
      });
      eklenen++;
    });

    dbKaydet(db);
    return { success: true, message: `${eklenen} öğrenci benzersiz PIN kodlarıyla sınıfınıza eklendi! 🎉` };
  }

  if (action === 'ogrenciGuncelle') {
    const ogrt = dogrulaOgretmen(params.pin);
    if (!ogrt) return { success: false, message: 'Yetkisiz işlem!' };

    const ogr = db.ogrenciler.find(o => o.id === params.ogrenciId);
    if (!ogr) return { success: false, message: 'Öğrenci bulunamadı.' };
    if (ogr.sinif && ogr.sinif !== ogrt.sinif && ogr.ogretmenId !== ogrt.id) {
      return { success: false, message: 'Bu öğrenci sizin sınıfınıza ait değil!' };
    }

    const yeniPin = String(params.ogrenciPin || ogr.pin).trim();
    const cakisma = db.ogrenciler.some(o => o.id !== ogr.id && String(o.pin).trim() === yeniPin);
    if (cakisma) {
      return { success: false, message: `Bu PIN kodu (${yeniPin}) başka bir öğrencide kullanılıyor!` };
    }

    ogr.adSoyad = String(params.adSoyad || ogr.adSoyad).trim();
    ogr.numara = String(params.numara || '').trim();
    ogr.pin = yeniPin;
    dbKaydet(db);
    return { success: true, message: `${ogr.adSoyad} bilgileri güncellendi.` };
  }

  if (action === 'ogrenciSil') {
    const ogrt = dogrulaOgretmen(params.pin);
    if (!ogrt) return { success: false, message: 'Yetkisiz işlem!' };

    const ogr = db.ogrenciler.find(o => o.id === params.ogrenciId);
    if (!ogr) return { success: false, message: 'Öğrenci bulunamadı.' };
    if (ogr.sinif && ogr.sinif !== ogrt.sinif && ogr.ogretmenId !== ogrt.id) {
      return { success: false, message: 'Bu öğrenci sizin sınıfınıza ait değil!' };
    }

    db.ogrenciler = db.ogrenciler.filter(o => o.id !== params.ogrenciId);
    db.okunanlar = db.okunanlar.filter(k => k.ogrenciId !== params.ogrenciId);
    dbKaydet(db);
    return { success: true, message: 'Öğrenci ve okuma kayıtları silindi.' };
  }

  // 9. ADMİN İŞLEMLERİ
  if (action === 'adminGiris') {
    const k = params.kullaniciAdi || params.adminKullanici;
    const s = params.sifre || params.adminSifre;
    if (!dogrulaAdmin(k, s)) {
      basarisizGirisKaydet(ip);
      return { success: false, message: 'Hatalı Admin kullanıcı adı veya şifresi!' };
    }
    return adminPanelVerisi();
  }

  if (action === 'ogretmenEkle') {
    if (!dogrulaAdmin(params.adminKullanici, params.adminSifre)) {
      return { success: false, message: 'Yetkisiz işlem!' };
    }
    const adSoyad = String(params.adSoyad || '').trim();
    const sinif = String(params.sinif || '').trim();
    const pin = String(params.pin || '').trim();
    if (!adSoyad || !sinif || !pin) return { success: false, message: 'Tüm alanları doldurun.' };

    if (db.ogretmenler.some(o => String(o.pin).trim() === pin)) {
      return { success: false, message: 'Bu PIN kodu başka bir öğretmende tanımlı!' };
    }

    db.ogretmenler.push({
      id: benzersizId('OGRT'),
      adSoyad: adSoyad,
      sinif: sinif,
      pin: pin
    });
    dbKaydet(db);
    return {
      ...adminPanelVerisi(),
      message: `${adSoyad} (${sinif}) tanımlandı!`
    };
  }

  if (action === 'ogretmenGuncelle') {
    if (!dogrulaAdmin(params.adminKullanici, params.adminSifre)) {
      return { success: false, message: 'Yetkisiz işlem!' };
    }
    const ogrt = db.ogretmenler.find(o => o.id === params.ogretmenId);
    if (!ogrt) return { success: false, message: 'Öğretmen bulunamadı.' };

    const yeniPin = String(params.pin || ogrt.pin).trim();
    if (db.ogretmenler.some(o => o.id !== ogrt.id && String(o.pin).trim() === yeniPin)) {
      return { success: false, message: 'Bu PIN kodu başka bir öğretmende kullanılıyor!' };
    }

    const eskiSinif = ogrt.sinif;
    const yeniSinif = String(params.sinif || ogrt.sinif).trim();
    ogrt.adSoyad = String(params.adSoyad || ogrt.adSoyad).trim();
    ogrt.sinif = yeniSinif;
    ogrt.pin = yeniPin;

    // Sınıf adı değiştiyse öğrencileri ve kitapları da taşı (Yetim veri oluşmasın)
    if (eskiSinif && eskiSinif !== yeniSinif) {
      db.ogrenciler.forEach(o => {
        if (o.ogretmenId === ogrt.id || o.sinif === eskiSinif) o.sinif = yeniSinif;
      });
      db.havuz.forEach(k => {
        if (k.sinif === eskiSinif) k.sinif = yeniSinif;
      });
    }

    dbKaydet(db);
    return {
      ...adminPanelVerisi(),
      message: `${ogrt.adSoyad} bilgileri ve bağlı sınıf kayıtları güncellendi.`
    };
  }

  if (action === 'ogretmenSil') {
    if (!dogrulaAdmin(params.adminKullanici, params.adminSifre)) {
      return { success: false, message: 'Yetkisiz işlem!' };
    }
    db.ogretmenler = db.ogretmenler.filter(o => o.id !== params.ogretmenId);
    dbKaydet(db);
    return {
      ...adminPanelVerisi(),
      message: 'Öğretmen kaydı silindi.'
    };
  }

  if (action === 'adminAyarGuncelle') {
    if (!dogrulaAdmin(params.adminKullanici, params.adminSifre)) {
      return { success: false, message: 'Mevcut Admin şifresi doğrulanamadı!' };
    }
    const yeniKullanici = String(params.yeniAdminKullanici || db.ayarlar.AdminKullanici).trim();
    const yeniSifre = String(params.yeniAdminSifre || db.ayarlar.AdminSifre).trim();
    const yeniBaraj = Math.max(1, Number(params.kulupBaraji) || 3);

    if (!yeniKullanici || yeniSifre.length < 4) {
      return { success: false, message: 'Kullanıcı adı boş olamaz ve şifre en az 4 karakter olmalıdır.' };
    }

    db.ayarlar.AdminKullanici = yeniKullanici;
    db.ayarlar.AdminSifre = yeniSifre;
    db.ayarlar.KulupBaraji = yeniBaraj;
    dbKaydet(db);
    return {
      ...adminPanelVerisi(),
      message: 'Okul ayarları ve Admin bilgileri güncellendi! ✅',
      yeniAdmin: { kullaniciAdi: yeniKullanici, sifre: yeniSifre }
    };
  }

  if (action === 'demoSifirla') {
    if (!dogrulaAdmin(params.adminKullanici, params.adminSifre)) {
      return { success: false, message: 'Sadece Admin veritabanını sıfırlayabilir!' };
    }
    const sifir = varsayilanVeritabaniOlustur();
    dbKaydet(sifir);
    return {
      ...adminPanelVerisi(),
      message: 'Veritabanı varsayılan başlangıç verilerine sıfırlandı.'
    };
  }

  return { success: false, message: 'Geçersiz işlem isteği.' };
}

// Sadece izin verilen güvenli ön yüz dosyaları sunulabilir (Kaynak kodu ve veritabanı gizlidir)
const IZINLI_DOSYALAR = new Set(['/index.html', '/KURULUM_REHBERI.md']);

const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  const ip = req.socket.remoteAddress || 'unknown';
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  if (pathname === '/api') {
    if (req.method === 'GET') {
      const params = Object.fromEntries(parsedUrl.searchParams.entries());
      const sonuc = apiIslemCalistir(params, ip);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(sonuc));
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      let boyutAsildi = false;

      req.on('data', chunk => {
        body += chunk.toString();
        if (body.length > MAX_BODY_SIZE) {
          boyutAsildi = true;
          req.destroy();
        }
      });

      req.on('end', () => {
        if (boyutAsildi) return;
        try {
          const params = JSON.parse(body || '{}');
          const sonuc = apiIslemCalistir(params, ip);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(sonuc));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, message: 'Geçersiz JSON verisi.' }));
        }
      });
      return;
    }
  }

  // Statik dosya kontrolü (Beyaz liste + Path Traversal koruması)
  const hedef = pathname === '/' ? '/index.html' : pathname;
  if (!IZINLI_DOSYALAR.has(hedef)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Erişim engellendi.');
    return;
  }

  const cozulmusYol = path.resolve(__dirname, '.' + hedef);
  const goreceli = path.relative(__dirname, cozulmusYol);
  if (goreceli.startsWith('..') || path.isAbsolute(goreceli)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Erişim engellendi.');
    return;
  }

  fs.readFile(cozulmusYol, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Sayfa bulunamadı');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache'
    });
    res.end(content);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  console.log('====================================================');
  console.log('🛡️ Sınıf Kitaplığı Güvenli Wi-Fi Sunucusu (v4)');
  console.log(`💻 Bu Bilgisayardan: http://localhost:${PORT}`);
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`📱 Evdeki Wi-Fi Ağı (Telefon/Tablet/PC): http://${net.address}:${PORT}`);
      }
    }
  }
  console.log('====================================================');
});
