# ⭐ Portföy — Ortak Kurallar — Uygulama Şartnamesi

Bu dosya beş ⭐ kurulumun (**⭐M2, ⭐T4-S, ⭐N7, ⭐IB, ⭐TD**) ortak altyapısını ve portföy seviyesindeki kuralları tanımlar. Her kurulumun kendi şartnamesi ayrıca vardır; çelişki olursa **kurulumun kendi şartnamesi** geçerlidir, portföy risk kuralları (§6) ise her zaman en üsttedir.

> **⭐ işareti ne demek?** Kurallar sabit, 3,7 yıllık eğitim + son 1 yıllık ayrı sınavdan geçmiş kurulum. Uygulamada her yerde (sekme başlığı, kart, bildirim, günlük kayıt) adın önünde ⭐ gösterilir. Diğer kurulumlarda (A, B, E, F, G, H …) yıldız yoktur.
>
> **Kural değişikliği yasak:** ⭐ kurulumların sayısal parametreleri ayarlar ekranında **kilitli** gösterilir (salt okunur). Değiştirilirse ⭐ kaldırılır ve kurulum "test edilmemiş" etiketi alır.

---

## 1. Kurulum listesi

| Kurulum | Tür | Zaman dilimi | Enstrümanlar | Haftada işlem (test) |
|---|---|---|---|---|
| ⭐M2 | Trend takibi (Donchian 10/5) | 1H | XAUUSD, US100, USDJPY | 3,6 |
| ⭐T4-S | Trend takibi (Donchian 20/10) + yarı kâr | 4H | XAUUSD, US100, US30, XAGUSD, BTCUSD | 1,1 |
| ⭐N7 | NR7 sıkışma kırılımı | Günlük sinyal, 1H izleme | XAUUSD, USDJPY, US100, US500, XAGUSD, WTI, ETHUSD | 5,4 |
| ⭐IB | İç mum kırılımı | Günlük sinyal, 1H izleme | XAUUSD, BTCUSD, US30, XAGUSD, AUDUSD | 1,9 |
| ⭐TD | Turtle (Donchian 55/20) + yarı kâr | Günlük | XAUUSD, US100, US500, US30, XAGUSD, BTCUSD, ETHUSD | 0,4 |
| **Toplam** | | | | **≈ 11–12** |

---

## 2. Zaman

- **Strateji saati = sabit UTC-5** (NY yaz saati uygulanmaz). TR = strateji saati + 8 saat.
- **Seans günü (24 saat açık piyasalar):** 18:00 → ertesi gün 17:00 strateji saati (TR 02:00 → 01:00). Bir seans günü en az **12** adet 1H mum içermeli, yoksa o gün hesap dışı.
- **Hafta sonu boşluğu (XAU, döviz, endeks CFD):** Cuma 17:00 – Pazar 18:00 strateji saati arası mumlar yok sayılır. **BTC/ETH** için hafta sonu çıkarılmaz (7/24).
- **ETF tabanlı enstrümanlar (US100, US500, US30, XAG, WTI — bkz. §3):** sadece borsa seansı (09:30–16:00 NY). Seans günü = borsa günü, en az **5** adet 1H mum.
- **4H mum sınırları:** 24 saat piyasalarda strateji saatiyle 02/06/10/14/18/22. ETF tabanlılarda günde 2 blok: strateji saatiyle **12:30'dan önceki** 1H mumlar = 1. blok, 12:30 ve sonrası = 2. blok (en az 2 mum).

## 3. Veri kaynakları

| Enstrüman | Sinyal verisi | Emir seviyesi dönüşümü | Not |
|---|---|---|---|
| XAUUSD | Twelve Data `XAU/USD`, `timezone=UTC` | Yok | |
| USDJPY, AUDUSD | Twelve Data `USD/JPY`, `AUD/USD`, `timezone=UTC` | Yok | `timezone=UTC` verilmezse saat Avustralya/Sidney gelir — **zorunlu parametre** |
| US100 | Twelve Data `QQQ`, NY saati | US100 = QQQ × oran (varsayılan 41,05) | Oran haftada bir güncellenir |
| US500 | Twelve Data `SPY` | US500 = SPY × oran | Oran ilk açılışta CFD/ETF fiyatından hesaplanır |
| US30 | Twelve Data `DIA` | US30 = DIA × oran | Aynı |
| XAGUSD | Twelve Data `SLV` | XAG = SLV × oran | `XAG/USD` ücretsiz planda yok (Grow/Venture gerekir). Testler SLV ile yapıldı. |
| WTI | Twelve Data `USO` | WTI = USO × oran | USO fon yapısı nedeniyle oran kayar → **oran haftada bir zorunlu güncelleme**, güncellenmezse WTI kartı ⏳ |
| BTCUSD, ETHUSD | Binance `data-api.binance.vision` BTCUSDT/ETHUSDT | Yok | Kredi harcamaz; yedek Coinbase |

- Günlük ve 4H mumlar **1H mumlardan türetilir** (§2 kurallarıyla); ayrı günlük/4H çağrısı yapılmaz.
- Twelve Data çağrıları ortak kredi sayacından geçer (**8/dk, 800/gün**, asla aşılmaz). Hata dönen çağrı da kredi sayılır → hata sonrası tekrar en erken bir sonraki dakikada.
- Oranlı enstrümanlarda tüm seviyeler (giriş, stop, hedef) **önce ETF üzerinde** hesaplanır, sonra oranla CFD'ye çevrilir. Ekranda iki değer de gösterilir.

## 4. Ortak göstergeler (kesin formüller)

| Ad | Formül |
|---|---|
| ATR14 | Wilder: `TR = max(H−L, |H−C₋₁|, |L−C₋₁|)`, ilk değer ilk 14 TR'nin ortalaması, sonra `ATR = (ATR₋₁×13 + TR)/14`. İlgili zaman diliminde hesaplanır. |
| EMA(n) | İlk değer ilk n kapanışın ortalaması, sonra `k = 2/(n+1)`. |
| Donchian üst(n) | **Mevcut mum hariç** önceki n mumun en yüksek High'ı. |
| Donchian alt(n) | **Mevcut mum hariç** önceki n mumun en düşük Low'u. |
| Günlük rejim | Son **kapanmış** seans gününe göre: `C > EMA50 > EMA200` **ve** `C / C₋₆₀ − 1 > 0` → **+1 (sadece LONG)**; `C < EMA50 < EMA200` **ve** `C / C₋₆₀ − 1 < 0` → **−1 (sadece SHORT)**; aksi halde **0 (işlem yok)**. Seans günü kapanışı 17:00 strateji saati (ETF'lerde borsa kapanışı). |

Rejim filtresi ⭐M2, ⭐T4-S, ⭐TD'de kullanılır; ⭐N7 ve ⭐IB'de **kullanılmaz**.

## 5. Ortak 5 dakikalık tarama motoru

- Motor **her 5 dakikada**, 5m mum kapanışından **10 sn sonra** çalışır (…:00:10, …:05:10).
- ⭐ kurulumların sinyalleri **1H / 4H / günlük kapanışlarında** oluşur. 5 dk tarama şunlar içindir:
  1. Kapanışı yakalamak (1H kapanışından sonraki ilk tarama sinyali hesaplar).
  2. **Çift tarama teyidi** (§7.3) için ikinci okumayı yapmak.
  3. Bekleyen emir (⭐N7/⭐IB stop emirleri) ve açık işlemleri (stop, hedef, yarı kâr, çıkış) anlık fiyatla izlemek.
- Kredi planı: her enstrüman için saat başı **1** adet 1H çağrısı (`outputsize=3`, günde bir kez `outputsize=1500` tam yükleme) + sadece **açık işlem veya bekleyen emir varken** 5 dakikada bir `price`. Tahmini toplam: Twelve Data **≤ 650/gün** (8 enstrüman), BTC/ETH 0. Günlük sayaç %90'a gelirse açık işlemi olmayan enstrümanlarda `price` 15 dk'ya iner.

## 6. Portföy risk kuralları (en üst öncelik)

| Kural | Değer | Not |
|---|---|---|
| İşlem başı risk | Hesabın **%0,5**'i (ayarlardan %0,25–%1) | Lot = risk tutarı / (giriş−stop mesafesi × kontrat değeri). Ortak lot modülü. |
| Haftalık limit | **Yok** — kullanıcı kendisi kontrol eder | Uygulama haftalık R'yi sadece **gösterir** (Pazartesi 00:00 strateji saati = TR Pazartesi 08:00 – Pazar), yeni girişi engellemez, uyarı vermez. |
| Aynı enstrümanda birden çok ⭐ kurulum | **Serbest** (testte bağımsız çalıştılar) | Kart "aynı yönde 2 ⭐ pozisyon" bilgisini gösterir. Toplam açık risk hesabın %3'ünü geçerse sarı uyarı (engellemez). |
| Bir kurulum + enstrüman | Aynı anda **en fazla 1** pozisyon | Pozisyon kapanmadan aynı kurulum aynı enstrümanda yeni sinyal üretmez. |

Testteki beklenti (işlem başı maliyet dahil, haftalık limit yok):

| Dönem | İşlem/hafta | Toplam | Aylık ort. | Pozitif ay | En kötü hafta | En büyük düşüş |
|---|---|---|---|---|---|---|
| Eğitim (Mar 2022 – Kas 2025) | 12,8 | +343R | +7,6R | 34/45 | −10,0R | −27,7R |
| Son 1 yıl (Kas 2025 – Kas 2026) | 12,5 | +110R | +8,4R | 11/13 | −5,5R | −17,4R |

Gerçekçi hedef: ayda **+5–7R**. Limit olmadığı için kötü haftalar −10R'ye, kötü aylar −13R'ye kadar inebilir (eğitimde görüldü).

## 7. Ortak hatalı sinyal koruması (her ⭐ kurulumda zorunlu)

Her kurulum şartnamesindeki "Hatalı sinyal koruması" bölümü bu tabloyu uygular ve kendine özel maddeleri ekler.

| # | Koruma | Kural |
|---|---|---|
| 7.1 | Sadece kapanmış mum | Mumun `datetime + interval > şimdi` ise hesap dışı. Türetilmiş 4H/günlük mum, son 1H mumu kapanmadan kapanmış sayılmaz. |
| 7.2 | Repaint yok | Donchian/NR7/iç mum sadece kapanmış mumlardan. Gösterilen sinyal geçmişte değiştirilmez; iptal olursa "iptal" olarak kayıtta kalır. |
| 7.3 | Çift tarama teyidi | Sinyal, kapanıştan sonraki **iki ardışık 5 dk taramada** (veri yeniden çekilerek) aynı sonucu vermeli. Sonra TAM bildirimi. |
| 7.4 | Veri tazeliği | Son kapanmış 1H mum beklenenden 2 saatten eskiyse "VERİ GECİKMESİ" → o enstrümanda sinyal yok, sarı uyarı. |
| 7.5 | Kötü tick | Tek 1H mum aralığı `> 5 × ATR14_1H` ve sonraki mum hareketin %50'sinden fazlasını geri almışsa o mum hesaplardan çıkarılır. Anlık fiyat ile son kapanış farkı `> %0,3` (XAU, FX, ETF) / `> %1` (kripto) ise bir sonraki taramayı bekle. |
| 7.6 | Eksik mum | Hesap penceresinde beklenmeyen boşluk varsa gösterge hesaplanmaz → ⏳ "veri eksik". Hafta sonu ve seans dışı beklenen boşluktur. |
| 7.7 | Tekrar / soğuma | Her sinyalin benzersiz kimliği (`{kurulum}-{sembol}-{sinyal mumu UTC}`) — ikinci kez bildirilmez. |
| 7.8 | Son kontrol | Emir kartı açılmadan hemen önce anlık fiyat alınır. Kuruluma özel "KAÇTI" eşiği aşılmışsa TAM bildirimi gönderilmez (eşikler kurulum şartnamelerinde). |
| 7.9 | Haber | **Testlerde haber filtresi yoktu.** Bu yüzden haber girişi engellemez; kırmızı USD haberine ≤ 30 dk varsa kartta "HABER RİSKİ" etiketi ve bildirimde uyarı. Kullanıcı ayarlardan engellemeyi açabilir; açarsa ⭐ yanına "(H)" eklenir — test dışı kullanım. |
| 7.10 | Oran tazeliği | Oranlı enstrümanda oran 7 günden eskiyse (WTI için zorunlu) emir kartı seviyeleri "oran eski" uyarısıyla gösterilir; WTI'de kart ⏳. |

## 8. Komutlar (sohbet ve uygulama)

| Komut | Çıktı |
|---|---|
| `⭐ durum` / `Portföy durum` | Beş kurulumun özet tablosu + bu haftanın R'si |
| `M2 durum`, `T4 durum`, `N7 durum`, `IB durum`, `TD durum` | İlgili kurulumun şart tablosu (✅/❌/⏳), setup, haber tablosu |

Yanıt formatı diğer kurulumlarla aynı: Durum TAM/EKSİK/YOK → şart tablosu → setup veya eksik → haber tablosu. Saatler TR.

## 9. Ekran — "⭐ Portföy" sekmesi

1. Üstte haftalık şerit: bu hafta kapanmış ⭐ R toplamı ve açık risk (sadece bilgi; limit yok).
2. Beş kurulum kartı (⭐ adıyla). Her kartta enstrüman satırları: yön (yeşil ▲ LONG / kırmızı ▼ SHORT), durum rozeti, açık pozisyon R'si.
3. Aylık takvim: gün gün ⭐ R (yeşil/kırmızı).
4. Test beklentisi kutusu (§6 tablosu) ve "gerçekleşen vs beklenen" karşılaştırması (aylık).
5. MT5 butonu tüm emir kartlarında **görünür ama pasif**.

## 10. Otomatik günlük (journal)

Her ⭐ işlem için: kurulum, sembol, yön, sinyal mumu, giriş/stop/hedef, gerçek giriş fiyatı, **kayma (R)**, spread, çıkış nedeni, R. Haftalık rapor: kurulum başına R ve testteki ortalamayla fark. Kayma ortalaması **0,05R'yi** geçerse ⭐N7 ve ⭐IB kartlarında sarı uyarı ("avantaj ince — broker/spread kontrol").
