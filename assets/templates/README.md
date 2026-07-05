# Template images (anh mau)

Dieu huong panel Search bang TOA DO (khong can template). Chi cac nut tren "card"/man March
la dung template. Cac template CHINH da duoc cat san tu game (540x960) va verify match tot:

| Ten file | La gi | Trang thai | Score test |
|---|---|---|---|
| `world_search_icon.png`| ANCHOR: kinh lup -> dang o world map | ✅ da co | 1.000 |
| `panel_go.png`         | ANCHOR: nut Go -> panel Search da mo | ✅ da co | 1.000 |
| `btn_hunt.png`         | Nut "Attack" tren card da thu | ✅ da co | 0.945 |
| `btn_gather.png`       | Nut "Gather" tren card tai nguyen | ✅ da co | 0.821 |
| `btn_march_deploy.png` | Nut "March" tren man March Troops | ✅ da co | 0.944 |
| `popup_no_march.png`   | Thong bao het luot hanh quan | ⬜ tuy chon | — |
| `popup_no_stamina.png` | Thong bao het the luc khi san | ⬜ tuy chon | — |

2 ANCHOR la mau chot chong "tap loan": bot XAC NHAN dung man hinh (world map / panel Search)
truoc khi tap theo toa do. Sai man -> BACK de dong, hoac dung task. Khong bao gio tap mu.

## 2 popup con thieu (khong bat buoc)
Neu KHONG co, bot van chay an toan: khi het luot/the luc, nut March khong hien ->
`deployMarch` tra ve false -> task tu ket thuc. Popup chi giup bot dung SOM & dung log ro hon.
Muon co: khi gap dung man het luot/het the luc -> `npm run capture` -> cat vung thong bao ->
luu `popup_no_march.png` / `popup_no_stamina.png`.

## Toa do panel & card (config/accounts.json -> config.world de ghi de)
Mac dinh (540x960), tat ca la ti le %:
- searchBtn [0.067,0.656], tabWild [0.170,0.953], tabResource [0.500,0.953]
- levelMinus [0.078,0.859], levelPlus [0.667,0.859], goBtn [0.845,0.859]
- slots[0] [0.500,0.719], slots[1] [0.843,0.719]
- center (tap muc tieu sau Go) [0.5,0.5]
- cardAction (Attack) [0.5,0.667], marchBtn (March) [0.733,0.945]

Chon LOAI: config.resourceSlot / config.beastSlot (0 = o thu 1).
Chinh LEVEL: config.resourceLevelTaps / config.beastLevelTaps (so lan bam '+' tu min).
