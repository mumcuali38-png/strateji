# ⭐ Kurulum IB — İç Mum (Inside Day) Kırılımı — Uygulama Şartnamesi

Enstrümanlar: **XAUUSD, BTCUSD, US30, XAGUSD, AUDUSD**. Bağımsız modül. Ortak kurallar: `kurulum_P_Portfoy_ortak_spec.md`.
Mantık: Seans günü bir önceki günün **tamamen içinde** kaldıysa (iç gün) ve aynı zamanda NR7 değilse, ertesi seans o günün tepesi kırılırsa LONG, dibi kırılırsa SHORT. Stop karşı uç, hedef 1,5R, seans sonunda kapat.

> **Bu kurulumda da diğerlerindeki gibi:** **5 dakikalık tarama** (§5) ve **hatalı sinyal koruması** (§6) **zorunludur**. ⭐ = test edilmiş, parametreler kilitli.
> **Rejim filtresi yok.** Yönetim kuralları ⭐N7 ile birebir aynıdır; fark sadece sinyal tanımı ve enstrümanlardır.

---

## 1. Veri ve seans günü
| Enstrüman | Kaynak | Seans günü |
|---|---|---|
| XAUUSD | `XAU/USD` 1h, `timezone=UTC` | 18:00 → 17:00 strateji saati, ≥ 12 adet 1H |
| AUDUSD | `AUD/USD` 1h, `timezone=UTC` | Aynı |
| US30 | `DIA` 1h (× oran) | Borsa günü, ≥ 5 adet 1H |
| XAGUSD | `SLV` 1h (× oran) | Borsa günü, ≥ 5 adet 1H |
| BTCUSD | Binance BTCUSDT 1h | 18:00 → 17:00 strateji saati, hafta sonu dahil |

## 2. Sinyal (seans günü kapanışında)
| # | Şart |
|---|---|
| 1 | **İç gün:** `H_bugün < H_dün` **ve** `L_bugün > L_dün` (ikisi de kesin küçük/büyük; eşitlik iç gün sayılmaz) |
| 2 | **NR7 değil:** bugünün aralığı son 7 günün en küçüğüne eşit **değil** (NR7 olan iç günler ⭐N7'nin alanıdır; bu enstrümanlar N7 listesinde olmasa da kural aynen uygulanır — testte böyleydi) |
| 3 | Veri tamam (bugün ve dün geçerli seans günü; NR7 kontrolü için 7 gün) |
| 4 | Bu enstrümanda açık ⭐IB yok |

Seviyeler: **Al-stop** `IB_H` (stop `IB_L`), **Sat-stop** `IB_L` (stop `IB_H`), hedef **±1,5R**.

## 3. Giriş — OCO stop emirleri
⭐N7 §3 ile aynı:
- Ertesi seans başında iki stop emri OCO.
- Boşlukla açılışta giriş = açılış; R ve hedef gerçek girişe göre.
- Aynı 1H mumda iki seviye → testte işlem yok; canlıda "test dışı (çift kırılım)".

## 4. Yönetim ve çıkış
⭐N7 §4 ile aynı: stop −1R (giriş mumu dahil), hedef 1,5R (giriş mumu hariç), seans sonunda piyasa emriyle kapanış, kırılım olmazsa emirler seans sonunda iptal. Trailing/BE/yarı kâr yok.

## 5. 5 dakikalık tarama (zorunlu)
| Adım | Ne zaman | İş |
|---|---|---|
| A | Seans günü kapanışından sonraki ilk tarama | Dün/bugün H-L, iç gün ve NR7 kontrolü |
| B | Sonraki tarama | Çift tarama teyidi → emir kartı |
| C | Seans boyunca her 5 dk | Seviyeye yakınlık, dolum tespiti |
| D | Pozisyon açıkken her 5 dk | Stop/hedef, seans sonu geri sayımı |
| E | Seans bitimine 10 dk kala | "⭐IB: seans sonu — kapat" |

## 6. Hatalı sinyal koruması (zorunlu)
Ortak tablo (§7.1–7.10) aynen. IB'ye özel:

| # | Kural |
|---|---|
| IB.1 | **Kesin içerme:** H/L karşılaştırması fiyat adımına yuvarlanmış değerlerle yapılır (XAU 0,01; AUDUSD 0,00001; ETF 0,01; BTC 0,01). Eşitlik → iç gün değil. |
| IB.2 | **Seans bütünlüğü:** dün veya bugün eksik mumlu ise sinyal yok. |
| IB.3 | **Elle giriş son kontrolü:** seviye > 0,25R geçilmişse "KAÇTI". |
| IB.4 | **Spread:** spread > R'nin %5'i → giriş önerilmez (dar iç günlerde R küçük olabilir). |
| IB.5 | **Kayma takibi:** ⭐N7.4 ile aynı. |
| IB.6 | **N7 ile çakışma:** aynı enstrüman aynı gün hem NR7 hem iç gün olamaz (kural 2). XAU ve XAG'da ⭐N7 ve ⭐IB farklı günlerde sinyal verir; aynı anda iki pozisyon ancak farklı günlerin sinyalleriyle oluşabilir — izinli. |

## 7. Durum mantığı
- **TAM (emir bekliyor):** dün iç gün (NR7 değil), seviyeler kırılmadı, koruma ✅.
- **AKTİF:** pozisyon açık.
- **EKSİK:** bugün şu ana kadar dünün içinde (iç gün adayı) — seans bitince belli olacak.
- **YOK:** dün iç gün değil.

Bildirimler: "⭐IB: {sembol} iç gün — al-stop {H}, sat-stop {L}, hedef ±1,5R" · "⭐IB: {yön} doldu" · "⭐IB: hedef/stop/seans sonu, R {r}".

## 8. Çıktı şeması (JSON)
```json
{
  "setup": "IB", "star": true,
  "symbol": "XAUUSD | BTCUSD | US30 | XAGUSD | AUDUSD",
  "evaluated_at_utc": "2026-11-06T23:05:10Z", "scan_seq": 2,
  "status": "TAM | AKTIF | EKSIK | YOK | VERI_GECIKMESI",
  "inside_day": {"day": "2026-11-06", "high": 4071.2, "low": 4039.8, "prev_high": 4088.0, "prev_low": 4021.5, "is_nr7": false},
  "orders": {"buy_stop": {"entry": 4071.2, "stop": 4039.8, "target": 4118.3},
             "sell_stop": {"entry": 4039.8, "stop": 4071.2, "target": 3992.7},
             "oco": true, "expires_at_utc": "2026-11-07T22:00:00Z", "lots": 0.16},
  "position": {"open": false, "dir": null, "fill": null, "slip_r": null, "r_now": null},
  "protection": {"double_scan_ok": true, "spread_ok": true, "blocked_by": null},
  "portfolio": {"week_r": 0.4}
}
```

## 9. Ekran (⭐IB kartı)
1. Beş satır: dün iç gün mü, bugün iç gün adayı mı, durum.
2. TAM: iki seviye, stoplar, hedefler, seans sonu geri sayımı.
3. Açık pozisyon: yön (yeşil/kırmızı), anlık R.
4. Mini grafik (1H): dün ve önceki gün kutuları, seviyeler.

## 10. Test sonuçları (maliyet dahil)
| Enstrüman | Eğitim | Son 1 yıl |
|---|---|---|
| XAUUSD | 76 işlem, +10,8R, PF 1,60 | 19 işlem, +5,2R, PF 2,52 |
| BTCUSD | 131 işlem, +9,1R, PF 1,25 | 32 işlem, +2,7R, PF 1,35 |
| US30 (DIA) | 52 işlem, +5,4R, PF 1,48 | 18 işlem, −1,2R, PF 0,78 |
| XAGUSD (SLV) | 52 işlem, +2,5R, PF 1,26 | 15 işlem, +0,2R, PF 1,10 |
| AUDUSD | 71 işlem, +3,4R, PF 1,18 | 17 işlem, +2,5R, PF 1,77 |
| **Toplam** | 382 işlem, **+31,1R**, PF 1,33 | 101 işlem (1,9/hafta), **+9,4R**, PF 1,44 |

**Uyarı:** Avantaj ince (işlem başı ~+0,08R). Portföye uzun vadede net katkısı artı.

## 11. Test senaryoları
1. Bugün H < dün H ve L > dün L, NR7 değil → TAM.
2. Bugün H = dün H → iç gün değil.
3. İç gün aynı zamanda NR7 → IB sinyali yok.
4. Boşluk, giriş mumu stopu, hedef giriş mumunda, seans sonu → ⭐N7 senaryolarıyla aynı sonuçlar.
5. BTC Pazar günü iç gün → Pazartesi seansı geçerli.
