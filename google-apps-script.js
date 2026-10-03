/**
 * ============================================================================
 * 3. SINIF "KİTAP KURTLARI" DİJİTAL KÜTÜPHANE & SAYFA TAKİP SİSTEMİ
 * Google Apps Script (Backend API - Güvenlik & Çoklu Rol Sürümü v4)
 * ============================================================================
 */

const TABLO_ISIMLERI = {
  OGRETMENLER: "Ogretmenler",
  KITAP_HAVUZU: "KitapHavuzu",
  OGRENCILER: "Ogrenciler",
  OKUNAN_KITAPLAR: "OkunanKitaplar",
  AYARLAR: "Ayarlar"
};

/**
 * Google Sheets Formula Injection (CSV Injection) koruması.
 * =, +, -, @, sekme veya satır başı ile başlayan metinlerin başına ' ekler.
 */
function guvenliHucreDegeri(deger) {
  if (deger === null || deger === undefined) return "";
  if (typeof deger === "number" || typeof deger === "boolean") return deger;
  const str = String(deger).trim();
  if (/^[=+\-@\t\r]/.test(str)) {
    return "'" + str;
  }
  return str;
}

function bugunTarihStr() {
  return Utilities.formatDate(new Date(), "GMT+3", "yyyy-MM-dd");
}

function simdiTarihSaatStr() {
  return Utilities.formatDate(new Date(), "GMT+3", "yyyy-MM-dd HH:mm");
}

function benzersizIdUret(onEk) {
  const rastgele = Math.floor(1000 + Math.random() * 9000);
  return onEk + "-" + new Date().getTime().toString().slice(-6) + "-" + rastgele;
}

/**
 * 1. İLK KURULUM FONKSİYONU
 */
function ilkKurulum() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 0. Ogretmenler Sayfası
  let ogrtSayfa = ss.getSheetByName(TABLO_ISIMLERI.OGRETMENLER);
  if (!ogrtSayfa) {
    ogrtSayfa = ss.insertSheet(TABLO_ISIMLERI.OGRETMENLER);
    ogrtSayfa.appendRow(["OgretmenId", "AdSoyad", "Sinif", "Pin", "Durum"]);
    ogrtSayfa.getRange("A1:E1").setFontWeight("bold").setBackground("#e0e7ff");
  }

  // 1. KitapHavuzu Sayfası
  let havuzSayfa = ss.getSheetByName(TABLO_ISIMLERI.KITAP_HAVUZU);
  if (!havuzSayfa) {
    havuzSayfa = ss.insertSheet(TABLO_ISIMLERI.KITAP_HAVUZU);
    havuzSayfa.appendRow(["KitapId", "KitapAdi", "Yazar", "SayfaSayisi", "Tur", "Durum", "Sinif", "AktifTarih"]);
    havuzSayfa.getRange("A1:H1").setFontWeight("bold").setBackground("#fde68a");
  }

  // 2. Ogrenciler Sayfası
  let ogrSayfa = ss.getSheetByName(TABLO_ISIMLERI.OGRENCILER);
  if (!ogrSayfa) {
    ogrSayfa = ss.insertSheet(TABLO_ISIMLERI.OGRENCILER);
    ogrSayfa.appendRow(["OgrenciId", "AdSoyad", "SinifNo", "PinKodu", "AktifMi", "Sinif", "OgretmenId", "Avatar"]);
    ogrSayfa.getRange("A1:H1").setFontWeight("bold").setBackground("#fef08a");
  }

  // 3. OkunanKitaplar Sayfası (11. Sütun: OgretmenNotu)
  let okunanSayfa = ss.getSheetByName(TABLO_ISIMLERI.OKUNAN_KITAPLAR);
  if (!okunanSayfa) {
    okunanSayfa = ss.insertSheet(TABLO_ISIMLERI.OKUNAN_KITAPLAR);
    okunanSayfa.appendRow([
      "IslemId", "OgrenciId", "KitapId", "KitapAdi", "Yazar",
      "ToplamSayfa", "KaldigiSayfa", "Yildiz", "KisaYorum", "Tarih", "Durum", "OgretmenNotu"
    ]);
    okunanSayfa.getRange("A1:L1").setFontWeight("bold").setBackground("#bbf7d0");
  }

  // 4. Ayarlar Sayfası
  let ayarSayfa = ss.getSheetByName(TABLO_ISIMLERI.AYARLAR);
  if (!ayarSayfa) {
    ayarSayfa = ss.insertSheet(TABLO_ISIMLERI.AYARLAR);
    ayarSayfa.appendRow(["AyarAdi", "Deger", "Aciklama"]);
    ayarSayfa.getRange("A1:C1").setFontWeight("bold").setBackground("#bfdbfe");

    ayarSayfa.appendRow(["AdminKullanici", "admin", "Sistem yöneticisi (Admin) kullanıcı adı"]);
    ayarSayfa.appendRow(["AdminSifre", "admin123", "Sistem yöneticisi (Admin) giriş şifresi"]);
    ayarSayfa.appendRow(["KulupBaraji", "3", "Kitap Kurdu hedefi için gereken onaylı kitap sayısı"]);
    ayarSayfa.appendRow(["SinifAdi", "3-A Sınıfı", "Varsayılan Sınıf Adı"]);
  }
}

/**
 * 2. GET İSTEKLERİ (Salt Okunur Sorgular)
 */
function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  return istekYonlendir(params, false);
}

/**
 * 3. POST İSTEKLERİ (Veri Yazma & Güvenli Giriş İşlemleri)
 */
function doPost(e) {
  let params = {};
  if (e && e.postData && e.postData.contents) {
    try {
      params = JSON.parse(e.postData.contents);
    } catch (err) {
      return jsonYanit({ success: false, message: "Geçersiz veri formatı." });
    }
  }
  return istekYonlendir(params, true);
}

function istekYonlendir(params, isPost) {
  const action = String(params.action || "").trim();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Tablolar henüz oluşturulmamışsa otomatik olarak ilk kurulumu çalıştır
  if (!ss.getSheetByName(TABLO_ISIMLERI.AYARLAR) || !ss.getSheetByName(TABLO_ISIMLERI.OGRETMENLER)) {
    ilkKurulum();
  }

  // Yazma işlemlerinde LockService zorunlu kontrolü
  const okumaIslemleri = ["ogrenciGiris", "ogretmenGiris", "adminGiris"];
  let lock = null;
  if (okumaIslemleri.indexOf(action) === -1) {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) {
      return jsonYanit({ success: false, message: "Sistem şu an başka bir işlemi kaydediyor, lütfen birkaç saniye sonra tekrar deneyin." });
    }
  }

  try {
    if (action === "ogrenciGiris") {
      return jsonYanit(ogrenciGiris(ss, params.pin));
    }
    if (action === "ogretmenGiris") {
      return jsonYanit(ogretmenGiris(ss, params.pin));
    }
    if (action === "adminGiris") {
      return jsonYanit(adminGiris(ss, params.kullaniciAdi || params.adminKullanici, params.sifre || params.adminSifre));
    }
    if (action === "kitapIlerlemeKaydet") {
      return jsonYanit(kitapIlerlemeKaydet(ss, params));
    }
    if (action === "ogrenciKitapGeriAl") {
      return jsonYanit(ogrenciKitapGeriAl(ss, params));
    }
    if (action === "ogrenciAvatarGuncelle") {
      return jsonYanit(ogrenciAvatarGuncelle(ss, params));
    }
    if (action === "kitapOnayla") {
      return jsonYanit(kitapOnayla(ss, params));
    }
    if (action === "kitapIadeEt") {
      return jsonYanit(kitapIadeEt(ss, params));
    }
    if (action === "kitapOnayGeriAl") {
      return jsonYanit(kitapOnayGeriAl(ss, params));
    }
    if (action === "kitapSil") {
      return jsonYanit(kitapSil(ss, params));
    }
    if (action === "havuzaKitapEkle") {
      return jsonYanit(havuzaKitapEkle(ss, params));
    }
    if (action === "havuzTopluKitapEkle") {
      return jsonYanit(havuzTopluKitapEkle(ss, params));
    }
    if (action === "havuzKitapGuncelle") {
      return jsonYanit(havuzKitapGuncelle(ss, params));
    }
    if (action === "havuzdanKitapSil") {
      return jsonYanit(havuzdanKitapSil(ss, params));
    }
    if (action === "ogrenciEkle") {
      return jsonYanit(ogrenciEkle(ss, params));
    }
    if (action === "ogrenciTopluEkle") {
      return jsonYanit(ogrenciTopluEkle(ss, params));
    }
    if (action === "ogrenciGuncelle") {
      return jsonYanit(ogrenciGuncelle(ss, params));
    }
    if (action === "ogrenciSil") {
      return jsonYanit(ogrenciSil(ss, params));
    }
    if (action === "ogretmenEkle") {
      return jsonYanit(ogretmenEkle(ss, params));
    }
    if (action === "ogretmenGuncelle") {
      return jsonYanit(ogretmenGuncelle(ss, params));
    }
    if (action === "ogretmenSil") {
      return jsonYanit(ogretmenSil(ss, params));
    }
    if (action === "adminAyarGuncelle") {
      return jsonYanit(adminAyarGuncelle(ss, params));
    }
    if (action === "demoSifirla") {
      if (!dogrulaAdmin(ss, params.adminKullanici, params.adminSifre)) {
        return jsonYanit({ success: false, message: "Sadece Admin veritabanını sıfırlayabilir!" });
      }
      [TABLO_ISIMLERI.OGRETMENLER, TABLO_ISIMLERI.KITAP_HAVUZU, TABLO_ISIMLERI.OGRENCILER, TABLO_ISIMLERI.OKUNAN_KITAPLAR].forEach(ad => {
        const s = ss.getSheetByName(ad);
        if (s && s.getLastRow() > 1) {
          s.deleteRows(2, s.getLastRow() - 1);
        }
      });
      const yanit = adminPanelVerisiOlustur(ss);
      yanit.message = "Tüm Google Sheets kayıtları temizlendi.";
      return jsonYanit(yanit);
    }

    return jsonYanit({ success: false, message: "Geçersiz işlem isteği." });
  } catch (err) {
    console.error(err);
    return jsonYanit({ success: false, message: "İşlem sırasında beklenmeyen bir hata oluştu." });
  } finally {
    if (lock) {
      lock.releaseLock();
    }
  }
}

// ============================================================================
// ADMİN İŞLEMLERİ (ÖĞRETMEN, SINIF, İSTATİSTİK VE AYAR YÖNETİMİ)
// ============================================================================

function dogrulaAdmin(ss, kullaniciAdi, sifre) {
  const ayarlar = getAyarlar(ss);
  const beklenenKullanici = String(ayarlar.AdminKullanici || "admin").trim();
  const beklenenSifre = String(ayarlar.AdminSifre || "admin123").trim();
  return String(kullaniciAdi || "").trim() === beklenenKullanici && String(sifre || "").trim() === beklenenSifre;
}

function adminGiris(ss, kullaniciAdi, sifre) {
  if (!dogrulaAdmin(ss, kullaniciAdi, sifre)) {
    return { success: false, message: "Hatalı Admin kullanıcı adı veya şifresi!" };
  }
  return adminPanelVerisiOlustur(ss);
}

function adminPanelVerisiOlustur(ss) {
  const ayarlar = getAyarlar(ss);
  const ogretmenler = getOgretmenlerListesi(ss);
  const ogrSayfa = ss.getSheetByName(TABLO_ISIMLERI.OGRENCILER);
  const okunanSayfa = ss.getSheetByName(TABLO_ISIMLERI.OKUNAN_KITAPLAR);

  const ogrData = ogrSayfa ? ogrSayfa.getDataRange().getValues() : [];
  const okunanData = okunanSayfa ? okunanSayfa.getDataRange().getValues() : [];

  const ogrSinifHaritasi = {};
  const sinifOgrSayilari = {};
  let toplamAktifOgrenci = 0;

  for (let i = 1; i < ogrData.length; i++) {
    if (String(ogrData[i][4]).toLowerCase() === "hayır") continue;
    const ogrId = String(ogrData[i][0]);
    const sinif = String(ogrData[i][5] || "").trim();
    ogrSinifHaritasi[ogrId] = sinif;
    sinifOgrSayilari[sinif] = (sinifOgrSayilari[sinif] || 0) + 1;
    toplamAktifOgrenci++;
  }

  const sinifOnayliKitap = {};
  const sinifToplamSayfa = {};
  let okulOnayliKitap = 0;
  let okulToplamSayfa = 0;

  for (let i = 1; i < okunanData.length; i++) {
    const ogrId = String(okunanData[i][1]);
    const sinif = ogrSinifHaritasi[ogrId];
    if (!sinif) continue;
    const durum = String(okunanData[i][10]);
    const tSayfa = Number(okunanData[i][5]) || 0;
    const kSayfa = Number(okunanData[i][6]) || 0;

    if (durum === "Onaylandı") {
      sinifOnayliKitap[sinif] = (sinifOnayliKitap[sinif] || 0) + 1;
      sinifToplamSayfa[sinif] = (sinifToplamSayfa[sinif] || 0) + tSayfa;
      okulOnayliKitap++;
      okulToplamSayfa += tSayfa;
    } else if (durum === "Onay Bekliyor") {
      sinifToplamSayfa[sinif] = (sinifToplamSayfa[sinif] || 0) + tSayfa;
      okulToplamSayfa += tSayfa;
    } else if (durum === "Devam Ediyor") {
      sinifToplamSayfa[sinif] = (sinifToplamSayfa[sinif] || 0) + kSayfa;
      okulToplamSayfa += kSayfa;
    }
  }

  const zenginOgretmenler = ogretmenler.map(ogrt => ({
    ...ogrt,
    ogrenciSayisi: sinifOgrSayilari[ogrt.sinif] || 0,
    onayliKitapSayisi: sinifOnayliKitap[ogrt.sinif] || 0,
    toplamSayfa: sinifToplamSayfa[ogrt.sinif] || 0
  }));

  return {
    success: true,
    ogretmenler: zenginOgretmenler,
    okulIstatistik: {
      ogretmenSayisi: ogretmenler.length,
      ogrenciSayisi: toplamAktifOgrenci,
      onayliKitapSayisi: okulOnayliKitap,
      toplamSayfa: okulToplamSayfa,
      kulupBaraji: Number(ayarlar.KulupBaraji) || 3
    }
  };
}

function ogretmenEkle(ss, params) {
  if (!dogrulaAdmin(ss, params.adminKullanici, params.adminSifre)) {
    return { success: false, message: "Yetkisiz işlem: Admin doğrulaması başarısız!" };
  }

  const adSoyad = String(params.adSoyad || "").trim();
  const sinif = String(params.sinif || "").trim();
  const pin = String(params.pin || "").trim();

  if (!adSoyad || !sinif || !pin) {
    return { success: false, message: "Öğretmen adı, sınıfı ve PIN kodu zorunludur." };
  }

  let ogrtSayfa = ss.getSheetByName(TABLO_ISIMLERI.OGRETMENLER);
  if (!ogrtSayfa) {
    ilkKurulum();
    ogrtSayfa = ss.getSheetByName(TABLO_ISIMLERI.OGRETMENLER);
  }

  const mevcutlar = getOgretmenlerListesi(ss);
  for (let i = 0; i < mevcutlar.length; i++) {
    if (mevcutlar[i].pin === pin) {
      return { success: false, message: "Bu PIN kodu başka bir öğretmende tanımlı! Lütfen farklı bir PIN girin." };
    }
  }

  const yeniId = benzersizIdUret("OGRT");
  ogrtSayfa.appendRow([yeniId, guvenliHucreDegeri(adSoyad), guvenliHucreDegeri(sinif), guvenliHucreDegeri(pin), "Aktif"]);

  const guncel = adminPanelVerisiOlustur(ss);
  return {
    success: true,
    message: `${adSoyad} (${sinif}) sisteme eklendi.`,
    ogretmenler: guncel.ogretmenler,
    okulIstatistik: guncel.okulIstatistik
  };
}

function ogretmenGuncelle(ss, params) {
  if (!dogrulaAdmin(ss, params.adminKullanici, params.adminSifre)) {
    return { success: false, message: "Yetkisiz işlem!" };
  }

  const ogretmenId = String(params.ogretmenId || "").trim();
  const yeniAd = String(params.adSoyad || "").trim();
  const yeniSinif = String(params.sinif || "").trim();
  const yeniPin = String(params.pin || "").trim();

  if (!ogretmenId || !yeniAd || !yeniSinif || !yeniPin) {
    return { success: false, message: "Tüm alanlar zorunludur." };
  }

  const ogrtSayfa = ss.getSheetByName(TABLO_ISIMLERI.OGRETMENLER);
  if (!ogrtSayfa) return { success: false, message: "Öğretmenler tablosu bulunamadı." };

  const data = ogrtSayfa.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== ogretmenId && String(data[i][4]).toLowerCase() !== "pasif" && String(data[i][3]).trim() === yeniPin) {
      return { success: false, message: "Bu PIN kodu başka bir öğretmende kullanılıyor!" };
    }
  }

  let eskiSinif = "";
  let bulundu = false;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === ogretmenId) {
      eskiSinif = String(data[i][2]).trim();
      ogrtSayfa.getRange(i + 1, 2).setValue(guvenliHucreDegeri(yeniAd));
      ogrtSayfa.getRange(i + 1, 3).setValue(guvenliHucreDegeri(yeniSinif));
      ogrtSayfa.getRange(i + 1, 4).setValue(guvenliHucreDegeri(yeniPin));
      bulundu = true;
      break;
    }
  }

  if (!bulundu) return { success: false, message: "Öğretmen kaydı bulunamadı." };

  // Sınıf adı değiştiyse o öğretmenin öğrencilerini ve kitaplarını da yeni sınıf adına taşı (Yetim Veri Önleme)
  if (eskiSinif && eskiSinif !== yeniSinif) {
    const ogrSayfa = ss.getSheetByName(TABLO_ISIMLERI.OGRENCILER);
    if (ogrSayfa) {
      const ogrData = ogrSayfa.getDataRange().getValues();
      for (let i = 1; i < ogrData.length; i++) {
        if (String(ogrData[i][6]) === ogretmenId || String(ogrData[i][5]).trim() === eskiSinif) {
          ogrSayfa.getRange(i + 1, 6).setValue(guvenliHucreDegeri(yeniSinif));
        }
      }
    }
    const havuzSayfa = ss.getSheetByName(TABLO_ISIMLERI.KITAP_HAVUZU);
    if (havuzSayfa) {
      const havuzData = havuzSayfa.getDataRange().getValues();
      for (let i = 1; i < havuzData.length; i++) {
        if (String(havuzData[i][6]).trim() === eskiSinif) {
          havuzSayfa.getRange(i + 1, 7).setValue(guvenliHucreDegeri(yeniSinif));
        }
      }
    }
  }

  const guncel = adminPanelVerisiOlustur(ss);
  return {
    success: true,
    message: "Öğretmen bilgileri ve bağlı sınıf kayıtları güncellendi.",
    ogretmenler: guncel.ogretmenler,
    okulIstatistik: guncel.okulIstatistik
  };
}

function ogretmenSil(ss, params) {
  if (!dogrulaAdmin(ss, params.adminKullanici, params.adminSifre)) {
    return { success: false, message: "Yetkisiz işlem!" };
  }

  const ogrtSayfa = ss.getSheetByName(TABLO_ISIMLERI.OGRETMENLER);
  if (!ogrtSayfa) return { success: false, message: "Öğretmenler tablosu bulunamadı." };

  const data = ogrtSayfa.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(params.ogretmenId)) {
      ogrtSayfa.deleteRow(i + 1);
      const guncel = adminPanelVerisiOlustur(ss);
      return {
        success: true,
        message: "Öğretmen kaydı silindi.",
        ogretmenler: guncel.ogretmenler,
        okulIstatistik: guncel.okulIstatistik
      };
    }
  }
  return { success: false, message: "Öğretmen bulunamadı." };
}

function adminAyarGuncelle(ss, params) {
  if (!dogrulaAdmin(ss, params.adminKullanici, params.adminSifre)) {
    return { success: false, message: "Mevcut Admin doğrulaması başarısız!" };
  }

  let ayarSayfa = ss.getSheetByName(TABLO_ISIMLERI.AYARLAR);
  if (!ayarSayfa) {
    ilkKurulum();
    ayarSayfa = ss.getSheetByName(TABLO_ISIMLERI.AYARLAR);
  }

  const yeniKullanici = String(params.yeniAdminKullanici || params.adminKullanici || "admin").trim();
  const yeniSifre = String(params.yeniAdminSifre || params.adminSifre || "").trim();
  const yeniBaraj = Math.max(1, Number(params.kulupBaraji) || 3);

  if (!yeniKullanici || yeniSifre.length < 4) {
    return { success: false, message: "Admin kullanıcı adı boş olamaz ve şifre en az 4 karakter olmalıdır." };
  }

  ayarKaydetVeyaGuncelle(ayarSayfa, "AdminKullanici", yeniKullanici);
  ayarKaydetVeyaGuncelle(ayarSayfa, "AdminSifre", yeniSifre);
  ayarKaydetVeyaGuncelle(ayarSayfa, "KulupBaraji", String(yeniBaraj));

  return {
    success: true,
    message: "Sistem ayarları ve Admin bilgileri güncellendi.",
    yeniAdmin: { kullaniciAdi: yeniKullanici, sifre: yeniSifre },
    kulupBaraji: yeniBaraj
  };
}

function ayarKaydetVeyaGuncelle(ayarSayfa, anahtar, deger) {
  const data = ayarSayfa.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === anahtar) {
      ayarSayfa.getRange(i + 1, 2).setValue(guvenliHucreDegeri(deger));
      return;
    }
  }
  ayarSayfa.appendRow([guvenliHucreDegeri(anahtar), guvenliHucreDegeri(deger), ""]);
}

// ============================================================================
// ÖĞRENCİ İŞLEMLERİ
// ============================================================================

function ogrenciGiris(ss, pin) {
  const temizPin = String(pin || "").trim();
  if (!temizPin) {
    return { success: false, message: "Lütfen 6 haneli PIN kodunu girin." };
  }

  const ogrSayfa = ss.getSheetByName(TABLO_ISIMLERI.OGRENCILER);
  const okunanSayfa = ss.getSheetByName(TABLO_ISIMLERI.OKUNAN_KITAPLAR);
  const ayarlar = getAyarlar(ss);
  const ogretmenler = getOgretmenlerListesi(ss);

  if (!ogrSayfa) {
    return { success: false, message: "Sistem henüz kurulmamış." };
  }

  const ogrData = ogrSayfa.getDataRange().getValues();
  let ogrenci = null;

  for (let i = 1; i < ogrData.length; i++) {
    const row = ogrData[i];
    if (String(row[3]).trim() === temizPin && String(row[4]).toLowerCase() !== "hayır") {
      ogrenci = {
        id: String(row[0]),
        adSoyad: String(row[1]),
        numara: String(row[2]),
        sinif: String(row[5] || ayarlar.SinifAdi || "3-A Sınıfı"),
        ogretmenId: String(row[6] || ""),
        avatar: String(row[7] || "🦊")
      };
      break;
    }
  }

  if (!ogrenci) {
    return { success: false, message: "PIN kodu bulunamadı. Lütfen kontrol edip tekrar dene veya öğretmeninden öğren!" };
  }

  let ogretmenAdi = "";
  for (let j = 0; j < ogretmenler.length; j++) {
    if (ogretmenler[j].id === ogrenci.ogretmenId || ogretmenler[j].sinif === ogrenci.sinif) {
      ogretmenAdi = ogretmenler[j].adSoyad;
      if (!ogrenci.sinif) ogrenci.sinif = ogretmenler[j].sinif;
      break;
    }
  }
  ogrenci.ogretmenAdi = ogretmenAdi;

  const okunanData = okunanSayfa ? okunanSayfa.getDataRange().getValues() : [];
  const devamEdenler = [];
  const tamamlananlar = [];
  let onaylananSayisi = 0;
  let toplamOkunanSayfa = 0;

  for (let i = 1; i < okunanData.length; i++) {
    const row = okunanData[i];
    if (String(row[1]) === ogrenci.id) {
      const tSayfa = Math.max(1, Number(row[5]) || 1);
      const kSayfa = Math.min(tSayfa, Math.max(0, Number(row[6]) || 0));
      const yildiz = Math.min(5, Math.max(1, Number(row[7]) || 5));
      const durum = String(row[10]);

      const kayit = {
        islemId: String(row[0]),
        kitapId: String(row[2]),
        kitapAdi: String(row[3]),
        yazar: String(row[4]),
        toplamSayfa: tSayfa,
        kaldigiSayfa: kSayfa,
        yildiz: yildiz,
        yorum: String(row[8] || ""),
        tarih: row[9] ? String(row[9]) : "",
        durum: durum,
        ogretmenNotu: String(row[11] || "")
      };

      if (durum === "Devam Ediyor") {
        devamEdenler.push(kayit);
        toplamOkunanSayfa += kSayfa;
      } else {
        tamamlananlar.push(kayit);
        if (durum === "Onaylandı") {
          onaylananSayisi++;
          toplamOkunanSayfa += tSayfa;
        } else if (durum === "Onay Bekliyor") {
          toplamOkunanSayfa += tSayfa;
        }
      }
    }
  }

  devamEdenler.reverse();
  tamamlananlar.reverse();

  const baraj = Number(ayarlar.KulupBaraji) || 3;
  const aktifSinif = ogrenci.sinif || ayarlar.SinifAdi || "3-A Sınıfı";

  return {
    success: true,
    ogrenci: ogrenci,
    havuz: getKitapHavuzu(ss, aktifSinif, true),
    istatistik: {
      onaylananKitap: onaylananSayisi,
      toplamSayfa: toplamOkunanSayfa,
      kulupBaraji: baraj,
      kulupteMi: onaylananSayisi >= baraj,
      sinifAdi: aktifSinif,
      ogretmenAdi: ogretmenAdi
    },
    devamEdenler: devamEdenler,
    tamamlananlar: tamamlananlar
  };
}

function ogrenciAvatarGuncelle(ss, params) {
  const temizPin = String(params.pin || "").trim();
  const izinliAvatarlar = ["🦊", "🐼", "🦁", "🦉", "🦄", "🐸", "🚀", "🐱", "🐰", "🐨"];
  const secilenAvatar = izinliAvatarlar.indexOf(params.avatar) !== -1 ? params.avatar : "🦊";

  const ogrSayfa = ss.getSheetByName(TABLO_ISIMLERI.OGRENCILER);
  if (!ogrSayfa) return { success: false, message: "Öğrenci tablosu bulunamadı." };

  const ogrData = ogrSayfa.getDataRange().getValues();
  for (let i = 1; i < ogrData.length; i++) {
    if (String(ogrData[i][3]).trim() === temizPin && String(ogrData[i][4]).toLowerCase() !== "hayır") {
      ogrSayfa.getRange(i + 1, 8).setValue(secilenAvatar);
      return { success: true, avatar: secilenAvatar, message: "Avatarın güncellendi! " + secilenAvatar };
    }
  }
  return { success: false, message: "Öğrenci bulunamadı." };
}

/**
 * 5. KİTAP İLERLEME KAYDETME (Tarih & Sınıf & Sayfa Doğrulamalı)
 */
function kitapIlerlemeKaydet(ss, params) {
  const temizPin = String(params.pin || "").trim();
  const kitapId = String(params.kitapId || "").trim();
  const yorum = String(params.yorum || "").trim().slice(0, 500);
  const yildiz = Math.min(5, Math.max(1, Number(params.yildiz) || 5));

  if (!temizPin || !kitapId) {
    return { success: false, message: "Eksik bilgi gönderildi." };
  }

  const ogrSayfa = ss.getSheetByName(TABLO_ISIMLERI.OGRENCILER);
  const okunanSayfa = ss.getSheetByName(TABLO_ISIMLERI.OKUNAN_KITAPLAR);
  const ogrData = ogrSayfa.getDataRange().getValues();

  let ogrenciId = null;
  let ogrenciSinif = "";
  for (let i = 1; i < ogrData.length; i++) {
    if (String(ogrData[i][3]).trim() === temizPin && String(ogrData[i][4]).toLowerCase() !== "hayır") {
      ogrenciId = String(ogrData[i][0]);
      ogrenciSinif = String(ogrData[i][5] || "").trim();
      break;
    }
  }

  if (!ogrenciId) {
    return { success: false, message: "Geçersiz PIN kodu!" };
  }

  // Kitabın gerçekten öğrencinin aktif havuzunda (ve aktifTarih <= bugun) olduğunu doğrula!
  const aktifHavuz = getKitapHavuzu(ss, ogrenciSinif, true);
  let havuzKitabi = null;
  for (let i = 0; i < aktifHavuz.length; i++) {
    if (aktifHavuz[i].kitapId === kitapId) {
      havuzKitabi = aktifHavuz[i];
      break;
    }
  }

  if (!havuzKitabi) {
    return { success: false, message: "Bu kitap henüz kütüphanede aktif değil veya sınıfınıza ait değil." };
  }

  const toplamSayfa = Math.max(1, Number(havuzKitabi.sayfaSayisi) || 1);
  let kaldigiSayfa = Math.max(1, Number(params.kaldigiSayfa) || 1);
  if (kaldigiSayfa > toplamSayfa) kaldigiSayfa = toplamSayfa;

  // Son sayfaya ulaşıldıysa otomatik bitirildi kabul et
  const bitirildiMi = Boolean(params.bitirildiMi) || (kaldigiSayfa >= toplamSayfa);
  if (bitirildiMi) {
    kaldigiSayfa = toplamSayfa;
  }

  const yeniDurum = bitirildiMi ? "Onay Bekliyor" : "Devam Ediyor";
  const tarihStr = simdiTarihSaatStr();

  const okunanData = okunanSayfa.getDataRange().getValues();
  let mevcutSatirIndex = -1;

  for (let i = 1; i < okunanData.length; i++) {
    const rowOgrId = String(okunanData[i][1]);
    const rowKitapId = String(okunanData[i][2]);
    const rowDurum = String(okunanData[i][10]);

    if (rowOgrId === ogrenciId && rowKitapId === kitapId && rowDurum !== "Onaylandı") {
      mevcutSatirIndex = i + 1;
      break;
    }
  }

  if (mevcutSatirIndex !== -1) {
    okunanSayfa.getRange(mevcutSatirIndex, 6).setValue(toplamSayfa);
    okunanSayfa.getRange(mevcutSatirIndex, 7).setValue(kaldigiSayfa);
    okunanSayfa.getRange(mevcutSatirIndex, 8).setValue(yildiz);
    if (yorum) okunanSayfa.getRange(mevcutSatirIndex, 9).setValue(guvenliHucreDegeri(yorum));
    okunanSayfa.getRange(mevcutSatirIndex, 10).setValue(tarihStr);
    okunanSayfa.getRange(mevcutSatirIndex, 11).setValue(yeniDurum);
    if (bitirildiMi) {
      okunanSayfa.getRange(mevcutSatirIndex, 12).setValue("");
    }
  } else {
    const islemId = benzersizIdUret("ISLEM");
    okunanSayfa.appendRow([
      islemId,
      ogrenciId,
      kitapId,
      guvenliHucreDegeri(havuzKitabi.kitapAdi),
      guvenliHucreDegeri(havuzKitabi.yazar),
      toplamSayfa,
      kaldigiSayfa,
      yildiz,
      guvenliHucreDegeri(yorum),
      tarihStr,
      yeniDurum,
      ""
    ]);
  }

  const mesaj = bitirildiMi
    ? `Harika! "${havuzKitabi.kitapAdi}" kitabını bitirdin ve öğretmenin onayına gönderildi! 🎉`
    : `"${havuzKitabi.kitapAdi}" kitabında ${kaldigiSayfa}. sayfaya kadar ilerlemen kaydedildi! 📖`;

  return { success: true, message: mesaj, bitirildiMi: bitirildiMi };
}

/**
 * Öğrenci yanlışlıkla "Bitirdim" dediyse ("Onay Bekliyor" iken) tekrar "Devam Ediyor"a çekebilsin
 */
function ogrenciKitapGeriAl(ss, params) {
  const temizPin = String(params.pin || "").trim();
  const kitapId = String(params.kitapId || "").trim();

  const ogrSayfa = ss.getSheetByName(TABLO_ISIMLERI.OGRENCILER);
  const okunanSayfa = ss.getSheetByName(TABLO_ISIMLERI.OKUNAN_KITAPLAR);
  if (!ogrSayfa || !okunanSayfa) return { success: false, message: "Tablo bulunamadı." };

  const ogrData = ogrSayfa.getDataRange().getValues();
  let ogrenciId = null;
  for (let i = 1; i < ogrData.length; i++) {
    if (String(ogrData[i][3]).trim() === temizPin && String(ogrData[i][4]).toLowerCase() !== "hayır") {
      ogrenciId = String(ogrData[i][0]);
      break;
    }
  }
  if (!ogrenciId) return { success: false, message: "Öğrenci doğrulanamadı." };

  const okunanData = okunanSayfa.getDataRange().getValues();
  for (let i = 1; i < okunanData.length; i++) {
    if (String(okunanData[i][1]) === ogrenciId && String(okunanData[i][2]) === kitapId && String(okunanData[i][10]) === "Onay Bekliyor") {
      const topSayfa = Math.max(2, Number(okunanData[i][5]) || 10);
      okunanSayfa.getRange(i + 1, 7).setValue(Math.max(1, topSayfa - 1));
      okunanSayfa.getRange(i + 1, 11).setValue("Devam Ediyor");
      return { success: true, message: "Kitap tekrar 'Okumaya Devam Ediyorum' listene alındı! 📖" };
    }
  }
  return { success: false, message: "Geri alınacak onay bekleyen kayıt bulunamadı." };
}

// ============================================================================
// ÖĞRETMEN İŞLEMLERİ (SINIF BAZLI YETKİ KONTROLÜ - BOLA KORUMALI)
// ============================================================================

function ogretmenGiris(ss, pin) {
  const ogretmen = dogrulaOgretmen(ss, pin);
  if (!ogretmen) {
    return { success: false, message: "Hatalı öğretmen PIN kodu!" };
  }

  const ayarlar = getAyarlar(ss);
  const ogrSayfa = ss.getSheetByName(TABLO_ISIMLERI.OGRENCILER);
  const okunanSayfa = ss.getSheetByName(TABLO_ISIMLERI.OKUNAN_KITAPLAR);

  const ogrData = ogrSayfa ? ogrSayfa.getDataRange().getValues() : [];
  const okunanData = okunanSayfa ? okunanSayfa.getDataRange().getValues() : [];

  const ogrMap = {};
  const ogrenciListesi = [];

  for (let i = 1; i < ogrData.length; i++) {
    if (String(ogrData[i][4]).toLowerCase() === "hayır") continue;
    const rowSinif = String(ogrData[i][5] || "").trim();
    const rowOgrtId = String(ogrData[i][6] || "").trim();

    if (rowSinif && rowSinif !== ogretmen.sinif && rowOgrtId !== ogretmen.id) {
      continue;
    }

    const id = String(ogrData[i][0]);
    ogrMap[id] = {
      id: id,
      adSoyad: String(ogrData[i][1]),
      numara: String(ogrData[i][2]),
      pin: String(ogrData[i][3]),
      sinif: rowSinif || ogretmen.sinif,
      avatar: String(ogrData[i][7] || "🦊"),
      okunanKitap: 0,
      toplamSayfa: 0
    };
  }

  const bekleyenler = [];
  const devamEdenler = [];
  const onaylananlar = [];

  for (let i = 1; i < okunanData.length; i++) {
    const row = okunanData[i];
    const ogrId = String(row[1]);
    if (!ogrMap[ogrId]) continue;

    const durum = String(row[10]);
    const tSayfa = Math.max(1, Number(row[5]) || 1);
    const kSayfa = Math.min(tSayfa, Math.max(0, Number(row[6]) || 0));
    const yildiz = Math.min(5, Math.max(1, Number(row[7]) || 5));

    const kayit = {
      islemId: String(row[0]),
      ogrenciId: ogrId,
      ogrenciAdi: ogrMap[ogrId].adSoyad,
      kitapId: String(row[2]),
      kitapAdi: String(row[3]),
      yazar: String(row[4]),
      toplamSayfa: tSayfa,
      kaldigiSayfa: kSayfa,
      yildiz: yildiz,
      yorum: String(row[8] || ""),
      tarih: row[9] ? String(row[9]) : "",
      durum: durum,
      ogretmenNotu: String(row[11] || "")
    };

    if (durum === "Onay Bekliyor") {
      bekleyenler.push(kayit);
      ogrMap[ogrId].toplamSayfa += tSayfa;
    } else if (durum === "Devam Ediyor") {
      devamEdenler.push(kayit);
      ogrMap[ogrId].toplamSayfa += kSayfa;
    } else if (durum === "Onaylandı") {
      onaylananlar.push(kayit);
      ogrMap[ogrId].okunanKitap++;
      ogrMap[ogrId].toplamSayfa += tSayfa;
    }
  }

  for (let key in ogrMap) {
    ogrenciListesi.push(ogrMap[key]);
  }

  return {
    success: true,
    ogretmen: ogretmen,
    bekleyenler: bekleyenler.reverse(),
    devamEdenler: devamEdenler.reverse(),
    onaylananlar: onaylananlar.reverse(),
    ogrenciler: ogrenciListesi,
    havuz: getKitapHavuzu(ss, ogretmen.sinif, false),
    ayarlar: {
      SinifAdi: ogretmen.sinif,
      KulupBaraji: Number(ayarlar.KulupBaraji) || 3
    }
  };
}

/**
 * Öğretmenin bu öğrenci üzerinde yetkisi olup olmadığını doğrular (BOLA / IDOR Koruması)
 */
function ogrenciOgretmeneAitMi(ss, ogrenciId, ogretmen) {
  const ogrSayfa = ss.getSheetByName(TABLO_ISIMLERI.OGRENCILER);
  if (!ogrSayfa) return false;
  const ogrData = ogrSayfa.getDataRange().getValues();
  for (let i = 1; i < ogrData.length; i++) {
    if (String(ogrData[i][0]) === String(ogrenciId)) {
      const rowSinif = String(ogrData[i][5] || "").trim();
      const rowOgrtId = String(ogrData[i][6] || "").trim();
      return !rowSinif || rowSinif === ogretmen.sinif || rowOgrtId === ogretmen.id;
    }
  }
  return false;
}

function kitapOnayla(ss, params) {
  const ogretmen = dogrulaOgretmen(ss, params.pin || params.sifre);
  if (!ogretmen) return { success: false, message: "Yetkisiz işlem!" };

  const okunanSayfa = ss.getSheetByName(TABLO_ISIMLERI.OKUNAN_KITAPLAR);
  const data = okunanSayfa.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(params.islemId)) {
      if (!ogrenciOgretmeneAitMi(ss, data[i][1], ogretmen)) {
        return { success: false, message: "Bu kayıt sizin sınıfınızdaki bir öğrenciye ait değil!" };
      }
      okunanSayfa.getRange(i + 1, 11).setValue("Onaylandı");
      okunanSayfa.getRange(i + 1, 12).setValue("");
      return { success: true, message: "Kitap onaylandı ve öğrencinin karne hedefine eklendi! ⭐" };
    }
  }
  return { success: false, message: "Kayıt bulunamadı." };
}

/**
 * Öğretmen kitabı silmek yerine yapıcı bir notla "Devam Ediyor"a iade eder
 */
function kitapIadeEt(ss, params) {
  const ogretmen = dogrulaOgretmen(ss, params.pin || params.sifre);
  if (!ogretmen) return { success: false, message: "Yetkisiz işlem!" };

  const ogretmenNotu = String(params.ogretmenNotu || "Öğretmenin bu kitabı biraz daha gözden geçirmeni istiyor.").trim().slice(0, 300);
  const okunanSayfa = ss.getSheetByName(TABLO_ISIMLERI.OKUNAN_KITAPLAR);
  const data = okunanSayfa.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(params.islemId)) {
      if (!ogrenciOgretmeneAitMi(ss, data[i][1], ogretmen)) {
        return { success: false, message: "Bu kayıt sizin sınıfınızdaki bir öğrenciye ait değil!" };
      }
      okunanSayfa.getRange(i + 1, 11).setValue("Devam Ediyor");
      okunanSayfa.getRange(i + 1, 12).setValue(guvenliHucreDegeri(ogretmenNotu));
      return { success: true, message: "Kitap öğrenciye notunuzla birlikte tekrar okuma/düzenleme için iade edildi. 🔄" };
    }
  }
  return { success: false, message: "Kayıt bulunamadı." };
}

/**
 * Yanlışlıkla onaylanan bir kitabı tekrar "Onay Bekliyor" durumuna geri alır
 */
function kitapOnayGeriAl(ss, params) {
  const ogretmen = dogrulaOgretmen(ss, params.pin || params.sifre);
  if (!ogretmen) return { success: false, message: "Yetkisiz işlem!" };

  const okunanSayfa = ss.getSheetByName(TABLO_ISIMLERI.OKUNAN_KITAPLAR);
  const data = okunanSayfa.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(params.islemId)) {
      if (!ogrenciOgretmeneAitMi(ss, data[i][1], ogretmen)) {
        return { success: false, message: "Bu kayıt sizin sınıfınıza ait değil!" };
      }
      okunanSayfa.getRange(i + 1, 11).setValue("Onay Bekliyor");
      return { success: true, message: "Kitap onayı geri alındı ve 'Onay Bekleyenler' listesine taşındı." };
    }
  }
  return { success: false, message: "Kayıt bulunamadı." };
}

function kitapSil(ss, params) {
  const ogretmen = dogrulaOgretmen(ss, params.pin || params.sifre);
  if (!ogretmen) return { success: false, message: "Yetkisiz işlem!" };

  const okunanSayfa = ss.getSheetByName(TABLO_ISIMLERI.OKUNAN_KITAPLAR);
  const data = okunanSayfa.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(params.islemId)) {
      if (!ogrenciOgretmeneAitMi(ss, data[i][1], ogretmen)) {
        return { success: false, message: "Bu kayıt sizin sınıfınızdaki bir öğrenciye ait değil!" };
      }
      okunanSayfa.deleteRow(i + 1);
      return { success: true, message: "Kayıt tamamen silindi." };
    }
  }
  return { success: false, message: "Kayıt bulunamadı." };
}

function havuzaKitapEkle(ss, params) {
  const ogretmen = dogrulaOgretmen(ss, params.pin || params.sifre);
  if (!ogretmen) return { success: false, message: "Yetkisiz işlem!" };

  const kitapAdi = String(params.kitapAdi || "").trim();
  const yazar = String(params.yazar || "").trim();
  const sayfaSayisi = Math.max(1, Number(params.sayfaSayisi) || 1);
  const tur = String(params.tur || "Genel").trim();

  if (!kitapAdi || !yazar) {
    return { success: false, message: "Kitap adı ve yazar zorunludur." };
  }

  const havuzSayfa = ss.getSheetByName(TABLO_ISIMLERI.KITAP_HAVUZU);
  const yeniId = benzersizIdUret("HAVUZ");
  const bugun = bugunTarihStr();
  const aktifTarih = params.aktifTarih ? String(params.aktifTarih).trim().slice(0, 10) : bugun;

  havuzSayfa.appendRow([
    yeniId,
    guvenliHucreDegeri(kitapAdi),
    guvenliHucreDegeri(yazar),
    sayfaSayisi,
    guvenliHucreDegeri(tur),
    "Aktif",
    guvenliHucreDegeri(ogretmen.sinif || "Ortak"),
    guvenliHucreDegeri(aktifTarih)
  ]);

  const tarihMesaji = aktifTarih > bugun
    ? ` (Öğrencilere ${aktifTarih} tarihinde açılacak)`
    : " (Öğrencilere şu an aktif)";
  return { success: true, message: `"${kitapAdi}" sınıf kütüphanesine eklendi!${tarihMesaji}` };
}

function havuzTopluKitapEkle(ss, params) {
  const ogretmen = dogrulaOgretmen(ss, params.pin || params.sifre);
  if (!ogretmen) return { success: false, message: "Yetkisiz işlem!" };

  const kitaplar = Array.isArray(params.kitaplar) ? params.kitaplar : [];
  if (kitaplar.length === 0) {
    return { success: false, message: "Eklenecek kitap listesi boş." };
  }

  const havuzSayfa = ss.getSheetByName(TABLO_ISIMLERI.KITAP_HAVUZU);
  const bugun = bugunTarihStr();
  let eklenenSayi = 0;

  for (let i = 0; i < kitaplar.length; i++) {
    const item = kitaplar[i];
    const kitapAdi = String(item.kitapAdi || "").trim();
    const yazar = String(item.yazar || "Belirtilmemiş").trim();
    const sayfaSayisi = Math.max(1, Number(item.sayfaSayisi) || 64);
    const tur = String(item.tur || "Genel").trim();
    const aktifTarih = item.aktifTarih ? String(item.aktifTarih).trim().slice(0, 10) : bugun;
    if (!kitapAdi) continue;

    const yeniId = benzersizIdUret("HAVUZ") + "-" + i;
    havuzSayfa.appendRow([
      yeniId,
      guvenliHucreDegeri(kitapAdi),
      guvenliHucreDegeri(yazar),
      sayfaSayisi,
      guvenliHucreDegeri(tur),
      "Aktif",
      guvenliHucreDegeri(ogretmen.sinif || "Ortak"),
      guvenliHucreDegeri(aktifTarih)
    ]);
    eklenenSayi++;
  }

  return {
    success: true,
    message: `${eklenenSayi} kitap sınıf kütüphanesine toplu olarak eklendi! 📚`
  };
}

function havuzKitapGuncelle(ss, params) {
  const ogretmen = dogrulaOgretmen(ss, params.pin || params.sifre);
  if (!ogretmen) return { success: false, message: "Yetkisiz işlem!" };

  const kitapId = String(params.kitapId || "").trim();
  const kitapAdi = String(params.kitapAdi || "").trim();
  const yazar = String(params.yazar || "").trim();
  const sayfaSayisi = Math.max(1, Number(params.sayfaSayisi) || 1);
  const tur = String(params.tur || "Genel").trim();
  const aktifTarih = params.aktifTarih ? String(params.aktifTarih).trim().slice(0, 10) : bugunTarihStr();

  if (!kitapId || !kitapAdi || !yazar) {
    return { success: false, message: "Kitap bilgileri eksik." };
  }

  const havuzSayfa = ss.getSheetByName(TABLO_ISIMLERI.KITAP_HAVUZU);
  const data = havuzSayfa.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === kitapId) {
      const kitapSinif = String(data[i][6] || "Ortak").trim();
      if (kitapSinif !== "Ortak" && kitapSinif !== ogretmen.sinif) {
        return { success: false, message: "Başka bir sınıfa özel kitabı düzenleyemezsiniz." };
      }
      havuzSayfa.getRange(i + 1, 2).setValue(guvenliHucreDegeri(kitapAdi));
      havuzSayfa.getRange(i + 1, 3).setValue(guvenliHucreDegeri(yazar));
      havuzSayfa.getRange(i + 1, 4).setValue(sayfaSayisi);
      havuzSayfa.getRange(i + 1, 5).setValue(guvenliHucreDegeri(tur));
      havuzSayfa.getRange(i + 1, 8).setValue(guvenliHucreDegeri(aktifTarih));
      return { success: true, message: `"${kitapAdi}" bilgileri güncellendi.` };
    }
  }
  return { success: false, message: "Kitap bulunamadı." };
}

function havuzdanKitapSil(ss, params) {
  const ogretmen = dogrulaOgretmen(ss, params.pin || params.sifre);
  if (!ogretmen) return { success: false, message: "Yetkisiz işlem!" };

  const havuzSayfa = ss.getSheetByName(TABLO_ISIMLERI.KITAP_HAVUZU);
  const data = havuzSayfa.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(params.kitapId)) {
      const kitapSinif = String(data[i][6] || "Ortak").trim();
      if (kitapSinif !== "Ortak" && kitapSinif !== ogretmen.sinif) {
        return { success: false, message: "Başka bir sınıfa ait kitabı silemezsiniz." };
      }
      havuzSayfa.getRange(i + 1, 6).setValue("Pasif");
      return { success: true, message: "Kitap kütüphane listesinden kaldırıldı." };
    }
  }
  return { success: false, message: "Kitap bulunamadı." };
}

/**
 * Mevcut tüm aktif öğrenci PIN'lerini Set olarak döndürür (PIN Çakışması Önleme)
 */
function mevcutOgrenciPinleriniAl(ogrData, haricOgrenciId) {
  const pinSet = {};
  for (let i = 1; i < ogrData.length; i++) {
    if (String(ogrData[i][4]).toLowerCase() === "hayır") continue;
    if (haricOgrenciId && String(ogrData[i][0]) === String(haricOgrenciId)) continue;
    pinSet[String(ogrData[i][3]).trim()] = true;
  }
  return pinSet;
}

function benzersizOgrenciPinUret(pinSet) {
  for (let deneme = 0; deneme < 1000; deneme++) {
    const aday = Math.floor(100000 + Math.random() * 900000).toString();
    if (!pinSet[aday]) {
      pinSet[aday] = true;
      return aday;
    }
  }
  return String(Math.floor(100000 + Math.random() * 900000));
}

function ogrenciEkle(ss, params) {
  const ogretmen = dogrulaOgretmen(ss, params.pin || params.sifre);
  if (!ogretmen) return { success: false, message: "Yetkisiz işlem!" };

  const adSoyad = String(params.adSoyad || "").trim();
  const numara = String(params.numara || "").trim();
  if (!adSoyad) return { success: false, message: "Öğrenci adı soyadı zorunludur." };

  const ogrSayfa = ss.getSheetByName(TABLO_ISIMLERI.OGRENCILER);
  const ogrData = ogrSayfa.getDataRange().getValues();
  const pinSet = mevcutOgrenciPinleriniAl(ogrData, null);

  let ogrPin = String(params.ogrenciPin || "").trim();
  if (ogrPin) {
    if (pinSet[ogrPin]) {
      return { success: false, message: `Bu PIN kodu (${ogrPin}) başka bir öğrencide zaten kullanılıyor! Lütfen farklı bir PIN girin veya boş bırakın.` };
    }
  } else {
    ogrPin = benzersizOgrenciPinUret(pinSet);
  }

  const yeniId = benzersizIdUret("OGR");
  ogrSayfa.appendRow([
    yeniId,
    guvenliHucreDegeri(adSoyad),
    guvenliHucreDegeri(numara),
    guvenliHucreDegeri(ogrPin),
    "Evet",
    guvenliHucreDegeri(ogretmen.sinif),
    guvenliHucreDegeri(ogretmen.id),
    "🦊"
  ]);

  return {
    success: true,
    message: `${adSoyad} (${ogretmen.sinif}) eklendi. PIN Kodu: ${ogrPin}`,
    pin: ogrPin
  };
}

function ogrenciTopluEkle(ss, params) {
  const ogretmen = dogrulaOgretmen(ss, params.pin || params.sifre);
  if (!ogretmen) return { success: false, message: "Yetkisiz işlem!" };

  const satirlar = Array.isArray(params.ogrenciler) ? params.ogrenciler : [];
  if (satirlar.length === 0) {
    return { success: false, message: "Eklenecek öğrenci listesi boş." };
  }

  const ogrSayfa = ss.getSheetByName(TABLO_ISIMLERI.OGRENCILER);
  const ogrData = ogrSayfa.getDataRange().getValues();
  const pinSet = mevcutOgrenciPinleriniAl(ogrData, null);
  let eklenenSayi = 0;

  for (let i = 0; i < satirlar.length; i++) {
    const item = satirlar[i];
    const adSoyad = String(item.adSoyad || "").trim();
    const numara = String(item.numara || "").trim();
    if (!adSoyad) continue;

    const ogrPin = benzersizOgrenciPinUret(pinSet);
    const yeniId = benzersizIdUret("OGR") + "-" + i;
    ogrSayfa.appendRow([
      yeniId,
      guvenliHucreDegeri(adSoyad),
      guvenliHucreDegeri(numara),
      guvenliHucreDegeri(ogrPin),
      "Evet",
      guvenliHucreDegeri(ogretmen.sinif),
      guvenliHucreDegeri(ogretmen.id),
      "🦊"
    ]);
    eklenenSayi++;
  }

  return {
    success: true,
    message: `${eklenenSayi} öğrenci benzersiz PIN kodlarıyla ${ogretmen.sinif} listesine eklendi! 🎉`
  };
}

function ogrenciGuncelle(ss, params) {
  const ogretmen = dogrulaOgretmen(ss, params.pin || params.sifre);
  if (!ogretmen) return { success: false, message: "Yetkisiz işlem!" };

  const ogrenciId = String(params.ogrenciId || "").trim();
  const adSoyad = String(params.adSoyad || "").trim();
  const numara = String(params.numara || "").trim();
  const yeniPin = String(params.ogrenciPin || "").trim();

  if (!ogrenciId || !adSoyad || !yeniPin) {
    return { success: false, message: "Öğrenci adı ve PIN kodu zorunludur." };
  }

  const ogrSayfa = ss.getSheetByName(TABLO_ISIMLERI.OGRENCILER);
  const ogrData = ogrSayfa.getDataRange().getValues();
  const pinSet = mevcutOgrenciPinleriniAl(ogrData, ogrenciId);

  if (pinSet[yeniPin]) {
    return { success: false, message: `Bu PIN kodu (${yeniPin}) başka bir öğrencide kullanılıyor!` };
  }

  for (let i = 1; i < ogrData.length; i++) {
    if (String(ogrData[i][0]) === ogrenciId) {
      if (!ogrenciOgretmeneAitMi(ss, ogrenciId, ogretmen)) {
        return { success: false, message: "Bu öğrenci sizin sınıfınıza ait değil!" };
      }
      ogrSayfa.getRange(i + 1, 2).setValue(guvenliHucreDegeri(adSoyad));
      ogrSayfa.getRange(i + 1, 3).setValue(guvenliHucreDegeri(numara));
      ogrSayfa.getRange(i + 1, 4).setValue(guvenliHucreDegeri(yeniPin));
      return { success: true, message: `${adSoyad} bilgileri güncellendi.` };
    }
  }
  return { success: false, message: "Öğrenci bulunamadı." };
}

function ogrenciSil(ss, params) {
  const ogretmen = dogrulaOgretmen(ss, params.pin || params.sifre);
  if (!ogretmen) return { success: false, message: "Yetkisiz işlem!" };

  const ogrenciId = String(params.ogrenciId || "").trim();
  const ogrSayfa = ss.getSheetByName(TABLO_ISIMLERI.OGRENCILER);
  const ogrData = ogrSayfa.getDataRange().getValues();

  for (let i = 1; i < ogrData.length; i++) {
    if (String(ogrData[i][0]) === ogrenciId) {
      if (!ogrenciOgretmeneAitMi(ss, ogrenciId, ogretmen)) {
        return { success: false, message: "Bu öğrenci sizin sınıfınıza ait değil!" };
      }
      ogrSayfa.getRange(i + 1, 5).setValue("Hayır");
      return { success: true, message: "Öğrenci sınıf listesinden kaldırıldı." };
    }
  }
  return { success: false, message: "Öğrenci bulunamadı." };
}

// ============================================================================
// YARDIMCI FONKSİYONLAR
// ============================================================================

function dogrulaOgretmen(ss, girilenPin) {
  const temizPin = String(girilenPin || "").trim();
  if (!temizPin) return null;

  const ogretmenler = getOgretmenlerListesi(ss);
  for (let i = 0; i < ogretmenler.length; i++) {
    if (ogretmenler[i].pin === temizPin) {
      return ogretmenler[i];
    }
  }
  return null;
}

function getOgretmenlerListesi(ss) {
  const ogrtSayfa = ss.getSheetByName(TABLO_ISIMLERI.OGRETMENLER);
  if (!ogrtSayfa) return [];

  const data = ogrtSayfa.getDataRange().getValues();
  const liste = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][4]).toLowerCase() !== "pasif" && data[i][1]) {
      liste.push({
        id: String(data[i][0]),
        adSoyad: String(data[i][1]),
        sinif: String(data[i][2]),
        pin: String(data[i][3])
      });
    }
  }
  return liste;
}

function getKitapHavuzu(ss, sinifFiltre, sadeceAktifTarihliler) {
  const havuzSayfa = ss.getSheetByName(TABLO_ISIMLERI.KITAP_HAVUZU);
  if (!havuzSayfa) return [];

  const bugun = bugunTarihStr();
  const data = havuzSayfa.getDataRange().getValues();
  const havuz = [];

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][5]).toLowerCase() !== "pasif" && data[i][1]) {
      const kitapSinif = data[i][6] ? String(data[i][6]).trim() : "Ortak";
      if (sinifFiltre && kitapSinif !== "Ortak" && kitapSinif !== sinifFiltre) {
        continue;
      }

      let aktifTarih = "";
      if (data[i][7]) {
        if (Object.prototype.toString.call(data[i][7]) === "[object Date]") {
          aktifTarih = Utilities.formatDate(data[i][7], "GMT+3", "yyyy-MM-dd");
        } else {
          aktifTarih = String(data[i][7]).trim().slice(0, 10);
        }
      }

      if (sadeceAktifTarihliler && aktifTarih && aktifTarih > bugun) {
        continue;
      }

      havuz.push({
        kitapId: String(data[i][0]),
        kitapAdi: String(data[i][1]),
        yazar: String(data[i][2]),
        sayfaSayisi: Math.max(1, Number(data[i][3]) || 1),
        tur: String(data[i][4] || "Genel"),
        sinif: kitapSinif,
        aktifTarih: aktifTarih
      });
    }
  }
  return havuz;
}

function getAyarlar(ss) {
  const ayarSayfa = ss.getSheetByName(TABLO_ISIMLERI.AYARLAR);
  const ayarlar = {
    AdminKullanici: "admin",
    AdminSifre: "admin123",
    KulupBaraji: 3,
    SinifAdi: "3-A Sınıfı"
  };

  if (!ayarSayfa) return ayarlar;

  const data = ayarSayfa.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const key = String(data[i][0]).trim();
    const val = data[i][1];
    if (key) ayarlar[key] = val;
  }
  return ayarlar;
}

function jsonYanit(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
