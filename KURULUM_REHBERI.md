# 📚 3. Sınıf Kitap Kurtları - Kolay Kurulum Rehberi

Bu sistem; **Google E-Tablolar (Sheets)** altyapısını ücretsiz veritabanı olarak kullanan, öğretmenin belirlediği **Dijital Kitap Havuzu** üzerinden öğrencilerin tek tıkla okuma bildirimi yaptığı, veliler için sıfır sürtünmeli (yalnızca 4 haneli PIN ile girilen) ve akran zorbalığını engelleyen modern bir sınıf okuma takip web uygulamasıdır.

---

## 🚀 5 Dakikada Adım Adım Kurulum

### Adım 1: Yeni Bir Google E-Tablo Oluşturun
1. [Google Drive](https://drive.google.com)'a girin ve boş bir **Google E-Tablo** (Sheets) açın.
2. Tablonun adını örneğin **"3-A Sınıf Kitaplığı"** yapın.
3. *(Sayfaları veya sütunları elle girmenize gerek yoktur; sistem kodumuz her şeyi otomatik oluşturacaktır.)*

---

### Adım 2: Apps Script Kodunu Ekleyin
1. E-tablonun üst menüsünden **Uzantılar (Extensions) > Apps Script** seçeneğine tıklayın.
2. Açılan kod editöründeki varsayılan kodları silin.
3. Proje klasörümüzdeki [`google-apps-script.js`](./google-apps-script.js) dosyasının tüm içeriğini kopyalayıp buraya yapıştırın.
4. Üstteki **Kaydet (Disk simgesi / Ctrl+S)** butonuna basın.

---

### Adım 3: Tabloları Otomatik Kurun (Tek Tıkla)
1. Apps Script ekranının üst tarafındaki fonksiyon açılır kutusundan **`ilkKurulum`** seçeneğini seçin.
2. **Çalıştır (Run)** butonuna basın.
3. Google ilk seferde yetkilendirme izni isteyecektir:
   * *Gelişmiş (Advanced) > ... uygulamasına git (Güvenli değil / Unsafe)* adımlarını onaylayın.
4. E-tablonuza geri döndüğünüzde şu sayfaların otomatik oluştuğunu göreceksiniz:
   * **`Ogretmenler`:** Admin tarafından tanımlanan öğretmenler, bağlı oldukları sınıflar (örn: `3-A Sınıfı`, `3-B Sınıfı`) ve öğretmen giriş PIN kodları.
   * **`KitapHavuzu`:** Öğretmenin belirlediği kitap listesi (Örn: Küçük Prens, Şeker Portakalı, Charlie'nin Çikolata Fabrikası, Matilda vb.).
   * **`Ogrenciler`:** Öğrenci isimleri, numaraları, bağlı oldukları sınıf ve 4 haneli giriş PIN'leri.
   * **`OkunanKitaplar`:** Öğrencilerin bildirdiği ve sınıf öğretmeninin onayladığı okuma hareketleri.
   * **`Ayarlar`:** Admin kullanıcı adı (`admin`), Admin şifresi (`admin123`) ve aylık kulüp hedef barajı (`3`).

---

### Adım 4: Web Uygulaması Olarak Dağıtın (Yayınlayın)
1. Apps Script ekranında sağ üstteki mavi **Dağıt (Deploy) > Yeni Dağıtım (New deployment)** butonuna tıklayın.
2. Sol taraftaki dişli çark simgesinden tür olarak **Web uygulaması (Web app)** seçin.
3. Ayarları şu şekilde yapın:
   * **Açıklama:** `Kitap Kurtları v3 (Admin & Çoklu Öğretmen)`
   * **Web uygulamasını şu kullanıcı olarak çalıştır:** `Ben (e-posta adresiniz)`
   * **Kimlerin erişimi var (Who has access):** `Herkes (Anyone)` *(Çok önemli! Velilerin Google hesabı ile oturum açmak zorunda kalmaması için bu seçenek seçilmelidir.)*
4. **Dağıt (Deploy)** butonuna basın.
5. Ekranınıza gelen **Web Uygulaması URL'sini (Web app URL)** kopyalayın. *(Şuna benzer: `https://script.google.com/macros/s/.../exec`)*

---

### Adım 5: Web Sayfasını Açın ve API Adresini Yapıştırın
1. Proje klasöründeki [`index.html`](./index.html) dosyasını herhangi bir tarayıcıda çift tıklayarak açın.
2. Sağ üstteki **⚙️** (Ayarlar) simgesine tıklayın.
3. Kopyaladığınız Web Uygulaması URL'sini yapıştırıp **"Kaydet"** butonuna basın.
4. Tebrikler! Sisteminiz tamamen canlı ve Google E-Tablonuz ile senkronize çalışıyor! 🎉

---

## 🎯 Yeni Sistem Nasıl İşliyor?

1. **🛡️ Sistem Yöneticisi (Admin):**
   * Üst menüdeki **"🛡️ Admin"** sekmesine tıklar; kullanıcı adı (`admin`) ve şifresi (`admin123`) ile giriş yapar.
   * Sisteme yeni **Öğretmen Adı Soyadı**, **Bağlı Olduğu Sınıf** (örn: `3-A Sınıfı`) ve **Öğretmen PIN Kodu** (örn: `1234`) tanımlar.
2. **👩‍🏫 Öğretmen:**
   * Üst menüdeki **"👩‍🏫 Öğretmen"** sekmesine tıklar ve Admin'in kendisine verdiği **PIN Kodu** ile giriş yapar.
   * Sadece kendi sınıfındaki öğrencileri, okuma ilerlemelerini ve onay bekleyen kitapları görür; sınıfına yeni öğrenci ve kitap ekleyebilir.
   * Kütüphaneye kitap eklerken **"Kütüphanede Aktif Olacağı Tarih"** seçebilir; ileri tarihli eklenen kitaplar öğretmen panelinde `⏳ ... tarihinde açılacak` rozetiyle görünür ve öğrencilere yalnızca o tarih geldiğinde açılır.
3. **👧 Öğrenci & Veli:**
   * 4 haneli öğrenci PIN kodu ile girer (Örn: `1234`).
   * Kendi sınıfının aktif tarihi gelmiş kitaplarını görür; okuduğu kitabın kaldığı sayfasını veya bitirdiğini tek tıkla bildirir.
