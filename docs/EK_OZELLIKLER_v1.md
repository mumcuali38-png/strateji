# Strateji Uygulaması — Ek Özellikler Şartnamesi v1

Bu belge, mevcut uygulamaya (repo: `strateji`, tablet uygulaması, kurulum A–G bölümleri) eklenecek yeni özellikleri tanımlar.
Kurulum kuralları kendi belgelerindedir (Claude Doc "XAUUSD 5m Strateji v1.7", `kurulum_F_BTC_spec.md`, `kurulum_G_XAU_Judas_spec.md`). Bu belge onların **üstüne** gelen katmanları anlatır.

## İçindekiler
0. Genel ilkeler (değişmez kurallar)
1. Ortak altyapı (ayarlar, enstrüman tablosu, veri kaynakları, kredi sayacı)
2. Renk ve tasarım sistemi
3. İşlem özellikleri (11 özellik)
4. MT5'e Gönder butonu (şimdilik pasif)
5. Piyasa Yönü sekmesi (0–100 skor, Forex + Kripto)
6. Başarılı Trader'lar bölmesi
7. Veri modelleri
8. Bildirimler (yeni eklenenler)
9. Test senaryoları
10. Uygulama sırası (aşamalar)

---

## 0. Genel ilkeler

| # | İlke |
|---|---|
| 0.1 | **Twelve Data ücretsiz plan kredisi asla aşılmaz** (8/dk, 800/gün). Tüm modüller tek bir ortak kredi sayacından geçer (§1.4). |
| 0.2 | Kullanıcıya tüm saatler **TR (UTC+3)** gösterilir. XAU ve 10 AM kurulumlarının strateji saati sabit UTC-5'tir. Kodda zaman UTC tutulur. |
| 0.3 | Bildirimler **uygulamanın kendisinden** gelir (Telegram yok). |
| 0.4 | Renkler: **yeşil = long/bullish, kırmızı = short/bearish**. Her renkli öğenin yanında ▲/▼ ve "LONG/SHORT" yazısı da bulunur (§2). |
| 0.5 | Uygulama **sinyal ve analiz** gösterir. Emir gönderme özelliği (§4) şimdilik **kapalıdır**. |
| 0.6 | Veri gelmezse tahmini değer üretilmez; ilgili kutuda "VERİ YOK" yazar. |
| 0.7 | Arayüz sade ve kullanıcı dostu: her ekranda en önemli bilgi en üstte, ayrıntı dokununca açılır. |

---

## 1. Ortak altyapı

### 1.1 Ayarlar ekranı (yeni alanlar)
| Alan | Varsayılan | Açıklama |
|---|---|---|
| Hesap bakiyesi | — (zorunlu) | Lot hesabı için |
| Hesap para birimi | USD | USD dışıysa kur (§1.2) |
| İşlem başı risk % | 0,5 | Kurulumların standart riski |
| Günlük maks. zarar % | 2,0 | Risk kilidi (§3.1) |
| Aynı anda maks. toplam risk % | 1,5 | Risk kilidi (§3.1) |
| Sembol eşleme | §1.2 | Broker sembol adları |
| Tipik spread (sembol başına) | §1.2 | Spread kontrolü için |
| Broker bağlantısı | **Kapalı** | Seçenekler: Kapalı / MetaApi / EA Köprüsü (§4) |
| Sessiz saatler | 00:00–07:00 TR | Bu aralıkta sadece TAM sinyaller sesli |

### 1.2 Enstrüman tablosu (ayarlardan düzenlenebilir)

| Uygulama sembolü | Broker sembolü (örnek) | Kontrat (1 lot) | $1 / 1 pip hareketin 1 lottaki değeri | Lot adımı | Min lot | Tipik spread |
|---|---|---|---|---|---|---|
| XAUUSD | XAUUSD | 100 ons | $1 hareket = $100 | 0,01 | 0,01 | $0,20 |
| XAGUSD | XAGUSD | 5.000 ons | $0,01 hareket = $50 | 0,01 | 0,01 | $0,03 |
| EURUSD | EURUSD | 100.000 EUR | 1 pip (0,0001) = $10 | 0,01 | 0,01 | 0,8 pip |
| GBPUSD | GBPUSD | 100.000 GBP | 1 pip = $10 | 0,01 | 0,01 | 1,0 pip |
| US100 | NAS100 / USTEC | **brokera göre** (örn. 1 lot = $1/puan) | ayarlardan | 0,01 | 0,01 | 1,5 puan |
| BTCUSD | BTCUSD | **brokera göre** (örn. 1 BTC) | ayarlardan | 0,01 | 0,01 | $30 |
| ETHUSD | ETHUSD | **brokera göre** (örn. 1 ETH) | ayarlardan | 0,01 | 0,01 | $2 |

- Kullanıcı ilk açılışta broker değerlerini doğrular. Değerler girilmeden lot hesaplayıcı "AYAR GEREKLİ" gösterir.
- Hesap para birimi USD değilse: `riskUSD = bakiye × risk% × kur(hesapPB→USD)`. Kur günde 1 kez Twelve Data'dan alınır (1 kredi).

### 1.3 Veri kaynakları (yeni)
| Kaynak | Kullanım | Maliyet |
|---|---|---|
| Twelve Data | Forex/XAU/US100(QQQ)/UUP/IEF mumları | Ortak kredi bütçesi |
| Binance spot (`data-api.binance.vision`) | BTC/ETH mumları ve hacim | Ücretsiz |
| Binance futures (`fapi.binance.com`) | Funding, açık pozisyon, long/short oranları | Ücretsiz. Erişilemezse yedek: Bybit v5 API |
| alternative.me (`api.alternative.me/fng/`) | Kripto Korku & Açgözlülük endeksi | Ücretsiz |
| DefiLlama (`stablecoins.llama.fi`) | Stablecoin arzı | Ücretsiz |
| Farside Investors | Spot BTC/ETH ETF akışları (HTML tablo) | Ücretsiz, günde 1 kez |
| CFTC COT (`publicreporting.cftc.gov`) | Haftalık pozisyonlanma | Ücretsiz, haftada 1 kez (Cuma) |
| Myfxbook API (`get-community-outlook`) | Perakende long/short oranı | Ücretsiz hesap |
| Forex Factory + FMP | Takvim ve haber sonuçları (mevcut) | Mevcut |
| eToro public API | Başarılı trader'lar (§6) | Uygunluk doğrulanacak |

### 1.4 Ortak kredi sayacı (Twelve Data)
- Tek bir servis tüm istekleri kuyruklar: kayan pencerede dakikada en fazla **7** (1 güvenlik payı), günde en fazla **760**.
- Öncelik sırası: (1) açık işlem takibi, (2) aktif kurulum taramaları, (3) Piyasa Yönü, (4) diğer.
- Günlük kullanım %90'a ulaşınca düşük öncelikli işler (Piyasa Yönü forex güncellemesi) günün kalanında saatlikten 4 saatliğe iner.
- Ayarlarda "Kredi: 412/800 bugün" göstergesi.

---

## 2. Renk ve tasarım sistemi

### 2.1 Yön renkleri
| Anlam | Renk | Hex (açık tema / koyu tema) | Ek işaret |
|---|---|---|---|
| Güçlü Bullish / LONG | Koyu yeşil | `#15803D` / `#22C55E` | ▲▲ |
| Bullish | Açık yeşil | `#4ADE80` / `#86EFAC` | ▲ |
| Nötr | Gri | `#9CA3AF` / `#6B7280` | ● |
| Bearish | Açık kırmızı | `#F87171` / `#FCA5A5` | ▼ |
| Güçlü Bearish / SHORT | Koyu kırmızı | `#B91C1C` / `#EF4444` | ▼▼ |

### 2.2 Durum renkleri (yön değil, hazırlık)
| Durum | Renk |
|---|---|
| TAM | Mavi `#2563EB` |
| EKSİK / 1 şart kaldı | Sarı `#EAB308` |
| YOK / Bitti | Gri |
| TAM – BEKLE (blok) | Turuncu `#F97316` |

> Yeşil ve kırmızı **yalnızca yön** için kullanılır. Durum rozetleri asla yeşil/kırmızı olmaz.

### 2.3 Kullanım yerleri
- Kurulum kartı başlığı: yön rengi şeridi + rozet (durum rengi).
- Emir kartı ve MT5 butonu: LONG yeşil, SHORT kırmızı.
- Canlı işlem: anlık R ≥ 0 yeşil, < 0 kırmızı.
- Piyasa Yönü göstergeleri: §2.1 skala.
- Başarılı Trader'lar: pozisyon satırı yön rengi.

---

## 3. İşlem özellikleri

### 3.1 Lot hesaplayıcı + risk kilidi
**Formül**
```
riskUSD = bakiye × risk% (× kur)
stopMesafesi = |entry − stop|
degerBirimi  = enstrüman tablosundaki "1 birim hareketin 1 lottaki değeri"
lot = floor( riskUSD / (stopMesafesi_birim × degerBirimi) / lotAdımı ) × lotAdımı
```
- XAUUSD örneği: bakiye $10.000, risk %0,5 → $50; stop $8 → `50 / (8 × 100) = 0,0625` → **0,06 lot**.
- EURUSD örneği: $50; stop 12 pip → `50 / (12 × 10) = 0,416` → **0,41 lot**.
- `lot < minLot` → "Risk çok küçük — min lot ile risk %X olur" uyarısı.
- BTC (Kurulum F): ayrıca kaldıraç kontrolü `lot × kontrat × fiyat ≤ 3 × bakiye`. Aşarsa lot düşürülür, uyarı verilir.

**Risk kilidi**
- Bugün kapanan işlemlerin zararı ≥ günlük maks. zarar % → tüm yeni sinyallerde "BUGÜN DUR" kilidi.
- Açık işlemlerin toplam riski + yeni işlemin riski > maks. toplam risk % → o sinyalde "RİSK DOLU" kilidi.
- Aynı paritede aynı yönde iki kurulum TAM ise (örn. B ve G) tek işlem önerilir ("aynı fikir").

### 3.2 Emir kartı
TAM sinyalde kurulum kartının altında açılır.
| Satır | İçerik |
|---|---|
| Başlık | Kurulum harfi + parite + yön (renkli) + kalite |
| Emir tipi | Limit (varsayılan) / Piyasa (fiyat bölgedeyse seçilebilir) |
| Giriş / SL | Değer + mesafe (puan/pip ve $) |
| TP1 / TP2 | Değer + RR + "TP1'de %50" notu |
| Lot | §3.1'den, toplam ve iki parçaya bölünmüş hali (%50 / %50) |
| Risk | $ ve % |
| Son giriş | Geri sayım (§3.5) |
| Uyarılar | Spread, haber, risk kilidi |
| Butonlar | **Kopyala** (aktif), **MT5'e Gönder** (pasif, §4), **Girdim**, **Girmedim** |

- **Kopyala:** `XAUUSD BUY LIMIT 4056.85 SL 4045.60 TP1 4071.20 TP2 4088.00 LOT 0.06 (2×0.03)` formatında panoya kopyalar.
- **Girdim:** Gerçek giriş fiyatı ve lot girilir (varsayılan: önerilen) → canlı işlem başlar (§3.6) ve günlük kaydı açılır (§3.10).
- **Girmedim:** §3.11.

### 3.3 Spread kontrolü
- Broker bağlantısı yokken: ayarlardaki tipik spread kullanılır, RR **spread dahil** yeniden hesaplanır: long'da `entry_eff = entry + spread`.
- Spread dahil RR, kurulumun minimum RR'sinin altına düşerse kartta "Spread ile RR yetersiz" uyarısı.
- Broker bağlantısı aktif olunca (ileride): canlı spread; tipik değerin 2 katından fazlaysa "Spread geniş" uyarısı.

### 3.4 Haber kilidi
- Emir kartı açıkken ilgili para biriminde kırmızı habere ≤ 30 dk varsa kırmızı bant: "HABER RİSKİ – {olay} {saat}".
- Açık işlemde habere 15 dk kala bildirim: kurulumun haber kuralı (örn. G: "T1 yoksa çık").

### 3.5 Son giriş sayacı
- Her kurulumun kendi şartnamesindeki son giriş zamanından geri sayar.
  - Örnekler: G → 13:00 TR; C → 11:00 NY strateji saati (19:00 TR); F → spring'den sonra 24 saat CHoCH süresi; diğerleri → ilgili killzone bitişi.
- Süre dolunca kart "SÜRE DOLDU — limit emri iptal edin" durumuna geçer ve bildirim gönderilir.

### 3.6 Canlı işlem ekranı
- "Girdim" ile başlayan her işlem için kart: parite, yön, giriş, SL, TP1/TP2, **anlık fiyat**, **anlık R** (renkli), TP1/TP2/SL'ye kalan mesafe, geçen süre, kurulumun kalan yönetim adımları.
- Fiyat takibi: XAU/forex için 15m (açık işlem varken 5m, kredi bütçesi izin verirse), kripto için Binance 1m.
- Kullanıcı elle "TP1 alındı / BE yapıldı / kapattım (fiyat)" işaretleyebilir.

### 3.7 Yönetim hatırlatıcıları
| Tetik | Bildirim |
|---|---|
| Fiyat TP1'e dokundu | "{Kurulum}: TP1 — %50 kapat, SL'yi girişe çek" |
| Fiyat TP2'ye dokundu | "{Kurulum}: TP2 — kalanı kapat" |
| Haber öncesi kuralı | Kurulumun haber kuralına göre (örn. G: "T1 yok — çık") |
| Seans/zaman sonu | Kurulumun zorunlu kapanış saati (örn. G: 20:00 TR) |
| SL'ye dokundu | "{Kurulum}: Stop — işlemi kapat, günlük kaydı tamamla" |

Kurulumun kendi yönetim kuralı yoksa varsayılan: TP1'de %50 + BE.

### 3.8 İptal koşulu takibi
Açık işlemde kurulumun iptal kuralı gerçekleşirse **"ÇIKIŞ"** bildirimi (yüksek öncelik, sessiz saatlerde de sesli):
- F: başarısız spring / UTAD
- G: zorunlu çıkış koşulları
- E: fiyatın RB fitil ucunun ötesinde gövde kapatması
- Diğerleri: kendi "Geçersiz" satırlarındaki işlem içi koşullar

### 3.9 Bildirim merkezi
Tüm işlem bildirimleri uygulama içi "Bildirimler" listesinde de saklanır (son 30 gün).

### 3.10 Otomatik günlük kaydı
"Girdim" ile açılır, işlem kapanınca kendiliğinden tamamlanır.
| Alan | Kaynak |
|---|---|
| Kurulum, parite, yön, kalite | Sinyal |
| Önerilen giriş/SL/TP/lot | Emir kartı |
| Gerçek giriş/çıkış/lot | Kullanıcı |
| Sonuç R ve $ | Hesaplanır |
| Süre, MAE/MFE (en kötü / en iyi R) | Fiyat takibi |
| Kurallara uyuldu mu? | Kullanıcı (Evet/Hayır + not) |
| Ekran görüntüsü, not | Kullanıcı (opsiyonel) |

### 3.11 "Neden girmedim" butonu
TAM sinyal "Girmedim" ile kapatılırsa sebep seçilir: **Geç gördüm / Korktum / Kurala uymadı bence / Haber / Risk dolu / Spread / Diğer (not)**.
- Uygulama, girilmeyen sinyalin sanal sonucunu da takip eder (TP/SL hangisi önce) → "kaçan R" istatistiği.

---

## 4. MT5'e Gönder butonu (şimdilik PASİF)

### 4.1 Şimdiki davranış
- Sadece TAM sinyallerde, emir kartının altında görünür (LONG yeşil, SHORT kırmızı), **soluk ve devre dışı**.
- Dokununca: "MT5 bağlantısı henüz aktif değil. Seviyeleri Kopyala ile alabilirsin." mesajı.
- Onay ekranı ve Kopyala tam çalışır.

### 4.2 İleride aktif olunca (şimdiden mimari hazırlığı)
Kod, bir **BrokerAdapter** arayüzü üzerinden yazılır:
```
interface BrokerAdapter {
  status(): "DISABLED" | "CONNECTED" | "ERROR"
  getQuote(symbol): {bid, ask}
  placeOrder(req: OrderRequest): OrderResult       // pending/market
  modifyStopLoss(ticket, newSL): Result
  cancelOrder(ticket): Result
  positions(): Position[]
}
```
- Şimdiki uygulama: `DisabledAdapter` (her çağrı "DISABLED" döner).
- İleride: `MetaApiAdapter` (bulut REST/WebSocket; MetaApi Regular ≈ $30/ay) veya `EABridgeAdapter` (MT5'te çalışan EA, ortak bir bulut kuyruğundan emir okur).
- Ayarlardaki "Broker bağlantısı" değişince adapter değişir; UI kodu değişmez.

### 4.3 Gönderim kuralları (aktif olunca uygulanacak)
| Kural | Ayrıntı |
|---|---|
| Onay | Her gönderim onay ekranından geçer; otomatik gönderim yok |
| İki emir | %50 lot TP1'li, %50 lot TP2'li; ikisinde aynı SL |
| Bekleyen emir süresi | `expiration` = kurulumun son giriş zamanı |
| Fiyat farkı düzeltmesi | `offset = brokerMid − feedFiyat`; giriş/SL/TP'ler offset kadar kaydırılır (mesafeler korunur) |
| Magic numarası | A=1001, B=1002, C=1003, D=1004, E=1005, F=1006, G=1007 |
| Yorum | `{Kurulum}-{LONG/SHORT}-{YYYYMMDD}` |
| TP1 sonrası | İkinci emrin SL'si otomatik girişe çekilir |
| Çift gönderim | Aynı sinyal kimliği ikinci kez gönderilemez |
| Kilitler | Risk kilidi, haber (<30 dk), spread geniş → buton kilitli |
| Acil durdur | Ayarlarda tek anahtar: tüm gönderimleri kapatır |
| İlk kullanım | Demo hesap önerisi uyarısı |

---

## 5. Piyasa Yönü sekmesi

### 5.1 Genel
- Tek sekme, iki bölüm: **Forex** (EURUSD, GBPUSD, XAUUSD, XAGUSD, US100) ve **Kripto** (BTC, ETH).
- Her enstrüman için 0–100 skor; ayrıca **Forex Genel** ve **Kripto Genel**.
- Formül: her bileşen `s ∈ [−1, +1]`, ağırlıklı toplam `S = Σ(wᵢ·sᵢ)/Σwᵢ`, **`Skor = round(50 + 50·S)`**.
- Bir bileşenin verisi yoksa ağırlığı diğerlerine oransal dağıtılır; kartta "{bileşen} verisi yok" notu.
- Güncelleme: saatte bir (kredi durumuna göre §1.4).

### 5.2 Etiketler
| Skor | Etiket | Renk |
|---|---|---|
| 80–100 | Güçlü Bullish | Koyu yeşil ▲▲ |
| 60–79 | Bullish | Açık yeşil ▲ |
| 41–59 | Nötr | Gri ● |
| 21–40 | Bearish | Açık kırmızı ▼ |
| 0–20 | Güçlü Bearish | Koyu kırmızı ▼▼ |

### 5.3 Ortak bileşen formülleri
**Trend (zaman dilimi başına)**
| Koşul | s |
|---|---|
| close > EMA50 > EMA200 | +1 |
| close > EMA50, EMA50 < EMA200 | +0,5 |
| close < EMA50, EMA50 > EMA200 | −0,5 |
| close < EMA50 < EMA200 | −1 |
Trend = 0,5·Günlük + 0,3·4H + 0,2·1H.

**Yapı (zaman dilimi başına):** Son 50 mum içindeki en son kapanışla kırılan pivot (N=3) yönü: yukarı BOS +1, aşağı −1, yoksa 0. Aynı ağırlıklar.

**Momentum:** `rsi = clip((RSI14 − 50)/25, −1, 1)` (Günlük ve 4H ortalaması). MACD(12,26,9) histogramı: >0 ve artıyor +1, >0 azalıyor +0,5, <0 artıyor −0,5, <0 azalıyor −1 (4H). Momentum = 0,6·rsi + 0,4·macd.

**Bizim kurulumlar:** O enstrümandaki aktif sinyaller: TAM ±1, EKSİK ve "1 şart kaldı" ±0,5, diğer EKSİK ±0,25 (long +, short −). Birden fazlaysa ortalama. Yoksa 0.

> Veri: Forex için her enstrümanda tek bir `1h` çağrısı (`outputsize=1200`), 4H ve Günlük buradan türetilir. US100 için QQQ kullanılır. XAGUSD ücretsiz planda yok → "VERİ YOK" (ileride başka kaynak).

### 5.4 Forex bileşenleri ve ağırlıkları
| Bileşen | w | Formül |
|---|---|---|
| Trend | 25 | §5.3 |
| Yapı | 20 | §5.3 |
| Momentum | 10 | §5.3 |
| Bizim kurulumlar | 15 | §5.3 |
| Makro / Dolar | 15 | `usd` = UUP günlük trend skoru (§5.3 trend formülü), `bond` = IEF günlük trend skoru. EURUSD, GBPUSD: `−usd`. XAU, XAG: `0,6·(−usd) + 0,4·bond`. US100: `0,6·bond + 0,4·(−usd)`. |
| Pozisyonlanma | 10 | `cot`: COT net spekülatif pozisyonun 4 haftalık değişimi / son 52 haftanın değişim std'si, clip ±1; z-skoru > 2 ise −0,5, < −2 ise +0,5 (aşırı uç düzeltmesi). `retail` = −clip((Myfxbook long% − 50)/30, ±1). Pozisyonlanma = 0,6·cot + 0,4·retail. (EUR, GBP, altın, gümüş, Nasdaq-100 COT kontratları) |
| Haber sürprizi | 5 | Son 24 saatteki kırmızı olaylar: `sürpriz = sign(gerçek − beklenti) × olayYönü` (olayYönü tablosu §5.6). Para birimine etkisi pariteye çevrilir (USD bullish → EURUSD/GBPUSD/XAU/XAG için −). Olayların ortalaması. |

**Forex Genel** = EURUSD, GBPUSD, XAUUSD, XAGUSD skorlarının ortalaması (US100 hariç). Altında açıklama: "Yüksek = dolar genel olarak zayıf".

### 5.5 Kripto bileşenleri ve ağırlıkları
| Bileşen | w | Formül |
|---|---|---|
| Trend | 20 | §5.3 (Binance mumları) |
| Yapı | 15 | §5.3 |
| Momentum | 10 | §5.3 |
| Bizim kurulumlar | 10 | D ve F sinyalleri (§5.3) |
| Türev piyasa | 20 | **OI:** 24s fiyat değişimi ve 24s açık pozisyon değişimi: fiyat↑ OI↑ +1, fiyat↑ OI↓ +0,3, fiyat↓ OI↓ −0,3, fiyat↓ OI↑ −1. **Funding** (8 saatlik, %): < −0,01 → +0,3; −0,01…0 → 0; 0…0,01 → +0,3; 0,01…0,03 → 0; 0,03…0,07 → −0,5; > 0,07 → −1. **Büyük trader L/S** (`topLongShortPositionRatio`): clip((oran − 1)/0,5, ±1). **Perakende L/S** (`globalLongShortAccountRatio`): −clip((oran − 1)/0,5, ±1). Türev = 0,4·OI + 0,3·funding + 0,15·büyük + 0,15·perakende. |
| Para akışı | 10 | **ETF:** son 5 günün net akışı: BTC için clip(akış / $1 milyar, ±1), ETH için clip(akış / $300 milyon, ±1). **Stablecoin:** 7 günlük toplam arz değişimi clip(%Δ / %1, ±1). Akış = 0,6·ETF + 0,4·stablecoin. |
| Duygu | 10 | Korku & Açgözlülük `v`: ≤20 → +0,7; 21–39 → −0,3; 40–59 → 0; 60–79 → +0,3; ≥80 → −0,7 (uçlarda ters). |
| Makro | 5 | 0,6·(QQQ günlük trend) + 0,4·(−UUP günlük trend) |

**Kripto Genel** = 0,65·BTC + 0,35·ETH.

### 5.6 Haber olay yönü tablosu (para birimine etki)
| Olay | "Gerçek > beklenti" etkisi |
|---|---|
| CPI, Core CPI, PCE, PPI | + (şahin) |
| NFP, ADP, Perakende satışlar, GDP, ISM/PMI | + |
| İşsizlik oranı, işsizlik başvuruları | − |
| Faiz kararı (beklentiden yüksek) | + |
Tabloda olmayan olaylar sürpriz hesabına girmez.

### 5.7 Ekran
- Üstte iki büyük gösterge: **Forex Genel** ve **Kripto Genel** (skor, etiket, renk, 24s değişim ▲▼).
- Altında enstrüman kartları: skor, etiket, 24s değişim, mini 7 günlük çizgi grafik.
- Karta dokununca **bileşen dökümü**: her bileşenin `s` değeri, puan katkısı (`w·s` normalize) yatay çubukla (yeşil/kırmızı) ve tek cümle açıklama (örn. "Funding %0,045 — piyasa ısınmış").
- Skorlar saatlik kaydedilir (geçmiş grafiği ve ileride karne/ağırlık ayarı için).

---

## 6. Başarılı Trader'lar bölmesi

### 6.1 Amaç
Seçilmiş başarılı trader'ların **bizim paritelerimizdeki** açık pozisyonlarını ayrı bir bölmede göstermek. **Sinyal değil, teyit bilgisidir**; bu bölmeden emir kartı açılmaz.

### 6.2 Kaynaklar (Claude Code önce erişilebilirliği doğrulamalı)
| Kaynak | Ne alınır | Durum |
|---|---|---|
| eToro public API | Popular Investor'ların istatistikleri ve açık pozisyonları | **Birincil.** Uç noktalar ve kullanım koşulları geliştirmeden önce doğrulanır; pozisyon verisi yoksa sadece istatistikler gösterilir. |
| Myfxbook `get-community-outlook` | Perakende long/short % (kalabalık göstergesi) | Resmi API, ücretsiz hesap |
| CFTC COT | Büyük oyuncuların haftalık net pozisyonu | Resmi, haftalık |
| Binance lider trader pozisyonları | BTC/ETH lider pozisyonları | Resmi API'de yok; **varsayılan kapalı** (kazıma kullanım şartlarına takılabilir) |

### 6.3 "Başarılı" filtresi (ayarlardan değiştirilebilir)
| Kriter | Varsayılan |
|---|---|
| Doğrulanmış geçmiş | ≥ 12 ay |
| Maks. drawdown | ≤ %20 |
| İşlem sayısı | ≥ 100 |
| Son 3 ay | Pozitif |
| Risk skoru (eToro) | ≤ 6 |
| Paritelerimizde işlem | Son 90 günde en az 10 |

### 6.4 Ekran
- Parite filtresi (sekmeler): XAU, EURUSD, GBPUSD, XAG, US100, BTC, ETH.
- Parite özeti: "XAU: 7 trader → 5 LONG / 2 SHORT" (yeşil/kırmızı çubuk).
- **Uyum satırı:** bizim aktif kurulumlarımızla karşılaştırma, örn. "G LONG TAM — trader'ların %71'i LONG → uyumlu ✅".
- **Kalabalık satırı:** Myfxbook perakende oranı; ≥ %70 tek yönde ise "Kalabalık aşırı {yön} — ters sinyal olabilir".
- **COT satırı:** haftalık net pozisyon ve değişim.
- Trader listesi: ad, yön (renkli), açılış zamanı, varsa giriş fiyatı, 12 aylık getiri, maks. DD, son güncelleme saati ("gecikmeli olabilir" notu).
- Güncelleme: 15 dakikada bir (kaynak limitlerine göre).

### 6.5 Uyarı metni (bölmenin altında sabit)
"Bu veriler gecikmeli olabilir, en iyi trader'lar pozisyonlarını gizleyebilir ve geçmiş başarı devam etmeyebilir. Kurulumlarımızı teyit amacıyla kullan; tek başına işlem açma."

---

## 7. Veri modelleri (özet)

```json
{
  "Signal": {"id": "G-20261106-XAUUSD", "setup": "G", "symbol": "XAUUSD", "direction": "LONG",
             "status": "TAM", "quality": "güçlü", "entry": 4056.85, "sl": 4045.6,
             "tp1": 4071.2, "tp2": 4088.0, "last_entry_utc": "...", "created_utc": "..."},
  "OrderCard": {"signal_id": "...", "type": "LIMIT", "lot_total": 0.06, "lot_parts": [0.03, 0.03],
                "risk_usd": 50.0, "risk_pct": 0.5, "rr_tp1": 1.28, "rr_tp2": 2.78,
                "rr_tp2_with_spread": 2.70, "warnings": ["HABER_30DK"], "mt5_enabled": false},
  "Trade": {"id": "...", "signal_id": "...", "fill_entry": 4057.1, "lot": 0.06, "opened_utc": "...",
            "events": [{"t": "...", "type": "TP1 | BE | SL | TP2 | MANUAL_CLOSE | EXIT_ALERT", "price": 0}],
            "closed_utc": null, "result_r": null, "result_usd": null, "mae_r": -0.4, "mfe_r": 1.6,
            "rules_followed": null, "note": "", "screenshot": null},
  "SkippedSignal": {"signal_id": "...", "reason": "GEC_GORDUM | KORKTUM | KURAL_DISI | HABER | RISK_DOLU | SPREAD | DIGER",
                    "note": "", "virtual_result_r": 2.0},
  "DirectionScore": {"symbol": "XAUUSD", "t_utc": "...", "score": 72, "label": "Bullish",
                     "components": [{"name": "Trend", "w": 25, "s": 0.8}], "missing": ["XAG verisi"]},
  "TraderPosition": {"source": "etoro", "trader": "...", "symbol": "XAUUSD", "direction": "LONG",
                     "opened_utc": "...", "entry": null, "stats": {"return_12m": 0.34, "max_dd": 0.12, "trades": 420},
                     "fetched_utc": "..."}
}
```

---

## 8. Bildirimler (yeni)
| Olay | Öncelik |
|---|---|
| TAM sinyal (mevcut) + emir kartı hazır | Yüksek |
| Son giriş süresi doldu | Orta |
| TP1 / TP2 / SL | Yüksek |
| Haber öncesi işlem kuralı | Yüksek |
| İptal koşulu → ÇIKIŞ | **En yüksek** (sessiz saatleri deler) |
| Risk kilidi devreye girdi | Orta |
| Piyasa Yönü: bir enstrüman etiket değiştirdi (örn. Nötr → Bullish) | Düşük (günde en fazla 3) |
| Başarılı Trader'lar: uyumsuzluk (bizim TAM sinyale karşı trader'ların ≥ %70'i ters yönde) | Orta |

---

## 9. Test senaryoları
| # | Girdi | Beklenen |
|---|---|---|
| 1 | Bakiye $10.000, XAU stop $8, risk %0,5 | Lot 0,06 (2×0,03) |
| 2 | EURUSD stop 12 pip | Lot 0,41 → parçalar 0,21 (TP1) + 0,20 (TP2) |
| 3 | Hesaplanan lot 0,004 | "Risk çok küçük" uyarısı, lot 0,01 önerisi ve gerçek risk % |
| 4 | Bugünkü zarar %2,1 | Tüm yeni sinyallerde "BUGÜN DUR" |
| 5 | Açık risk %1,2 + yeni %0,5 > %1,5 | "RİSK DOLU" |
| 6 | Spread dahil RR minimumun altına düştü | "Spread ile RR yetersiz" |
| 7 | MT5 butonuna dokunuldu (bağlantı kapalı) | Bilgi mesajı, emir yok |
| 8 | Kopyala | Doğru formatta metin panoda |
| 9 | Son giriş saati geçti | Kart "SÜRE DOLDU", bildirim |
| 10 | TP1'e dokundu | Bildirim "%50 kapat + BE"; canlı kartta adım işaretli |
| 11 | F açık işlem, başarısız spring | "ÇIKIŞ" bildirimi sessiz saatte de sesli |
| 12 | "Girmedim — Korktum" | Kayıt + sanal sonuç takibi |
| 13 | Piyasa Yönü: COT verisi yok | Pozisyonlanma ağırlığı diğerlerine dağıtılır, not gösterilir |
| 14 | Twelve Data günlük kullanım %90 | Forex skorları 4 saatte bir güncellenir |
| 15 | Trend +1, yapı +1, diğer hepsi 0 (forex) | S = (25+20)/100 = 0,45 → Skor 73 "Bullish" |
| 16 | Myfxbook long %82 | retail = −clip(32/30) = −1 |
| 17 | Funding %0,08 | funding s = −1 |
| 18 | eToro pozisyon verisi erişilemez | Bölme sadece istatistik + Myfxbook + COT ile çalışır, uyarı notu |
| 19 | B ve G aynı gün aynı yönde TAM (XAU) | Tek emir kartı, "aynı fikir" etiketi |
| 20 | Koyu tema | Tüm yön renkleri §2.1 koyu tema değerleri |

> Not (test 2): Parçalara bölmede lot adımı korunur; tek sayılı kalan ilk (TP1) parçaya eklenir.

---

## 10. Uygulama sırası (önerilen aşamalar)
| Aşama | İçerik | Neden önce |
|---|---|---|
| 1 | Renk sistemi (§2), ayarlar + enstrüman tablosu (§1.1–1.2), ortak kredi sayacı (§1.4) | Her şeyin temeli |
| 2 | Lot hesaplayıcı + risk kilidi, emir kartı + Kopyala, MT5 butonu (pasif) + BrokerAdapter iskeleti, spread kontrolü, son giriş sayacı | TAM sinyali hemen kullanılabilir hale getirir |
| 3 | Canlı işlem ekranı, yönetim hatırlatıcıları, haber kilidi, iptal takibi, otomatik günlük, "Neden girmedim" | İşlem sürecinin tamamı |
| 4 | Piyasa Yönü sekmesi | Bağımsız modül |
| 5 | Başarılı Trader'lar bölmesi (önce kaynak doğrulaması) | Dış kaynak belirsizliği en yüksek olan |
| İleride | MT5 bağlantısını aktif etme (MetaApi veya EA köprüsü) | Kullanıcı kararıyla |
