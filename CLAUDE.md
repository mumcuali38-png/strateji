# MASTER PROMPT — "Strateji Radar" Tablet Uygulaması

> Bu dosya hem Claude Code'a verilecek görev tanımıdır hem de depodaki tek doğruluk kaynağıdır.
> Depoya `CLAUDE.md` adıyla da kopyala; her oturumda bu kurallar geçerlidir.
> Kural değişirse önce bu dosya güncellenir, sonra kod.

---

## 0. GÖREV

`mumcuali38-png/strateji` deposunda, aşağıda tanımlanan **5 trading stratejisini (A, B, C, D, E)** otomatik izleyen, **Android tablete PWA olarak kurulan**, kapalıyken bile **bildirim gönderen** bir uygulama yap.

- Depo **public**, uygulama **GitHub Pages**'te yayınlanır.
- Tarama **GitHub Actions**'ta çalışır; uygulama veri çekmez, Actions'ın ürettiği JSON'ları okur.
- Arayüz dili **Türkçe**. Tüm saatler kullanıcıya **Türkiye saati (UTC+3)** ile gösterilir.
- Uygulama **sinyal ve durum gösterir, işlem açmaz.** Karar her zaman kullanıcınındır. Bu ibare Ayarlar > Hakkında bölümünde yazsın.
- Kodlarken belirsiz bir kural görürsen **varsayılanı uygula, parametre yap, Ayarlar'dan değiştirilebilir bırak** ve `KARARLAR.md` dosyasına not düş. Kullanıcıya soru sorma; bitince listele.

---

## 1. ORTAK KURALLAR (tüm stratejiler)

### 1.1 Saat
- Strateji hesaplarının saati **sabit UTC-5 (New York)**. Yaz saatine göre kaydırma yapılmaz. (Mart'ta NY yaz saatine geçince sabit UTC-5 bir saat kayar; bu bilinçli bir karar. Uygulama Mart–Kasım arası Ayarlar'da küçük bir uyarı gösterir.)
- Gösterim: Türkiye saati (UTC+3). Gerektiğinde yanında NY saati.
- Dönüşüm: NY (UTC-5) + 8 saat = TR.
- Twelve Data'ya **her istekte `timezone=UTC`** gönder; dönen mumları kendin UTC-5'e çevir. (Testte XAU mumları UTC+11, QQQ mumları NY borsa saatiyle geldi; varsayım yapma.)
- 4H mumlar UTC-5 gece yarısından itibaren hizalanır: 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 (NY).

### 1.2 Killzone'lar (UTC-5 → TR)
| Killzone | NY | TR |
|---|---|---|
| London Open | 02:00–05:00 | 10:00–13:00 |
| NY Open | 07:00–10:00 | 15:00–18:00 |
| London Close | 10:00–12:00 | 18:00–20:00 |

Asya seansı, CBDR, öğle arası ve killzone dışı: **işlem yok** (A/B/E için). C ve D kendi pencerelerini kullanır.

### 1.3 Risk ve pozisyon
- Risk: işlem başına hesabın **%0.5**'i (Ayarlar'dan değiştirilebilir, varsayılan 0.5).
- Minimum RR **1:2**. Hedef 1:2'nin altındaysa setup **TAM sayılmaz**.
- Lot hesabı: `lot = (bakiye × risk%) / (stop_mesafesi_fiyat × kontrat_büyüklüğü)`
- Kontrat büyüklükleri (Ayarlar'da düzenlenebilir varsayılanlar):
  - XAU/USD: 100 oz/lot · XAG/USD: 5000 oz/lot · EUR/USD, GBP/USD: 100.000/lot
  - BTC/USD, ETH/USD: 1 coin/lot · US100 CFD: 1 $/puan/lot
- Stop'a **spread + tampon** eklenir. Varsayılan tampon: XAU 0.30 $, XAG 0.02 $, FX 1.5 pip, BTC 0.05%, ETH 0.05%, US100 3 puan. (Ayarlar'dan.)
- Mesafeler dolar/fiyat cinsinden konuşulur; "pip" kullanılırsa XAU'da brokera göre 0.01 veya 0.10 olabileceği notu Ayarlar'da yazsın.

### 1.4 Mum kapanışı kuralı
CHoCH, BOS, breaker, mitigation, MSS ve fake-out dönüşü için **o zaman diliminde mum kapanışı şart**. Sadece iğne veya alt zaman dilimi kapanışı geçmez. Henüz kapanmamış (canlı) mum hiçbir şartı sağlamaz; bu şartlar ⏳ gösterilir.

---

## 2. TEKNİK TANIMLAR (algoritmik — kod bunlara göre yazılır)

Tüm tanımlar her zaman dilimi için ayrı hesaplanır. Parametreler `config/params.json` dosyasında, Ayarlar'dan değiştirilebilir.

- **Swing high/low (fraktal):** Bir mumun high'ı solundaki `n` ve sağındaki `n` mumun high'ından büyükse swing high (low için tersi). Varsayılan `n`: 1m/3m/5m = 2, 15m = 2, 1H = 3, 4H = 3, 1D = 2.
- **BOS:** Trend yönünde son swing'in **mum kapanışıyla** kırılması.
- **Trend:** Art arda en az **2 BOS = trend**, **3 BOS = güçlü trend**. 2'den az ise "trend net değil".
- **CHoCH / MSS:** Trend tersine, trendi oluşturan son karşı swing'in mum kapanışıyla kırılması. (MSS = displacement ile oluşan CHoCH.)
- **Displacement:** Gövdesi, son 20 mumun ortalama gövdesinin **≥ 1.5 katı** olan, kırılım yönünde mum.
- **Order Block (OB):** BOS/CHoCH'a sebep olan güçlü (displacement) hareketten hemen önceki son ters renkli mum (veya ardışık ters renkli mumlar). Bölge: o mum(lar)ın high–low aralığı. **Mitige edilmemiş** olmalı (fiyat sonradan bölgeye girmemiş).
- **FVG:** Üç mumlu yapıda 1. mumun high'ı ile 3. mumun low'u arasındaki boşluk (bullish), tersi bearish. Mitige edilmemiş FVG geçerli. Bölgenin %50'si "CE".
- **IFVG:** Kırılıp ters tarafa geçen (mum kapanışıyla içinden geçilen) FVG; ters yönde destek/direnç olur.
- **Breaker:** Likidite alıp ardından kırılan (CHoCH ile geçersizleşen) OB; ters yönde bölge olur.
- **ICT mitigation block:** Displacement ile kırılıp geçilen bir OB; fiyat geri döndüğünde ters yönde destek/direnç. Ek bölge türüdür. "Mitigation" (onay türü) ile aynı şey değildir.
- **Likidite:** Eşit tepe/dip (tolerans: o TF'nin ATR(14)'ünün %10'u), belirgin swing uçları, önceki gün/hafta high-low, 4H mum high-low.
- **Likidite süpürmesi (sweep):** Fiyatın likidite seviyesini **iğneyle** geçip **gövdeyle geri dönmesi** (mum seviyenin dışında kapanmaz).
- **Konsolidasyon:** Son 20 mumda 2'den az BOS ve range yüksekliği < ATR(14) × 3.
- **ATR:** 14 periyot. **EMA 50 (4H)** yön filtresi.

---

## 3. KURULUM A — 4H Mum Fake-out (XAU/USD)

**Fikir:** Fiyat son tamamlanmış 4H mumunun tepesini veya dibini 5m'de kapanışla dışarı çıkıp, tekrar kapanışla içeri girerse, içeri kapanışta işleme girilir.

**Şartlar (uygulamadaki şart tablosu bu sırayla):**
1. **4H trend / filtre:** Yükselişte sadece long (alt çizgiden), düşüşte sadece short (üst çizgiden). Konsolidasyonda iki uç da kullanılabilir. Trend net değilse YOK.
2. **4H 50 EMA:** Fiyat EMA 50 üstündeyse sadece long, altındaysa sadece short. Yapı ile EMA çelişirse YOK.
3. **Çizgiler:** Son tamamlanmış 4H mumunun en üst ve en alt iğne ucu. Açık (canlı) mum kullanılmaz.
4. **Killzone içinde mi?** (London Open / NY Open / London Close)
5. **Dışarı kapanış (5m):** Çizginin dışına büyük ve güçlü gövdeli bir 5m mumla kapanış.
6. **İçeri kapanış (5m):** Ardından yine güçlü gövdeli bir 5m mumla çizginin içine kapanış. → **Giriş bu mumun kapanışı.**
7. **Stop:** Dışarıdaki hareketin en uç noktası (iğne ucu dahil) + spread/tampon.
8. **Hedef:** En yakın likidite. RR ≥ 1:2.
9. **Haber riski yok.**

**Geçersiz:**
- Sadece iğneyle dışarı çıkma veya sadece iğneyle geri dönme.
- Küçük gövdeli çıkış/dönüş mumları (displacement değil).
- Fiyatın dışarıda uzun süre (varsayılan > 6 adet 5m mum) oyalanması veya çok uzağa (> 1×ATR(14,1H)) gidip geç dönmesi.
- Çizginin bir sonraki 4H mumda, en geç 2. mumda alınmaması → çizgi silinir.
- Aynı çizginin ikinci kez kullanılması. Her çizgi **tek kullanımlık**.
- Sweep veya dönüş killzone dışında.

**"1 şart kaldı" örneği:** "XAU A: 4H low dışında 5m kapanış oldu, içeri güçlü kapanış bekleniyor."

---

## 4. KURULUM B — HTF Bölge + Likidite + LTF Onay (XAU/USD)

**Fikir:** Fiyat trend yönündeki HTF bölgeye gelir, önündeki likiditeyi alır, LTF'de kapanışlı CHoCH/breaker oluşursa girilir. Onaysız bölgeye emir konmaz.

**1. HTF bölge (4H / 1H):**
- **Öncelik OB/FVG'de.** Likidite tek başına bölge değil, OB/FVG'nin önündeki tetikleyicidir.
- OB: BOS'a sebep olan güçlü hareketten hemen önceki son ters renkli mum(lar), mitige edilmemiş.
- FVG: HTF CHoCH veya BOS bacağında kalan, mitige edilmemiş FVG.
- ICT mitigation block: ek bölge türü.
- **Güçlendiriciler (puan):** OB'yi oluşturan swing daha önce bir likidite aldıysa +1; OB bir BOS'a sebep olduysa +1; range/konsolidasyon dışına çıkış noktasındaki OB +1; HTF bölgede RSI uyumsuzluğu +1 (zorunlu değil). Puan, kart üzerinde ★ olarak gösterilir.
- **Yakın likidite:** OB/FVG'nin hemen önünde, ona yapışık olmayan ama çok uzak da olmayan (varsayılan: bölgeye 0.2–1.5 × ATR(14, o TF) mesafede) en az 1 likidite seviyesi.

**2. Bölgeye geliş:** Fiyat önce likiditeyi alır, sonra OB/FVG'ye iner/çıkar. Onay likiditede oluşursa oradan girilebilir; onay yoksa likiditede girilmez.

**3. LTF onayı:** Bölge alındıktan sonra trend yönünde **CHoCH, breaker veya mitigation**, yapı çizgisinin ötesinde **mum kapanışıyla**. Ek onay: IFVG.

**Onay TF eşleşmesi:**
| HTF bölge | Onay TF |
|---|---|
| Haftalık | 4H breaker/CHoCH |
| Günlük | 1H |
| 4H | 15m (limit emir 5m'de inceltilir) |
| 1H | 5m |
5m altına inilmez.

**Zamanlama:** Onay, bölge alındığı anda olmalı. Bölge onaysız delinirse (kapanışla geçilirse) o bölgeden girilmez, bölge silinir; bir sonraki bölgede yeniden onay aranır.

**Geçersiz onaylar:**
- Bölge veya likidite alınmadan oluşan CHoCH (fake).
- Bölgeye gelmeden ya da bölgeden çok uzaklaştıktan (> 1×ATR) sonra veya saatler sonra (> 12 adet onay-TF mumu) oluşan breaker.
- Grafiğin rastgele yerinde, önemli bölgeye bağlı olmayan breaker.
- Long bölgesinde short yönlü breaker/CHoCH ve tersi.
- Çok geniş, dağınık mitigation yapıları (yükseklik > 1.5×ATR).
- Kapanış olmadan sadece iğneyle kırılan yapı.

**Şart tablosu sırası:** Trend · 4H EMA50 · HTF bölge (OB/FVG) · Yakın likidite · Likidite alındı mı · Bölgeye temas · LTF kapanışlı onay · Killzone · RR ≥ 2 · Haber.

---

## 5. GİRİŞ YÖNTEMLERİ (A ve B)

B'nin **varsayılan girişi**: kırılan swing çizgisine geri dönüşte **limit emir**. Yapıda daha iyi RR veren temiz bir FVG/IFVG veya OB varsa o kullanılır. A'da içeri kapanışta piyasa emri.

| Yöntem | Nereye | Tipik RR | Dolma | Ne zaman |
|---|---|---|---|---|
| Breaker retest (B varsayılan) | Kırılan swing çizgisi | ~1:2–3 | Yüksek | Her B onayından sonra ilk tercih |
| Kapanışta piyasa emri | Onay/dönüş mumunun kapanışı | ~1:2 | Kesin | A; veya momentum çok güçlü, geri dönüş beklenmiyorsa |
| FVG/IFVG geri çekilme | Yapıdaki FVG'nin sınırı | ~1:3 | Orta | FVG retest daha iyi RR veriyorsa |
| LTF order block | 5m/15m OB sınırı | ~1:8+ | Düşük (10'da 2-3) | Belirgin, taze LTF OB varsa |
| OB %50 (EQ) | LTF OB orta seviyesi | ~1:17 | Çok düşük | Nadiren, küçük pozisyonla |

- Limit emirde hedef sabit, giriş geri çekildikçe RR artar.
- A'da da aynı mantık: içeri kapanış yerine geri çekilmeye limit konabilir.
- HTF OB bölgeyi belirler, LTF OB giriş emrini belirler; karıştırılmaz.
- Setup kartı **varsayılan yöntemi** gösterir; kart üzerinde diğer yöntemlere geçiş sekmesi olur (giriş/stop/RR/lot otomatik yeniden hesaplanır).

---

## 6. STOP, HEDEF, YÖNETİM (A ve B)

- **Stop:** A'da fake-out hareketinin en uç noktası; B'de breaker/CHoCH yapısının en alt (short'ta en üst) noktası. + spread + iğne payı. Stop dolar mesafesine göre değil, yapıya göre konur.
- **Hedef:** İşlem yönündeki en yakın likidite. 1:2 altıysa işlem yok. Daha büyük hareket bekleniyorsa HTF'deki önemli seviye hedeflenebilir (kartta "TP2" olarak).
- **Karşı bölge:** Hedefe giden yolda karşı trendin önemli bir bölgesi varsa kâr orada erken alınır (kartta uyarı).
- **Ek pozisyon:** İlk işlem kârdayken yeni bir BOS oluşursa, o BOS bacağındaki ilk mitige edilmemiş FVG'ye limitle ikinci pozisyon. Stop son swing'in biraz ötesine.
- **Spread:** Stop biraz geniş, kâr biraz erken. Fiyat hedefe değdiği halde emir kapanmazsa manuel kapatılır.

---

## 7. İŞLEM YAPMAMA KURALLARI (A ve B)

Aşağıdakilerden biri varsa durum **YOK**, ne kadar iyi görünürse görünsün:
- 4H trend net değil veya kurulum trende ters (konsolidasyon hariç).
- Killzone dışı saat (Asya, CBDR, öğle arası).
- Yüksek etkili haber anı (FOMC, NFP, CPI) ve hemen öncesi/sonrası (−30 dk / +15 dk).
- HTF'de karşı yönde önemli bir bölge veya likidite hemen önünde (< 1:2 mesafede).
- Onay mum kapanışıyla gelmedi, sadece iğne.
- Bölge daha önce kullanıldı veya 4H çizgisi 2 mum içinde alınmadı.
- Hedef 1:2'nin altında.
- 5m altında (1m) onay aranıyor.

---

## 8. EK TEYİT İNDİKATÖRLERİ (A, B, D, E için; C'de yok)

Bunlar **sadece ek teyit**, ana stratejiden bağımsız. Bir kurulumu ne geçerli ne geçersiz yapar. Kartta en altta "Ek teyit: Var / Yok / Ters" olarak gösterilir.

| İndikatör | Ayar | Kullanım |
|---|---|---|
| RSI bantları | RSI 12, 70/30 | Bölge bant uçlarına denk geliyorsa artı |
| VWAP | Günlük (NY 00:00 reset) | Long VWAP üstünde, short altında artı |
| EMA 200 | 5m | Fiyatın EMA 200'e göre konumu |
| MACD | 12, 26, 9 | Histogramın kurulum yönüne dönmesi |
| Squeeze Momentum | BB 20/2, KC 20/1.5 | Momentum rengi ve sıkışma çözülmesi (siyah nokta = sıkışma) |

- MMC ULTRA'nın **BUY/SELL ve EXIT sinyalleri asla kullanılmaz**; uygulamada da hesaplanmaz.
- 4H 50 EMA yön filtresi ve RSI uyumsuzluğu ana stratejinin parçasıdır; bu tablodan ayrıdır.

---

## 9. KURULUM C — Nasdaq 10 AM (TNM)

Ayrı strateji. Enstrüman NAS100/US100 CFD; veri **QQQ** (Twelve Data endeksi vermiyor). A/B kuralları (4H EMA50, 5m altı yasağı, killzone'lar, indikatör teyitleri) **C'ye uygulanmaz**; C saf ICT'dir.

| Adım | Kural |
|---|---|
| 1. Bias | Daily yapı ve daily FVG'den yön, ardından 4H'te merdiven (stairs) yapısıyla teyit. Bias'a ters TNM işlemi yok. |
| 2. PD array'ler | Daily FVG, 4H OB, taze rejection block'lar, MSS seviyeleri, eşit tepe/dip likidite, NY 18:00 ve 00:00 açılışları işaretlenir. |
| 3. TNM | NY 10:00'da açılan 4H mum işaretlenir; 4H mumdan **OTE 0.5** çekilir. İlk hareketin bias'a ters bir PD array'e veya likiditeye iğne atması (manipülasyon) beklenir. |
| 4. Onay | Manipülasyon sonrası **1m/3m**'de bias yönünde MSS veya breaker, **mum kapanışıyla**. (3m, 1m'den üretilir.) |
| 5. Giriş | MSS sonrası geri çekilmede FVG, breaker veya rejection block. TNM'ye kör limit atılmaz. |
| 6. Stop | Breaker / rejection block'un ötesi (yapıya göre). |
| 7. Hedef | TP1: en yakın likidite veya FVG orta noktası. TP2: STDV −2 / −4 projeksiyonu (MSS bacağı üzerinden). Min 1:2. TP1 sonrası yeni yapı oluşunca stop başa başa. |
| Saat | Sadece 10:00–11:00 NY (UTC-5) = **18:00–19:00 TR**. |
| Risk | %0.5, **günde en fazla 1 işlem**. |

- **Rejection block kuralı:** Taze ve bir OB/FVG ile çakışan RB daha güçlüdür. RB mumunun rengi işlem yönüyle aynı olmalı (long için bullish kapanış). Volume imbalance dahil edilir.
- **Limit iptali:** Fiyat 4H mumun OTE 0.5 seviyesine dokunmadan yeni tepe/dip yaparsa emir silinir.
- **Geçersiz:** Manipülasyon olmadan TNM'de direkt giriş; bias'a ters MSS; 11:00 NY sonrası giriş; günün ikinci işlemi.
- **Fiyat dönüşümü:** Seviyeler QQQ fiyatıdır. Ayarlar'da "US100 güncel fiyatı" alanı varsa oran (US100/QQQ) ile çevrilip yanında gösterilir; yoksa QQQ + yüzde mesafe gösterilir.
- Pencere dışında: açılış saatine kalan süre ve izlenecek seviyeler gösterilir.

---

## 10. KURULUM D — Range (US100, XAU/USD, GBP/USD, BTC/USD, ETH/USD — XAG kaldırıldı, bkz. §23)

İki alt model, her paritede ayrı hesaplanır. A/B/C'den bağımsız. US100 için QQQ kullanılır; seviyeler QQQ fiyatı + yüzde mesafe.

### D1 — Açılış range'i (ORB)
| Adım | Kural |
|---|---|
| Range | NY **09:30–09:35** (UTC-5) ilk 5m mumunun high ve low'u (TR 17:30–17:35). Tüm paritelerde NY açılışı esas. |
| Yön | 1m mumun range high üstünde veya range low altında **kapanması**. Kırılım mumu momentum mumu olmalı (gövde ≥ mum boyunun %50'si). Bias/gösterge yok. |
| Giriş | Kırılımda girilmez. Fiyat kırılan seviyeye geri döner, seviyede 1m **red** (iğne/çekiç, ters yönde kapanış yok) gelir; red mumunun kapanışında giriş. |
| Stop | Red/retest mumlarının uç noktası + tampon. |
| Hedef | Min 1:2. Önce en yakın likidite, günün high/low'u veya tam/psikolojik sayı. |
| Pencere | Giriş 09:35–11:00 NY (**17:35–19:00 TR**). |
| İptal | Retestte fiyat 1m kapanışla range içine geri girerse o taraf iptal; karşı tarafta kırılım+retest bir kez daha aranabilir. İki taraf da fake-out verirse gün chop sayılır, D1 biter. |
| Limit | Parite başına günde en fazla 1 D1 işlemi. |

### D2 — Konsolidasyon range'i
| Adım | Kural |
|---|---|
| Geçerlilik | 1H veya 4H'te her iki uçta en az 2 red (2 test), veya trendin iki kez yeni tepe/dip yapamaması. Range high, EQ (0.5) ve range low işaretlenir; uçlar çizgi değil **bölgedir** (uç mumların gövde–iğne arası). |
| Yön tercihi | Range'den önceki trend belirler: yükselişten sonra alt uçtan long, düşüşten sonra üst uçtan short. Önceki trend yoksa iki uç da kullanılır. |
| Geniş range (dönüş) | Sadece uçlarda işlem, ortada asla. Uçtaki likidite süpürülür, ardından LTF onay: 1H range → 5m, 4H range → 15m CHoCH/breaker/IFVG kapanışı. Giriş kırılan swing'in retestinde limit. |
| Dar range | Range yüksekliği o TF'nin ATR(14)'ünün **1.5 katından azsa** dönüş işlemi yok, sadece kırılım. |
| Çıkış (kırılım) | Range dışında tek mum kapanışı yetmez: dışarıda momentum kapanışı → geri çekilme → geri çekilmenin swing'inin ötesinde yeni kapanış. Kırılan uç flip seviyesi olur; retestte kırılım yönünde giriş. Öncelik önceki trend yönündeki kırılımda. |
| Stop | Dönüşte süpürme iğnesinin ötesi + tampon; kırılımda flip retest swing'inin ötesi. |
| Hedef | Dönüşte TP1 EQ / range içi imbalance, TP2 karşı uç likiditesi (min 1:2 TP2'ye göre). Kırılımda range yüksekliği kadar projeksiyon veya sonraki HTF likidite, min 1:2. |
| Kullanılmaz | Range içindeki FVG'ler giriş için kullanılmaz; range dışındaki FVG/OB/likidite uçla çakışırsa artı. Haber anı ve çok sıkışık/dağınık range'de işlem yok. |
| Ek güç | Range ucunda RSI uyumsuzluğu (zorunlu değil). |

Ortak: risk %0.5, saat UTC-5, haber kuralları aynı.

---

## 11. KURULUM E — Rejection Block (EUR/USD, XAU/USD, GBP/USD)

Günlük bias yönünde, 1H/4H'te bir swing ucunda iğneyle süpürüp gövdesi range içinde kapanan mumun iğne bölgesine fiyat geri döndüğünde, 5m/3m MSS ile girilir. A/B/C/D'den bağımsız.

| Adım | Kural |
|---|---|
| 1. Günlük bias | Daily yapının yönü (son daily BOS yönü; önceki günün high/low'undan hangisinin alındığı). Bias net değilse işlem yok. Sadece bias yönünde: bullish bias → bullish RB, bearish bias → bearish RB. |
| 2. RB oluşumu | İki şart birlikte: (a) bias yönlü bir HTF PD array'e temas (OB, FVG, key open, Fib 78.6–88.6, opening gap) ve (b) hemen önündeki dinlenen likiditenin (eşit high/low, belirgin swing ucu) süpürülmesi. Süpürme **sadece iğneyle** olur; gövde seviyenin ötesinde kapanırsa RB değil (breaker'a dönüşebilir). Rastgele iğneler sayılmaz. |
| 3. Bölge | Bearish RB: süpürme bölgesindeki en yüksek gövde (open/close) ile iğne tepesi arası. Bullish RB: en düşük gövde ile iğne dibi arası. Birden fazla mumdan oluşabilir; en uç gövde ve en uç iğne alınır (en fazla 3 mum). Gövde seviyesi = giriş referansı, iğne ucu = stop referansı. |
| TF eşleşmesi | Günlük bölge → 1H RB · 4H bölge → 15m RB · 1H bölge → 5m RB · 15m/5m bölge → 1m RB. Kırılım RB'nin TF'sinde veya bir altında okunur. |
| 4. Teyit (zorunlu) | RB mumu ters renkte kapanmalı: bearish RB = üstte kalın iğne + kırmızı kapanış; bullish RB = altta kalın iğne + yeşil kapanış. Ardından alt TF'de kırılım (MSS/CISD) şart: kırılım yoksa işlem yok. 4H RB, 1H'ten güçlüdür. |
| 5. Bekle | İlk ters hareketi kovalamak yok. Kırılımdan sonra fiyatın RB bölgesine (gövde seviyesine) geri dönmesi beklenir. Dönmezse işlem yok, kovalanmaz. Güçlü tek yönlü trendde RB nadiren işler; önünde konsolidasyon olan bölgeler tercih edilir. |
| 6. Giriş | **Standart (varsayılan):** kırılımdan sonra RB'nin gövde kenarına limit (bearish: kutunun alt kenarı, bullish: üst kenarı), ya da bölgeye temasta 5m/3m'de bias yönünde MSS/CISD kapanışı. **Agresif** (sadece 2a+2b birlikte, killzone içinde, min 1:2): RB mumunun ters kapanışında 1m/5m'de direkt giriş, stop iğne ucunun ötesi. Agresif girişler kartta "AGRESİF" etiketiyle gösterilir. |
| Giriş inceltme | "RB içinde RB": HTF RB (4H/1H) bölgesine gelindiğinde 15m → 5m → 3m → 1m'de bölge içinde oluşan küçük RB aranır; giriş bu küçük RB'den, stop küçük RB'nin iğne ucunun ötesine (RR büyür). Limit seviyesi: RB gövde kenarından **%10–25 içeri**. Aynı seviye 2 kez tepki verip 3. teste geliyorsa 3. testteki iğne RB güçlü adaydır. |
| Yönetim | İlk iç likidite alınıp yön yeni kırılım yapınca stop girişe (BE). Sonra stop oluşan yeni FVG/OB'lerin ötesine taşınır. Fiyat koruma FVG'sinin ötesinde gövde kapatırsa kısmi kapanış / lot düşür. Hedefe yaklaşınca kademeli çıkış serbest. İşlemden önce günün haberleri kontrol edilir. |
| 7. Stop | İğnenin en uç noktasının ötesi + tampon (iğne içine stop konmaz). |
| 8. Hedef | Bir sonraki draw on liquidity: en yakın swing high/low veya eski high/low. Min 1:2 (hedef 1:2–1:3). |
| Saat | London Open (02:00–05:00 NY = 10:00–13:00 TR) ve NY AM (07:00–10:00 NY = 15:00–18:00 TR). Asya ve öğle arası yok. |
| Geçersiz | Bias'a ters RB; süpürülmemiş/önemsiz seviyedeki iğne; fiyatın RB iğne ucunun ötesinde gövde kapatması (bölge tükendi); daha önce test edilip tepki vermiş (kullanılmış) RB; haber anı. |
| Risk | %0.5. |

Uygulamada her parite için aktif (taze) RB'ler, mesafe, bias uyumu ve giriş şartının durumu listelenir.

---

## 12. HABER

- **Takvim:** Forex Factory haftalık takvim JSON (`https://nfs.faireconomy.media/ff_calendar_thisweek.json`). **Saatte bir** çekilir (daha sık değil; engellenebilir). Önbelleğe alınır; çekilemezse son kopya kullanılır ve arayüzde "takvim eski" uyarısı çıkar.
- **Filtre:** Sadece **kırmızı (High)**; para birimleri USD, EUR, GBP. Turuncu (Medium) haberler panelde soluk gösterilir, bildirim atmaz.
- **Kapsam:** USD verileri (CPI, NFP, FOMC, PCE, PPI, işsizlik başvuruları), Fed konuşmaları. Nasdaq için büyük teknoloji bilançoları (FMP varsa).
- **FMP (yedek/ek):** `FMP_KEY` varsa ekonomik takvimden **gerçek değer (actual)** ve haber başlıkları çekilir. Uç nokta erişilemezse sessizce atlanır, panelde "FMP yok" yazar.
- **HABER RİSKİ:** İlgili para birimine kırmızı habere **30 dakikadan az** kaldıysa ve haberden sonraki **15 dakika** boyunca: o enstrümanın tüm setupları YOK'a düşer, sekmede kırmızı şerit çıkar, bildirim atılır.
- Haber–enstrüman eşlemesi: USD → hepsi; EUR → EUR/USD; GBP → GBP/USD.
- Kaynak her satırda belirtilir.

---

## 13. DURUM FORMATI (uygulamanın her sekmesindeki standart)

1. **Durum rozeti:** 🟢 TAM · 🟡 EKSİK (kalan şart sayısıyla, örn. "1 şart kaldı") · ⚪ YOK
2. **Şart tablosu:** Her şart için ✅ / ❌ / ⏳ ve tek satır açıklama (fiyat ve seviye dahil).
3. **TAM ise:** yön, giriş yöntemi, giriş, stop, TP1/TP2, RR, lot, geçersiz olma koşulu.
4. **EKSİK ise:** eksik şart, hangi seviyede / hangi mumla tamamlanır, tamamlanırsa olası giriş-stop-hedef (önizleme).
5. **YOK ise:** neden yok, ne bekleniyor, hangi durumda senaryo biter.
6. **Ek teyit:** Var / Yok / Ters (C hariç).
7. **Haber satırı:** sıradaki ilgili kırmızı haber ve kalan süre.

Kurallara tam uymayan durum **kurulum sayılmaz**; emin olunamayan şart ❌ değil "eksik/⏳" işaretlenir, uydurulmaz.

---

## 14. MİMARİ

```
/            → PWA (statik: index.html, app.js, sw.js, manifest.json, ikonlar)
/scanner     → Node 20 + TypeScript tarayıcı (Actions'ta çalışır)
/config      → params.json, symbols.json, sessions.json
/.github/workflows/scan.yml   → 5 dk'da bir tarama
/.github/workflows/news.yml   → saatte bir haber
/.github/workflows/deploy.yml → Pages yayını
data dalı (branch "data")     → candles/*.json, state.json, history.json, news.json, credits.json
```

- Tarama sonuçları ve mum verisi **`data` dalına** yazılır; dal her seferinde tek commit'e sıkıştırılır (force push) ki depo şişmesin. Uygulama bunları `raw.githubusercontent.com` üzerinden okur (önbellek kırıcı `?t=` ile).
- Gösterge ve yapı hesapları **tarayıcıda (scanner)** yapılır; uygulama sadece sonucu çizer. Mini grafikler için mum verisi de `data` dalından okunur → **ek kredi yok**.
- Scheduled workflow'ların 60 gün hareketsizlikte durmaması için `data` dalına yapılan otomatik commit yeterli; ayrıca ayda bir `keepalive` adımı ekle.
- GitHub Actions zamanlaması birkaç dakika kayabilir; arayüz "son tarama" saatini her zaman gösterir. Son tarama 15 dk'dan eskiyse sarı, 30 dk'dan eskiyse kırmızı uyarı.

---

## 15. TWELVE DATA KREDİ BÜTÇESİ (ücretsiz plan: 8/dk, 800/gün) — ASLA AŞILMAZ (§24: uygulama sınırı 7/dk, 760/gün)

- **Semboller:** XAU/USD, EUR/USD, GBP/USD, BTC/USD, ETH/USD, QQQ. (XAG/USD ücretsiz planda yok — kaldırıldı, bkz. §23)
- **Sadece en düşük TF çekilir:** normalde 5min. 15m/1H/4H/1D **koddan üretilir** (5m'den toplanır).
- **1m penceresi:** 17:25–19:00 TR arasında (D1 ve C için) tüm ilgili semboller **1min** çekilir; 5m bu 1m'lerden üretilir (ek kredi yok). 3m de 1m'den üretilir.
- **Artımlı çekim:** Her taramada `outputsize` küçük (son 6 mum); `data` dalındaki geçmişle birleştirilir.
- **Günlük başlangıç (bootstrap):** Günde bir kez, ilk taramadan önce geçmiş tamamlanır (5m: ~2500 mum ≈ 4H EMA50 için yeterli; günlük bias için 1day 60 mum: XAU, EUR, GBP, QQQ). Bu istekler dakikada en fazla 8 olacak şekilde yayılır.
- **Tarama penceresi:** Pazartesi–Cuma **10:00–20:00 TR**. Dışında otomatik çekim yok. QQQ sadece ABD piyasa saatlerinde (16:30–20:00 TR). Hafta sonu yok (Ayarlar'da kripto için hafta sonu açılabilir; kredi uyarısıyla).
- **Tahmini kullanım:** 6 sembol × 120 tarama = 720 + QQQ ~42 + bootstrap ~11 ≈ **773/gün**.
- **Sert sınır:** Günlük sayaç **790**'a ulaşınca tarama durur, kalan gün "kredi bitti" gösterilir. 429 dönerse bir sonraki dakikaya kadar beklenir, tekrar denenmez.
- **Öncelik (kredi azalırsa):** XAU > EUR > GBP > QQQ > BTC > ETH; son sıradakiler önce atlanır.
- Kredi sayacı `credits.json`'da tutulur, NY 00:00 değil **UTC 00:00**'da sıfırlanır (Twelve Data'nın günlük sıfırlaması). API yanıt başlıklarındaki kalan krediyle karşılaştırılır.
- Anahtarlar **GitHub Secrets**: `TWELVE_DATA_KEY`, `FMP_KEY` (opsiyonel), `VAPID_PUBLIC`, `VAPID_PRIVATE`, `PUSH_SUBSCRIPTIONS`. Kodda veya public dosyada asla anahtar yok.

---

## 16. BİLDİRİMLER (Web Push — uygulama kapalıyken de gelir)

- Actions taraması durum değişimini tespit eder ve `web-push` ile gönderir.
- **Türler:**
  - 🟢 **TAM:** "XAU B LONG · Giriş 4012.40 · SL 4006.90 · TP 4024.10 · RR 2.1 · 0.09 lot"
  - 🟡 **Hazırlan (1 şart kaldı):** "XAU B: sadece 15m CHoCH kapanışı bekleniyor (4016.20 üstü)"
  - ⚠️ **HABER RİSKİ:** "USD CPI 25 dk sonra (16:30 TR) · XAU, EUR, GBP setupları askıda"
  - ⛔ **İptal:** TAM olan setup geçersiz olursa (stop seviyesi delindi / bölge tükendi) tek satır bildirim.
- **Tekrar yok:** Aynı setup aynı durumdayken ikinci bildirim gönderilmez. Anahtar: `strateji+sembol+yön+bölge_id+durum`. Durum değişince (EKSİK→TAM) yeni bildirim.
- Bildirime dokununca ilgili sekme ve setup kartı açılır (`notificationclick` → deep link `#/B/XAUUSD/<id>`).
- **Kayıt:** Uygulama ilk açılışta izin ister, abonelik JSON'unu üretir ve **"Kopyala"** butonuyla gösterir; kullanıcı bunu `PUSH_SUBSCRIPTIONS` secret'ına ekler (birden fazla cihaz için JSON dizisi). Adımlar ekranda resimli talimatla anlatılır.
- Ayarlar'dan her strateji ve sembol için bildirim aç/kapa, "Hazırlan" bildirimlerini aç/kapa, sessiz saatler.
- Uygulama içinde de **bildirim geçmişi** listesi (son 7 gün).

---

## 17. ARAYÜZ TASARIMI — kusursuz kullanışlı (tablet öncelikli)

### 17.1 Tasarım ilkeleri
- **Bir bakışta karar:** Kullanıcı uygulamayı açtığında 2 saniye içinde "şu an bir şey var mı?" sorusunun cevabını görmeli. En önemli bilgi en büyük ve en üstte.
- **Renk tek başına anlam taşımaz:** her durumda renk + ikon + metin birlikte (🟢 TAM, 🟡 EKSİK, ⚪ YOK, 🔴 HABER).
- **Dokunma hedefleri** en az 48×48 px; ana butonlar 56 px. Kaydırma ve dokunma ile her şeye ulaşılır, ince ayar gerektiren küçük öğe yok.
- **Koyu tema varsayılan** (gece kullanımı), açık tema seçeneği. Kontrast WCAG AA.
- Rakamlar **tabular (eşit genişlik)** fontla; fiyatlar hizalı. Fiyat ondalıkları sembole göre (XAU 2, FX 5, XAG 3, BTC 1, QQQ 2).
- Animasyon az ve anlamlı: yalnızca durum değişince kart kısa süre parlar.
- Tüm metin Türkçe, kısa, teknik terimler stratejideki gibi (OB, FVG, CHoCH...).

### 17.2 Renk paleti (CSS değişkenleri) — **§24 ile değişti: TAM mavi, yeşil/kırmızı sadece yön**
- Arka plan `#0E1116`, kart `#161B22`, kenarlık `#2A313C`, metin `#E6EDF3`, ikincil metin `#8B949E`
- TAM `#2EA043`, EKSİK `#D29922`, YOK `#6E7681`, HABER/İPTAL `#F85149`, Long vurgusu `#3FB950`, Short vurgusu `#FF7B72`, bilgi `#58A6FF`
- Açık tema için karşılıkları ayrıca tanımlanır.

### 17.3 Yerleşim — yatay tablet (ana kullanım)
```
┌──────────────────────────────────────────────────────────────────────┐
│ ÜST ÇUBUK: 🕐 18:42 TR · 10:42 NY │ ● NY Open (kalan 1s18dk) │       │
│ Son tarama 18:40 ✓ │ Kredi 512/790 ▓▓▓▓░ │ 🔔 │ ⚙                    │
├──────────────────────────────────────────────────────────────────────┤
│ 🔴 HABER RİSKİ: USD CPI 16:30 TR (25 dk) — XAU/EUR/GBP askıda        │  ← sadece varsa
├────────────┬─────────────────────────────────────────────────────────┤
│ SOL MENÜ   │ İÇERİK                                                  │
│ ◉ Özet     │                                                         │
│ A/B XAU 🟡 │                                                         │
│ C 10AM  ⚪ │                                                         │
│ D Range 🟢2│                                                         │
│ E RB    ⚪ │                                                         │
│ ────────── │                                                         │
│ 📰 Haber   │                                                         │
│ 📒 Günlük  │                                                         │
│ 🕘 Geçmiş  │                                                         │
└────────────┴─────────────────────────────────────────────────────────┘
```
- Sol menü sabit (genişlik ~220 px). Her stratejinin yanında en iyi durum rozeti ve TAM sayısı.
- Dikey tutuşta sol menü **alt sekme çubuğuna** dönüşür (5 ana ikon + "Diğer").

### 17.4 Özet ekranı (açılış ekranı)
- Üstte **"Şu an"** şeridi: TAM olan setuplar büyük kartlarla (varsa); yoksa "Şu an TAM setup yok · 2 setup 1 şart uzakta" gibi tek cümle.
- Altında **ızgara**: satırlar stratejiler, sütunlar semboller; her hücre durum rozeti + kalan şart sayısı. Hücreye dokununca detay açılır. Uygulanmayan kombinasyonlar boş/soluk.
- Sıralama: TAM → EKSİK (az şart kalan önce) → YOK.
- En altta sıradaki 3 kırmızı haber ve sıradaki pencereler ("C penceresi 18:00'de açılıyor — 1s 18dk").

### 17.5 Strateji sekmesi
- Üstte sembol çipleri (D için 6, E için 3); çipte durum rengi. Kaydırarak sembol değiştirilebilir.
- Bölünmüş görünüm: **sol %60 mini grafik**, **sağ %40 şart tablosu + setup kartı**.
- **Şart tablosu:** satır başına ikon (✅/❌/⏳), kısa ad, bir satırlık detay ("4H low 4006.10 · 5m kapanış 4004.80 dışarıda"). Satıra dokununca grafikte ilgili seviye vurgulanır.
- **Setup kartı (TAM veya EKSİK önizleme):**
  - Büyük yön etiketi (LONG yeşil / SHORT kırmızı) ve strateji+alt model (örn. "B · 1H OB · 5m onay")
  - Giriş / Stop / TP1 / TP2 alt alta, büyük tabular rakamlarla; her birinin yanında mesafe (fiyat ve %)
  - RR, risk tutarı ($) ve **lot** (Ayarlar'daki bakiyeden)
  - Giriş yöntemi seçici (varsayılan işaretli; değiştirince hepsi yeniden hesaplanır)
  - Geçersiz olma koşulu (kırmızı küçük not)
  - Ek teyit satırı ve güç yıldızları (B için ★ puanı)
  - Butonlar: **"İşleme girdim"** (günlüğe kaydeder), **"Kopyala"** (metin olarak), **"Claude'a gönder"** (şart tablosu + kart, sohbete yapıştırılacak formatta panoya)
- YOK durumunda kart yerine "Neden yok / Ne bekleniyor / Senaryo ne zaman biter" kutusu.

### 17.6 Mini grafik
- Kütüphane: **TradingView lightweight-charts** (cdn). Mumlar `data` dalından.
- Zaman dilimi sekmeleri: 1m · 5m · 15m · 1H · 4H · 1D (stratejiye uygun olanlar etkin).
- Çizimler: OB (yarı saydam kutu), FVG (çizgili kutu, CE kesik çizgi), 4H high/low (yatay çizgi + etiket), range high/EQ/low, RB bölgesi, likidite seviyeleri ($$ etiketli kesik çizgi), giriş/stop/TP çizgileri (yeşil/kırmızı/mavi), killzone arka plan gölgeleri, 4H EMA50 çizgisi.
- Katman aç/kapa menüsü. Sıkıştırma (pinch) ve kaydırma çalışır. Saat ekseni TR saati.
- Son mum canlı değil, son tarama anı olarak işaretli ("18:40 itibarıyla").

### 17.7 Haber ekranı
- Bugün ve bu hafta; satır: saat TR (yanında NY), bayrak/para birimi, etki rengi (🔴/🟠), olay adı, beklenti, önceki, gerçek (FMP varsa), kaynak.
- Sıradaki kırmızı habere geri sayım kartı en üstte.
- FMP başlıkları ayrı alt sekmede ("Son dakika"), bildirim atmaz.

### 17.8 İşlem günlüğü
- "İşleme girdim" ile kart verisi otomatik dolar; kullanıcı gerçek giriş fiyatını, lotu, notu, ekran görüntüsünü (opsiyonel) düzeltebilir. Sonuç: TP / SL / BE / manuel + R değeri.
- İstatistik ekranı: strateji bazında işlem sayısı, win rate, ortalama RR, toplam R, en iyi/kötü saat dilimi, sembol dağılımı. Basit çubuk grafikler.
- Veriler **sadece tablette** (IndexedDB); repoya gitmez. **JSON dışa aktar / içe aktar** butonları; haftalık "yedek al" hatırlatması.

### 17.9 Geçmiş tarama
- Son 30 günde oluşan TAM ve "1 şart kaldı" olayları liste halinde (`history.json`).
- Her olay için sonradan ne olduğu **otomatik değerlendirilir** (kayıtlı mumlardan, ek kredi yok): önce TP mi, SL mi, hiçbiri mi (zaman aşımı), maksimum lehte/aleyhte hareket (R).
- Filtre: strateji, sembol, sonuç. Üstte özet: "B: 14 setup · 8 TP · 5 SL · 1 açık · ort. +0.9R". Bu, kuralların gerçekte çalışıp çalışmadığını gösterir.
- Olaya dokununca o anın grafiği ve şart tablosu (anlık görüntü) açılır.

### 17.10 Ayarlar
- **Hesap:** bakiye, risk % (varsayılan 0.5), para birimi.
- **Enstrüman:** kontrat büyüklükleri, tamponlar, US100/QQQ oranı için US100 fiyatı alanı.
- **Bildirim:** strateji × sembol matrisi (aç/kapa), "Hazırlan" bildirimi, haber bildirimi, sessiz saatler, test bildirimi gönder butonu, abonelik kodunu kopyala.
- **Parametreler:** swing `n`, displacement katsayısı, ATR mesafeleri, haber penceresi (−30/+15). "Varsayılana dön".
  (Parametreler tarayıcıyı etkilediği için değişiklik `params.json` önerisi olarak üretilir; ekranda "Bu değişikliği depoya uygula" talimatı ve kopyalanabilir JSON gösterilir.)
- **Görünüm:** koyu/açık, yazı boyutu (Normal/Büyük), grafik varsayılan TF.
- **Veri:** son tarama, kredi kullanımı (günlük grafik), takvim güncellik saati, günlük yedekle/yükle.
- **Hakkında:** sürüm, "Uygulama sinyal verir, karar senindir" notu, kural dosyasının bağlantısı.

### 17.11 Durumlar ve hata ekranları
- **İlk açılış (onboarding, 3 adım):** 1) Ana ekrana ekle (Chrome menüsü görseliyle) 2) Bildirim izni + abonelik kodunu kopyala + GitHub'a ekleme adımları 3) Bakiye ve risk gir. Atlanabilir, Ayarlar'dan tekrar açılır.
- **Çevrimdışı:** son veriler gösterilir, üstte gri "Çevrimdışı · son veri 18:40" şeridi. Service worker uygulama kabuğunu önbellekte tutar.
- **Tarama penceresi dışı:** "Tarama 10:00'da başlar" bilgisi ve son günün özeti.
- **Kredi bitti / API hatası / takvim eski:** ilgili alanda açık uyarı, ne yapılacağı tek cümleyle.
- **Boş durumlar:** "Bu sembolde aktif RB yok · sonraki kontrol 18:45" gibi bilgilendirici metin; asla boş ekran.
- Aşağı çekerek yenile (sadece JSON'ları yeniden okur, API'ye gitmez).

### 17.12 Performans
- İlk açılış < 2 sn (tablet, 4G). Framework zorunlu değil; tercih: Vite + Preact veya saf TypeScript. Toplam JS < 250 KB (grafik kütüphanesi hariç).
- `state.json` taramanın beklendiği anda (her 5 dakikanın ~23. saniyesi) GitHub API'den okunur (raw.githubusercontent ~5 dk önbellekli); diğer veriler dakikada bir raw'dan. Üst çubukta sonraki tarama saati gösterilir.

---

## 18. TEST VE KABUL KRİTERLERİ

- Her strateji için **birim testleri**: swing, BOS/CHoCH, OB, FVG, IFVG, sweep, RB, range tespiti; elle hazırlanmış küçük mum dizileriyle.
- **Geriye dönük kuru çalıştırma:** son 10 iş gününün kayıtlı verisiyle tarayıcı çalıştırılır, bulunan setuplar `KARARLAR.md`'ye örnek olarak yazılır (kullanıcı grafikte kontrol edebilsin).
- Kredi simülasyonu: bir tam günün istek sayısı hesaplanıp 790'ın altında olduğu testle doğrulanır.
- Bildirim tekrarı testi: aynı durum iki taramada → tek bildirim.
- Saat testi: 4H mum sınırları ve killzone'lar UTC-5'e göre doğru; TR gösterimi doğru.
- Arayüz: 1280×800 yatay ve 800×1280 dikey tablet ekranında taşma yok; Lighthouse PWA "installable".

---

## 19. TESLİM — bitince kullanıcıya yazılacaklar

Kod tamamlanınca, Türkçe ve adım adım (her adım tek işlem, telefondan yapılabilir):
1. GitHub → strateji → Settings → Secrets and variables → Actions → New repository secret: `TWELVE_DATA_KEY` (ve varsa `FMP_KEY`). VAPID anahtarlarını Actions ilk çalıştırmada üretip nasıl ekleneceğini göster ya da `npx web-push generate-vapid-keys` çıktısını kullanıcıya ver.
2. Settings → Pages → Source: GitHub Actions.
3. Actions sekmesinde workflow'ları etkinleştir; "scan" iş akışını bir kez elle çalıştır.
4. Tablette Chrome'da Pages adresini aç → menü → **Ana ekrana ekle**.
5. Uygulamada bildirim izni ver → abonelik kodunu kopyala → `PUSH_SUBSCRIPTIONS` secret'ına yapıştır.
6. Ayarlar → **Test bildirimi gönder**.
7. Android: Ayarlar → Uygulamalar → Chrome → Pil → **Kısıtlama yok** (bildirim gecikmesin).

Ayrıca: `KARARLAR.md` (verdiğin varsayılanlar ve belirsiz kurallar listesi) ve `README.md` (Türkçe kısa kullanım).

---

## 20. KAYNAKLAR VE AÇIK NOKTALAR (bilgi amaçlı)

- A/B: 8 video + 7 PDF (price action, SMC, trend trading, gold scalping). Breaker'ın likidite bölgelerinde en iyi çalıştığı bilgisi var; bu strateji altın için OB/FVG'yi öne alır, A ise likidite süpürmesine dayanır.
- D: ORB PDF (HowToTrade), opening range one-candle scalping, range trading video ve rehberleri.
- E: ICT Rejection Block kaynakları (3 web sayfası + 3 video).
- Kaynaklardaki kazanma oranı iddiaları kaynaksızdır; geçmiş veride test edilmelidir — **Geçmiş tarama ekranı tam olarak bunun için var.**
- Açık: günlük maksimum işlem sayısı ve günlük kayıp limiti henüz belirlenmedi (C ve D1 hariç). Ayarlar'da boş/opsiyonel alan olarak bırak; doldurulursa limit aşımında tüm setuplar YOK gösterilir.

---

## 21. KURULUM F — BTCUSD Wyckoff (Spring / UTAD)

Tam şartname: **[`docs/KURULUM_F.md`](docs/KURULUM_F.md)** (bu dosyanın parçası sayılır; F için tek doğruluk kaynağı odur).
Ortak kurallardan farkları (sadece F için geçerli):
- Veri **Binance** (`BTCUSDT`, hacim dahil; yedek Coinbase). Twelve Data kredisi harcanmaz. İkisi de yoksa durum **VERİ YOK**.
- Saat hesabı **UTC** (4H mumlar UTC 00/04/08/12/16/20), gösterim TR. Killzone ve ek teyit indikatörleri F'ye uygulanmaz.
- Durumlara ek olarak **TAM – BEKLE** (turuncu): kurulum tam ama funding / Cumartesi / likidasyon / haber / Pazar teyidi bloğu var.
- Stop yapıya göre ATR payıyla verilir (spread/tampon eklenmez); miktar BTC cinsinden, kaldıraç en fazla 3x; aynı anda en fazla 1 açık F işlemi.
- Tarama: hafta içi 10:00–20:00 TR ana taramayla (5 dk), diğer tüm saatlerde ve hafta sonu `scan-f` iş akışıyla 15 dk'da bir.

---

## 22. KURULUM G — XAUUSD Asya Range Süpürmesi (ICT Judas Swing)

Tam şartname: **[`docs/KURULUM_G.md`](docs/KURULUM_G.md)** (bu dosyanın parçası sayılır; G için tek doğruluk kaynağı odur).
- Veri: mevcut XAU/USD 5m akışı (Twelve Data, ortak kredi sayacı) + günde 1 kez `1h × 1200` (EMA50 ısınması, ADR20, PDH/PDL, haftalık range). 15m/1H/4H/günlük koddan üretilir; G'nin 4H sınırları 02/06/10/14/18/22, günü 18:00→17:00 (strateji saati, sabit UTC-5).
- **Ön pencere:** hafta içi 08:00–10:00 TR sadece XAU taranır (Asya seviyeleri 08:00'de hazır, süpürme penceresi 10:00'da kaçmasın).
- G'ye de ortak **hatalı sinyal koruması** uygulanır (dolum öncesi ve sonrası); günde en fazla 1 G işlemi; aynı gün aynı yönde B TAM ise tek işlem sayılır ("B ile birleşik").

## 23. DEĞİŞİKLİK NOTLARI

- **05.11.2026 — XAG/USD kaldırıldı:** Twelve Data ücretsiz planında yok (Grow/Venture gerekir). §1.3, §10, §15'teki XAG ifadeleri geçersizdir; D artık US100, XAU/USD, GBP/USD, BTC/USD, ETH/USD'de çalışır. Plan yükseltilirse `config/symbols.json`'a geri eklenebilir.
- **05.11.2026 — Ekran gecikmesi giderildi:** raw.githubusercontent'ın ~5 dk önbelleği yerine `state.json` tarama anında GitHub API'den okunur; §17.12 güncellendi.

---

## 24. EK ÖZELLİKLER v1 (işlem, Piyasa Yönü, Başarılı Trader'lar)

Tam şartname: **[`docs/EK_OZELLIKLER_v1.md`](docs/EK_OZELLIKLER_v1.md)** (bu dosyanın parçası sayılır). Aşamalar halinde uygulanır (§10 orada). Bu bölüm önceki bölümleri şu noktalarda **değiştirir**:
- **Renkler (§17.2'nin yerine):** yeşil/kırmızı **sadece yön** içindir (▲/▼ ve LONG/SHORT yazısıyla birlikte). Durum renkleri: TAM **mavi `#2563EB`**, EKSİK sarı `#EAB308`, YOK gri, TAM–BEKLE turuncu `#F97316`. Haber riski bandı kırmızı kalır (§3.4 orada).
- **Kredi (§15'in yerine):** kayan pencerede dakikada en fazla **7**, günde en fazla **760** istek (ücretsiz plan 8/800; 1 güvenlik payı). Öncelik: açık işlem takibi → aktif kurulum taramaları → Piyasa Yönü → diğer.
- **Ayarlar (§17.10'a ek):** bakiye zorunlu (girilmeden lot "AYAR GEREKLİ"), hesap para birimi (USD dışıysa günlük kur), günlük maks. zarar %2, aynı anda maks. toplam risk %1,5, broker sembol eşleme, sembol başına tipik spread, broker bağlantısı (şimdilik Kapalı), sessiz saatler 00:00–07:00 TR (bu aralıkta sadece TAM ve ÇIKIŞ sesli).
- **Enstrüman tablosu:** kontrat, "1 birim hareketin 1 lottaki değeri", lot adımı, min lot, tipik spread; kullanıcı doğrulamadan lot hesaplanmaz.
- XAG/USD §23 gereği yoktur (belgedeki XAG satırları "VERİ YOK").

## 25. KURULUM H — Trend Devam (Pullback)

Tam şartname: **[`docs/KURULUM_H.md`](docs/KURULUM_H.md)** (bu dosyanın parçası sayılır; H için tek doğruluk kaynağı odur).
- Enstrümanlar: XAUUSD, US100 (QQQ verisi), BTCUSD (Binance). Diğer kurulumlardan bağımsız.
- **5 dakikalık tarama** ve **hatalı sinyal koruması (§10, 13 madde)** zorunludur: kapanmış mum, repaint yok, çift tarama teyidi, veri tazeliği, kötü tick, histerezis, eksik mum, açılış boşluğu, haber mumu, son kontrol (KAÇTI), tekrar/soğuma, çakışma, US100 oran kontrolü.
- US100 için NY borsa saati **yaz saatiyle** uygulanır (diğer kurallardaki sabit UTC-5'ten farklı). QQQ verisi NY seansı boyunca (09:30–15:45 NY) çekilir; hafta içi tarama penceresi bu yüzden 20:00 TR sonrasında da US100 + BTC için açık kalır.

## 26. ⭐ KURULUMLAR (M2, T4-S, N7, IB, TD) — backtestten geçmiş

⭐ kurulum şartnameleri `docs/` içinde, **parametreler kilitli** (değiştirilirse ⭐ kalkar, "test edilmemiş" olur):
[`docs/kurulum_P_Portfoy_ortak_spec.md`](docs/kurulum_P_Portfoy_ortak_spec.md) (ortak kurallar — portföy risk kuralları §6 her zaman en üstte) ·
[`M2`](docs/kurulum_M2_Trend1H_spec.md) · [`T4-S`](docs/kurulum_T4S_Trend4H_spec.md) · [`N7`](docs/kurulum_N7_Sikisma_spec.md) · [`IB`](docs/kurulum_IB_IcMum_spec.md) · [`TD`](docs/kurulum_TD_Turtle_spec.md).
Çelişkide kurulumun kendi şartnamesi geçerlidir. Mevcut kurulumlar (A–H) bu bölümden etkilenmez.
