# ⭐ Kurulum N7 — NR7 Sıkışma Kırılımı — Uygulama Şartnamesi

Enstrümanlar: **XAUUSD, USDJPY, US100, US500, XAGUSD, WTI, ETHUSD**. Bağımsız modül. Ortak kurallar: `kurulum_P_Portfoy_ortak_spec.md`.
Mantık: Son 7 seans gününün **en dar** günü (NR7) bir sıkışmadır. Ertesi seans o günün tepesi kırılırsa LONG, dibi kırılırsa SHORT; stop NR7 gününün karşı ucu, hedef 1,5R, hedef gelmezse **seans sonunda kapat**.

> **Bu kurulumda da diğerlerindeki gibi:** **5 dakikalık tarama** (§5) ve **hatalı sinyal koruması** (§6) **zorunludur**. ⭐ = test edilmiş, parametreler kilitli.
> **Rejim filtresi yok** — iki yön de serbest.

---

## 1. Veri ve seans günü
| Enstrüman | Kaynak | Seans günü |
|---|---|---|
| XAUUSD | `XAU/USD` 1h, `timezone=UTC` | 18:00 → 17:00 strateji saati (TR 02:00 → 01:00), ≥ 12 adet 1H |
| USDJPY | `USD/JPY` 1h, `timezone=UTC` | Aynı |
| US100 | `QQQ` 1h (× oran) | Borsa günü 09:30–16:00 NY, ≥ 5 adet 1H |
| US500 | `SPY` 1h (× oran) | Aynı |
| XAGUSD | `SLV` 1h (× oran) | Aynı |
| WTI | `USO` 1h (× oran, haftalık zorunlu güncelleme) | Aynı |
| ETHUSD | Binance ETHUSDT 1h | 18:00 → 17:00 strateji saati, hafta sonu dahil |

Seans gününün `H` = içindeki 1H mumların en yükseği, `L` = en düşüğü, `Aralık = H − L`.

## 2. Sinyal (seans günü kapanışında)
| # | Şart |
|---|---|
| 1 | Biten seans gününün aralığı, kendisi dahil **son 7 seans gününün en küçük aralığına eşit** (NR7; eşitlik dahil) |
| 2 | Veri tamam (son 7 günün hepsi geçerli seans günü) |
| 3 | Bu enstrümanda açık ⭐N7 yok |

Sinyal üretildiğinde ertesi seans için iki seviye hazırlanır:
- **Al-stop:** `NR7_H` → LONG, stop `NR7_L`
- **Sat-stop:** `NR7_L` → SHORT, stop `NR7_H`
- `R = |giriş − stop|`, **hedef = giriş ± 1,5R**

## 3. Giriş — OCO stop emirleri (önerilen)
- Ertesi seans **başlarken** (24 saat piyasalar: TR 02:00; ETF'ler: borsa açılışı) iki bekleyen stop emri **OCO** olarak girilir: biri dolunca diğeri iptal.
- **Açılış boşluğu:** fiyat seviyenin ötesinde açılırsa giriş açılış fiyatından olur (testte de öyle: `giriş = max(açılış, NR7_H)`). Stop ve hedef **gerçek giriş fiyatına** göre yeniden hesaplanır (R büyür, hedef uzar).
- **Aynı 1H mum içinde iki seviye de kırıldıysa:** testte o gün işlem **yoktu**. Canlıda OCO ilk dokunanı doldurur → bu işlem günlükte "test dışı (çift kırılım)" etiketi alır.
- Lot, gerçek giriş fiyatı değil **planlanan** seviye ile hesaplanır (boşlukta risk %0,5'i biraz aşabilir; kart bunu gösterir).
- MT5 butonu pasif: emir kartı iki stop emrini, stopları ve hedefleri kopyalanabilir gösterir.

## 4. Yönetim ve çıkış
| Olay | Aksiyon |
|---|---|
| Stop | −1R (giriş mumunda da geçerli: giriş mumu stopa değerse zarar) |
| Hedef 1,5R | Tamamı kapanır. **Giriş mumunda hedef sayılmaz** (testte sadece sonraki mumlarda) |
| Seans sonu | Açık pozisyon seansın son 1H mumunun kapanışında piyasa emriyle kapatılır (24 saat piyasalar: 17:00 strateji saati = TR 01:00; ETF'ler: borsa kapanışı) |
| Seans boyunca hiçbir seviye kırılmadı | Emirler seans sonunda iptal |

Trailing, breakeven, yarı kâr **yok**.

## 5. 5 dakikalık tarama (zorunlu)
| Adım | Ne zaman | İş |
|---|---|---|
| A | Seans günü kapanışından sonraki ilk tarama | 1H verisi, günlük aralıklar, NR7 kontrolü |
| B | Sonraki tarama | Çift tarama teyidi (veri yeniden çekilir); NR7_H/NR7_L sabitlenir, emir kartı hazır |
| C | Seans boyunca her 5 dk (sinyal varsa) | Anlık fiyat: seviyeye yakınlık; dolum tespiti (fiyat seviyeyi geçti → "doldu" varsayımı, kullanıcı onayı istenir) |
| D | Pozisyon açıkken her 5 dk | Stop/hedef takibi, seans sonuna geri sayım |
| E | Seans bitimine 10 dk kala | "⭐N7: seans sonu — pozisyonu kapat" bildirimi |

## 6. Hatalı sinyal koruması (zorunlu)
Ortak tablo (ortak şartname §7.1–7.10) aynen. N7'ye özel:

| # | Kural |
|---|---|
| N7.1 | **Seans günü bütünlüğü:** NR7 karşılaştırmasındaki 7 günden biri eksik mum içeriyorsa (24 saat piyasa < 12, ETF < 5) sinyal yok. |
| N7.2 | **Kötü tick:** NR7 gününün H veya L'si tek bir 1H mumun > 5 ATR'lik iğnesinden geliyorsa (ortak §7.5) o mum çıkarılıp yeniden hesaplanır. |
| N7.3 | **Elle giriş son kontrolü:** OCO yerine bildirimle elle girilecekse, fiyat seviyeyi **> 0,25R** geçmişse "KAÇTI" (avantaj ince; kovalama yok). |
| N7.4 | **Kayma takibi:** gerçek giriş − planlanan giriş (R cinsinden) günlüğe yazılır. 20 işlem ortalaması > 0,05R ise sarı uyarı. |
| N7.5 | **Spread kontrolü:** emir anında spread, R'nin %5'inden büyükse kartta kırmızı "spread yüksek" — giriş önerilmez. |
| N7.6 | **Oran kontrolü (ETF tabanlı):** oran 7 günden eskiyse seviyeler "oran eski" etiketiyle; WTI'de kart ⏳. |

## 7. Durum mantığı
| # | Şart |
|---|---|
| 1 | Veri tamam ve taze |
| 2 | Dünkü seans NR7 |
| 3 | Bu seans içindeyiz ve seviyeler henüz kırılmadı |
| 4 | Açık ⭐N7 yok |
| 5 | Koruma (teyit 2/2, spread, oran) |

- **TAM (emir bekliyor):** 1–5 ✅ → "OCO emirlerini gir" kartı.
- **AKTİF:** seviye kırıldı, pozisyon açık.
- **YOK:** dün NR7 değil (kart "bugünün aralığı 7 günün en darı mı?" canlı göstergesi ile: bugünkü aralık / 7 günün minimumu).
- **EKSİK:** bugün NR7 olmaya aday (bugünkü aralık şu an en dar) — seans bitince belli olacak.

Bildirimler: "⭐N7: {sembol} NR7 — al-stop {H}, sat-stop {L}, hedefler ±1,5R, seans sonu {saat TR}" · "⭐N7: {sembol} {yön} doldu" · "⭐N7: hedef / stop / seans sonu kapanış, R {r}".

## 8. Çıktı şeması (JSON)
```json
{
  "setup": "N7", "star": true,
  "symbol": "XAUUSD | USDJPY | US100 | US500 | XAGUSD | WTI | ETHUSD",
  "evaluated_at_utc": "2026-11-06T23:05:10Z", "scan_seq": 2,
  "status": "TAM | AKTIF | EKSIK | YOK | VERI_GECIKMESI",
  "nr7": {"day": "2026-11-06", "high": 4071.2, "low": 4049.8, "range": 21.4, "min7": 21.4},
  "orders": {
    "buy_stop": {"entry": 4071.2, "stop": 4049.8, "target": 4103.3},
    "sell_stop": {"entry": 4049.8, "stop": 4071.2, "target": 4017.7},
    "oco": true, "expires_at_utc": "2026-11-07T22:00:00Z", "lots": 0.23
  },
  "position": {"open": false, "dir": null, "fill": null, "slip_r": null, "r_now": null},
  "protection": {"double_scan_ok": true, "spread_ok": true, "ratio_fresh": true, "blocked_by": null},
  "portfolio": {"week_r": 0.4}
}
```

## 9. Ekran (⭐N7 kartı)
1. Yedi satır: dün NR7 mi (✅/—), bugünkü aralık / 7 gün minimumu (%), durum.
2. TAM satırında: iki seviye, stoplar, hedefler, seans sonu geri sayımı.
3. Açık pozisyonda: yön (yeşil ▲ / kırmızı ▼), anlık R, hedef/stop uzaklığı, seans sonuna kalan süre.
4. Mini grafik (1H): NR7 günü kutusu, iki seviye, hedef çizgileri.

## 10. Test sonuçları (maliyet dahil, hedef 1,5R)
| Enstrüman | Eğitim (Mar 2022 – Kas 2025) | Son 1 yıl |
|---|---|---|
| XAUUSD | 130 işlem, +12,5R, PF 1,29 | 41 işlem, +6,9R, PF 1,51 |
| USDJPY | 143 işlem, +13,6R, PF 1,28 | 27 işlem, +8,1R, PF 2,49 |
| US100 (QQQ) | 133 işlem, +13,2R, PF 1,36 | 32 işlem, +5,7R, PF 2,06 |
| US500 (SPY) | 144 işlem, +13,3R, PF 1,34 | 45 işlem, +1,1R, PF 1,09 |
| XAGUSD (SLV) | 123 işlem, +10,6R, PF 1,35 | 43 işlem, +6,1R, PF 1,64 |
| WTI (USO) | 141 işlem, +12,1R, PF 1,34 | 36 işlem, +4,5R, PF 1,62 |
| ETHUSD | 197 işlem, +14,3R, PF 1,21 | 58 işlem, +9,0R, PF 1,51 |
| **Toplam** | 1011 işlem, **+89,7R**, PF 1,30 | 282 işlem (5,4/hafta), **+41,3R**, PF 1,58, en büyük düşüş −5,0R |

**Uyarılar:** İşlem başı ortalama +0,09…0,15R — **avantaj ince.** İşlem başına 0,05R ek kayma/spread eğitim kârını yarıya indirir. 2023 yılı −9R ile kapandı. Düşük spreadli broker ve sunucuda bekleyen stop emri şart.

## 11. Test senaryoları
1. Dünkü aralık 7 günün en küçüğü → OCO seviyeleri doğru (H, L), hedef ±1,5R.
2. Seans boşlukla seviyenin üstünde açıldı → giriş = açılış, stop = NR7_L, R ve hedef yeniden hesaplanır.
3. Giriş mumu aynı zamanda stopa değdi → −1R.
4. Giriş mumu hedefe değdi ama sonraki mumlarda değmedi → hedef sayılmaz, seans sonu kapanış.
5. Seans sonu → açık pozisyon kapanış fiyatıyla kapanır, bekleyen emir iptal.
6. Aynı 1H mumda iki seviye → canlıda "test dışı (çift kırılım)" etiketi.
7. 7 günden birinde 10 adet 1H mum (XAU) → sinyal yok (N7.1).
