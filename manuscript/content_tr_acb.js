// ACB sürümünün Türkçe okuma kopyası: content_tr.js üzerine content_acb.js ile aynı değişiklikler.
const tr = require("./content_tr.js");
const acb = require("./content_acb.js");
const C = JSON.parse(JSON.stringify(tr));
function sub(arr, i, pairs) { for (const [a, b] of pairs) { if (!arr[i].includes(a)) throw new Error("eksik: " + a.slice(0, 60)); arr[i] = arr[i].replace(a, b); } }

C.shortTitle = "Ölçüm kesinliğinden kontrol kuralları: izin verilen hata kaynağı belirler (ACB sürümü, Türkçe)";
C.abstract = {
  "Arka plan": "İç kalite kontrol kuralları nadiren ölçülen ölçüm kesinliğinden türetilir ve yargılandıkları izin verilen toplam hata (TEa) birbiriyle uyuşmayan kaynaklardan gelir. On klinik kimya ve immünoassay ölçüm büyüklüğü için kurallar türettik ve bunların TEa kaynağına ne ölçüde bağlı olduğunu inceledik.",
  "Yöntem": tr.abstract["Yöntem"].replace("sodyum, kreatinin, ALT, glukoz, kalsiyum, TSH, yüksek duyarlıklı troponin T, ferritin, PSA ve 25-OH D vitamini için", "on ölçüm büyüklüğü için"),
  "Bulgular": tr.abstract["Bulgular"],
  "Sonuç": tr.abstract["Sonuç"],
};

sub(C.introduction, 2, [[
  "Bir hematoloji paneli üzerindeki önceki çalışmada İKK kurallarını üç cihazın havuzlanmış lot içi ölçüm kesinliğinden türetmiş, hedefi laboratuvarın kendi havuzlanmış ortalamasından almış ve bir parametrenin kontrol edilebilir görünüp görünmemesinin cihaz performansından çok TEa kaynağına bağlı olduğunu bulmuştuk [15]. Bu çalışma aynı yöntemi Roche cobas pro platformunda on klinik kimya ve immünoassay ölçüm büyüklüğüne, çok daha fazla aday TEa kaynağıyla ve kalibrasyon ile reaktif lotu değişimlerinin Gauss yanlış ret tahminini uygulamada sınadığı 14 aylık veriyle uyguluyor.",
  "Bu çalışma, Roche cobas pro üzerinde on klinik kimya ve immünoassay ölçüm büyüklüğü için İKK kurallarını laboratuvarın kendi cihazlarının havuzlanmış lot içi ölçüm kesinliğinden, hedefi kendi lot ortalamasına koyarak türetiyor ve üç soru soruyor: yayımlanmış 14 TEa kaynağından hangileri bir kuralı hiç ulaşılabilir bırakıyor; kontrol seviyelerinin CV'leri farklıyken kritik hata nasıl boyutlandırılmalı; ve kalibrasyon ile reaktif lotu değişimlerinin yaşandığı 14 aylık veride Gauss yanlış ret tahmini tutuyor mu. Yaklaşımın bir hematoloji paneline ilk uygulaması TEa kaynağının cihazdan daha belirleyici olduğunu bulmuştu [15]; bu çalışma onu çok daha fazla aday kaynakla genişletiyor ve oradaki kritik hata boyutlandırma yöntemini düzeltiyor.",
]]);

const rd = C.methods.find((s) => s[0] === "Kuralların türetilmesi");
sub(rd, 1, [
  ["Her seviyeyi kendi kritik kaymasında (sigma − 1,65) değerlendirmek, hematoloji çalışmasında yapıldığı gibi [15], birleşik saptamayı olduğundan yüksek gösterir;",
   "Her seviyeyi kendi kritik kaymasında (sigma − 1,65) değerlendirmek her seviye için ayrı bir soruya yanıt verir ve birleşik saptamayı olduğundan yüksek gösterir;"],
  ["Saptama gereği sodyum, kreatinin, glukoz, kalsiyum ve hs-TnT için %90; ALT, TSH, ferritin, PSA ve 25-OH D vitamini için %70 olarak, hematoloji çalışmasındaki klinik ağırlıklandırma izlenerek belirlendi [15].",
   "Saptama gereği klinik yargıyla, kaçırılan bir sistematik hatanın tedavi kararlarını saatler içinde değiştirdiği sodyum, kreatinin, glukoz, kalsiyum ve hs-TnT için %90, diğerleri için %70 olarak belirlendi."],
]);
sub(rd, 2, [[
  "Hesaplamalar DesignLabIQC aracınınkilerdir [15]; bu çalışma için iki seviyeli panellere, kullanıcının girdiği TEa kaynaklarına ve cobas infinity dışa aktarımlarının doğrudan içe aktarılmasına genişletildi (DesignLabIQC-ClinChem, https://github.com/mfkilinckaya-svg/DesignLabIQC-ClinChem, MIT lisansı). Araç kurulum gerektirmeden tarayıcıda çalışan tek bir HTML dosyasıdır ve bu çalışmanın paneli yüklü olarak açılır.",
  "Hesaplamalar tarayıcı tabanlı bir araçta uygulandı (DesignLabIQC-ClinChem, https://github.com/mfkilinckaya-svg/DesignLabIQC-ClinChem, MIT lisansı): kurulum gerektirmeden çalışan, iki seviyeli panelleri, kullanıcının girdiği TEa kaynaklarını ve cobas infinity dışa aktarımlarının doğrudan içe aktarılmasını kabul eden ve bu çalışmanın paneli yüklü olarak açılan tek bir HTML dosyası.",
]]);

const r3 = C.results.find((s) => s[0] === "Türetilen kurallar");
sub(r3, 1, [["Figür 5 hatanın büyüklüğüne karşı", "Figür 3 hatanın büyüklüğüne karşı"]]);
const r4 = C.results.find((s) => s[0] === "Geriye dönük ret");
sub(r4, 1, [["ALT L1 %3,8'den %1,1'e düştü (Figür 3).", "ALT L1 %3,8'den %1,1'e düştü (Ek Figür S1)."], ["Figür 4 dört seviye için örüntüyü gösterir:", "Ek Figür S2 dört seviye için örüntüyü gösterir:"]]);

sub(C.discussion, 0, [[
  "Ana bulgu, hematoloji çalışmasının sonucunu farklı bir platform ve panelde yineliyor [15]: bir laboratuvarın kendi ölçüm kesinliğinden haklı çıkarabileceği kurallar cihazdan çok hangi izin verilen hata kaynağını seçtiğine bağlıdır.",
  "Ana bulgu şudur: bir laboratuvarın kendi ölçüm kesinliğinden haklı çıkarabileceği kurallar cihazdan çok hangi izin verilen hata kaynağını seçtiğine bağlıdır; aynı şey farklı bir platformdaki bir hematoloji panelinde de bulunmuştu [15].",
]]);
sub(C.discussion, 1, [["hematoloji çalışmasının seviye başına yaklaşımına göre 17 puana kadar düşürdü", "seviye başına yaklaşıma göre 17 puana kadar düşürdü"]]);
sub(C.discussion, 2, [["bu, yeniden merkezlemenin daha etkili müdahale olduğu hematoloji çalışmasıyla [15] ve sapmış hedeflerin maliyeti üzerine önceki çalışmalarla [31] uyumludur.", "bu, sapmış hedeflerin maliyeti üzerine önceki çalışmalarla [31] uyumludur."]]);

C.legends = [tr.legends[0], tr.legends[1],
  tr.legends[4].replace("Figür 5.", "Figür 3.").replace("her seviye kendi CV'si ve K'siyle (ince çizgiler)", "her seviye kendi CV'si ve K'siyle (ince çizgiler: L1 düz, L2 kesikli)").replace("noktalı kırmızı çizgi: benimsenen izin verilen toplam hata; noktalı gri çizgi: saptama gereği", "dikey noktalı çizgi: benimsenen izin verilen toplam hata; yatay noktalı çizgi: saptama gereği")];
C.supplementary = [...tr.supplementary.slice(0, 5), tr.legends[2].replace("Figür 3.", "Ek Figür S1."), tr.legends[3].replace("Figür 4.", "Ek Figür S2."), tr.supplementary[5]];

C.guarantor = "MFK.";
C.contributions = "MFK çalışmayı tasarladı, verileri çıkardı ve analiz etti, yazılımı ve makaleyi yazdı; sorumlu (guarantor) yazardır.";
C.ethics = "Çalışma yalnızca laboratuvarın kendi kontrol materyallerinin iç kalite kontrol sonuçlarını kullandı. Hasta numunesi, hasta verisi ya da kişisel veri yer almadı; Norveç Sağlık Araştırmaları Yasası uyarınca bölgesel etik kurul (REK) onayı gerekmedi; bu, Helse Møre og Romsdal HF veri koruma görevlisince teyit edildi.";
C.aiStatement = "Analiz betikleri, tarayıcı tabanlı araç ve makale taslağı bir büyük dil modelinin (Claude, Anthropic) yardımıyla hazırlandı. Yöntemleri yazar belirledi; her hesaplamayı dışa aktarılan veriyle karşılaştırdı, bütün sonuçları ve kaynakları doğruladı ve içeriğin tüm sorumluluğunu üstlenir.";
C.references = acb.references;
module.exports = C;
