# ⭐ Kurulum M2 — 1H Trend Kırılımı (Donchian 10/5) — Uygulama Şartnamesi

Enstrümanlar: **XAUUSD, US100, USDJPY**. Bağımsız modül. Ortak kurallar: `kurulum_P_Portfoy_ortak_spec.md` (zaman, veri, ATR/EMA/rejim formülleri, risk).
Mantık: Günlük trend yönünde, 1H'te son 10 mumun tepesini (dibini) kapanışla kıran harekete katıl; son 5 mumun dibi (tepesi) kırılınca çık.

> **Bu kurulumda da diğerlerindeki gibi:** **5 dakikalık tarama** (§5) ve **hatalı sinyal koruması** (§6) **zorunludur**.
> ⭐ = test edilmiş, parametreler kilitli.

---

## 1. Veri
| Enstrüman | Kaynak | Not |
|---|---|---|
| XAUUSD | Twelve Data `XAU/USD`, `timezone=UTC`, 1h | 24 saat, hafta sonu boşluğu çıkarılır |
| US100 | Twelve Data `QQQ`, 1h, NY saati | Sadece borsa seansı mumları. Seviyeler QQQ'da hesaplanır, US100 = QQQ × oran |
| USDJPY | Twelve Data `USD/JPY`, `timezone=UTC`, 1h | 24 saat |

Gerekli geçmiş: en az **260** adet 1H mum (EMA ve Donchian ısınması) + rejim için en az **210** seans günü.

## 2. Göstergeler
- `DU10` = Donchian üst(10) — mevcut mum hariç önceki 10 adet 1H mumun en yüksek High'ı
- `DA10` = Donchian alt(10)
- `DU5`, `DA5` = Donchian üst/alt(5)
- `ATR14_1H` (Wilder)
- `REJIM` = ortak şartname §4 (günlük, son kapanmış seans günü)

## 3. Giriş (her 1H kapanışında)
| # | Şart | LONG | SHORT |
|---|---|---|---|
| 1 | Rejim | `REJIM = +1` | `REJIM = −1` |
| 2 | Kırılım | 1H kapanış `C > DU10` | `C < DA10` |
| 3 | Pozisyon yok | Bu enstrümanda açık ⭐M2 yok | aynı |

- **Giriş:** Teyitten sonra **piyasa emri** (testte bir sonraki 1H açılışı).
- **Stop:** `giriş − 2 × ATR14_1H` (LONG), `giriş + 2 × ATR14_1H` (SHORT). ATR = sinyal mumunun ATR'si.
- **Hedef yok.** Kâr alma yok; çıkış §4.
- Rejim 0 iken hiçbir yönde işlem yok.

## 4. Çıkış
| Olay | Aksiyon |
|---|---|
| Fiyat stopa değdi | Stop (sunucuda bekleyen stop emri) |
| LONG: 1H kapanış `C < DA5` | Kalanın tamamı piyasa emriyle kapatılır (testte bir sonraki açılış) |
| SHORT: 1H kapanış `C > DU5` | Aynı |
| Rejim değişti | **Çıkış nedeni değildir** (testte yoktu) |
| Hafta sonu | Pozisyon taşınır (testte taşındı). US100 için seans dışında stop sunucuda kalır |

Stop hiçbir zaman genişletilmez, trailing yoktur (çıkışı Donchian 5 yapar).

## 5. 5 dakikalık tarama (zorunlu)
| Adım | Ne zaman | İş |
|---|---|---|
| A | Her 1H kapanışından sonraki ilk tarama (…:00:10) | 1H çağrısı (`outputsize=3`), DU10/DA10/DU5/DA5/ATR, rejim (seans günü kapanışından sonra) |
| B | Bir sonraki tarama (…:05:10) | Çift tarama teyidi: veri yeniden çekilir, A'daki sonuç aynıysa TAM |
| C | Her 5 dk, açık ⭐M2 varsa | Anlık fiyat; stop takibi; ekranda anlık R |
| D | Her 1H kapanışında, açık ⭐M2 varsa | Çıkış şartı (§4) |

US100 sadece borsa seansında taranır (TR: kışın 17:30–24:00, yazın 16:30–23:00).

## 6. Hatalı sinyal koruması (zorunlu)
Ortak tablo (ortak şartname §7.1–7.10) aynen uygulanır. M2'ye özel:

| # | Kural |
|---|---|
| M2.1 | **Son kontrol eşiği:** Teyitten sonra anlık fiyat sinyal kapanışından itibaren yön lehine **> 0,5 × ATR14_1H** ilerlemişse "KAÇTI" → TAM bildirilmez, bir sonraki kapanış beklenir. |
| M2.2 | **Rejim histerezisi yok:** rejim formülü testteki gibi uygulanır (değiştirilmez). Rejim 0'a döndüğünde açık işlem kapatılmaz. |
| M2.3 | **US100 seans açılışı:** QQQ ilk 1H mumu henüz kapanmadıysa önceki günün mumlarıyla sinyal üretilmez. |
| M2.4 | **Çakışma:** Aynı enstrümanda ⭐T4-S/⭐TD aynı yönde açıksa kart "aynı yön" bilgisini gösterir, engellemez. |

## 7. Durum mantığı
| # | Şart |
|---|---|
| 1 | Veri tamam ve taze |
| 2 | Rejim ±1 |
| 3 | 1H kapanış Donchian 10 dışında (rejim yönünde) |
| 4 | Açık ⭐M2 yok |
| 5 | Hatalı sinyal koruması (teyit 2/2, son kontrol) |

- **TAM:** 1–5 ✅ → emir kartı + bildirim.
- **EKSİK:** rejim var, kırılım bekleniyor (⏳ 3). Kartta "kırılım seviyesi: DU10 = …, fiyata uzaklık: … ATR".
- **YOK:** rejim 0 veya veri yok.
- **TAM – BEKLE:** 1–4 ✅, teyit 1/2.

Bildirimler: "⭐M2: {sembol} {yön} TAM — giriş ~{fiyat}, stop {s} (2 ATR), çıkış: 1H kapanış {DA5/DU5} ötesi" · "⭐M2: {sembol} çıkış — 1H kapanış Donchian 5 kırıldı, R {r}".

## 8. Çıktı şeması (JSON)
```json
{
  "setup": "M2", "star": true,
  "symbol": "XAUUSD | US100 | USDJPY",
  "evaluated_at_utc": "2026-11-06T14:05:10Z", "scan_seq": 2,
  "status": "TAM | EKSIK | YOK | TAM_BEKLE | VERI_GECIKMESI",
  "direction": "LONG | SHORT | null",
  "regime": {"value": 1, "close": 4060.1, "ema50": 3962.0, "ema200": 3720.5, "ret60": 0.081},
  "donchian": {"du10": 4071.2, "da10": 4012.4, "du5": 4066.0, "da5": 4031.8},
  "atr14_1h": 11.7,
  "order": {"type": "MARKET", "ref_price": 4072.4, "stop": 4049.0, "risk_pct": 0.5, "lots": 0.21},
  "position": {"open": false, "entry": null, "stop": null, "r_now": null},
  "protection": {"double_scan_ok": true, "fresh": true, "final_check": "OK | KACTI", "blocked_by": null},
  "portfolio": {"week_r": -1.2}
}
```

## 9. Ekran (⭐M2 kartı)
1. Üç satır (XAU, US100, USDJPY): rejim rozeti (▲ yeşil / ▼ kırmızı / — gri), durum.
2. Kırılım seviyesi ve fiyata uzaklığı (ATR cinsinden).
3. Açık pozisyonda: giriş, stop, anlık R, çıkış seviyesi (DA5/DU5) ve "son 1H kapanışta çıkış yok/var".
4. Mini grafik (1H): Donchian 10 ve 5 kanalları, giriş/stop çizgileri.

## 10. Test sonuçları (maliyet dahil)
| Enstrüman | Eğitim (Mar 2022 – Kas 2025) | Son 1 yıl |
|---|---|---|
| XAUUSD | 347 işlem, +67,5R, PF 1,43 | 95 işlem, **+19,9R**, PF 1,49 |
| US100 (QQQ) | 141 işlem, +13,2R, PF 1,20 | 28 işlem, **+7,0R**, PF 1,88 |
| USDJPY | 266 işlem, +18,6R, PF 1,16 | 71 işlem, **+20,1R**, PF 1,62 |
| **Toplam** | 754 işlem, +99,3R | 194 işlem (3,7/hafta), **+47,0R**, PF 1,58 |

Kazanma oranı ~%35–40; kâr birkaç uzun trendden gelir — art arda 5–8 küçük zarar normaldir.
Test maliyeti: XAU 0,30$, USDJPY 1,2 pip, QQQ %0,01 / işlem.

## 11. Test senaryoları
1. Rejim +1, 1H kapanış DU10'un 0,1 üstünde → 2. taramada aynı → TAM, stop = giriş − 2 ATR.
2. Rejim −1 iken LONG kırılım → YOK.
3. Açık LONG, 1H kapanış DA5'in altında → çıkış bildirimi.
4. Açık LONG, rejim 0'a döndü → pozisyon devam.
5. Teyit taramasında fiyat 0,6 ATR ilerlemiş → KAÇTI, bildirim yok.
6. USDJPY verisi `timezone` parametresiz gelirse → testte saat kayması tespit edilir, hata.
