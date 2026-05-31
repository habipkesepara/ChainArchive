# ChainArchive: Merkeziyetsiz Dijital Hafıza 🌐🔗

ChainArchive, internet üzerindeki bilginin kaybolmasını, değiştirilmesini veya sansürlenmesini engelleyerek insanlığın dijital hafızasını korumayı amaçlayan merkeziyetsiz bir arşivleme sistemidir.

Proje, arşivlenen her içeriğin **anlık ekran görüntüsünü** alır, **IPFS (Pinata)** ağında kalıcı olarak depolar ve **Kriptografik Zaman Damgası** ile Blokzincire (Ethereum Sepolia) "değiştirilemez" şekilde kazır.

---

## 📂 Proje Mimarisi ve Klasör Yapısı

Proje 3 bağımsız modülden oluşmaktadır:

1. **`frontend/`** (Kullanıcı Arayüzü): React, Vite, TailwindCSS ve Ethers.js kullanılarak yazılmış, Web3 cüzdan (MetaMask) bağlantılı modern arayüz.
2. **`backend/`** (Web Crawler & IPFS Yükleyici): Node.js, Express ve Puppeteer kullanılarak yazılmış gizli tarayıcı robotu. İstenen URL'nin ekran görüntüsünü çeker ve doğrudan Pinata üzerinden IPFS'e yükler.
3. **`blockchain/`** (Akıllı Sözleşmeler): Solidity ile yazılmış ve Hardhat ile Ethereum Sepolia Test Ağına yüklenmiş akıllı sözleşme dosyalarını barındırır.
   - **Sepolia Sözleşme Adresi:** `0xA98D252939c9E8413CB98Aa665dcA7384727F9AA`

---

## 🚀 Kurulum ve Çalıştırma Rehberi

Projeyi kendi bilgisayarınızda çalıştırmak için aşağıdaki adımları sırasıyla izleyin.

### Ön Hazırlık: Çevre Değişkenleri (.env)
Projeyi başlatmadan önce gerekli API anahtarlarını ayarlamalısınız.

**1. Backend (.env) Ayarları:**
`backend` klasörünün içinde `.env` adında bir dosya oluşturun ve içine şunu yazın:
```env
# https://app.pinata.cloud/ adresinden "API Keys -> New JWT" diyerek alabilirsiniz.
PINATA_JWT=sizin_pinata_jwt_tokeniniz
```

**2. Blockchain (.env) Ayarları (Opsiyonel - Sadece kontratı yeniden yükleyecekseniz):**
`blockchain` klasörünün içinde `.env` adında bir dosya oluşturun ve içine şunları yazın:
```env
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/sizin_alchemy_anahtariniz
PRIVATE_KEY=sizin_metamask_gizli_anahtariniz
```

---

### Adım 1: Backend (Sunucu ve Crawler) Başlatılması
Backend, sitelerin ekran görüntülerini IPFS'e yükleyen robottur. Arayüzden önce çalıştırılmalıdır.

```bash
cd backend
npm install
node index.js
```
*Sunucu `http://localhost:3001` adresinde çalışmaya başlayacaktır.*

### Adım 2: Frontend (Kullanıcı Arayüzü) Başlatılması
Kullanıcıların göreceği web sitesidir. Yeni bir terminal penceresi açın:

```bash
cd frontend
npm install
npm run dev
```
*Web arayüzü `http://localhost:5173` adresinde açılacaktır.*

### Adım 3: Akıllı Sözleşmeyi Derleme ve Ağa Yükleme (Geliştiriciler İçin)
Eğer akıllı sözleşmeyi (`ChainArchive.sol`) kendiniz değiştirip Ethereum Sepolia ağına yeniden yüklemek isterseniz:

```bash
cd blockchain
npm install
# Sözleşmeyi derlemek için:
npx hardhat compile
# Sepolia ağına yüklemek için:
npx hardhat ignition deploy ignition/modules/ChainArchive.cjs --network sepolia
```

---

## 🛠️ Kullanılan Teknolojiler
* **Frontend:** React, TypeScript, Vite, TailwindCSS, Lucide Icons
* **Web3 Bağlantısı:** Ethers.js
* **Backend:** Node.js, Express.js
* **Web Crawler:** Puppeteer (Headless Browser)
* **IPFS Bağlantısı:** Pinata SDK / Axios
* **Blockchain:** Solidity, Hardhat, Alchemy RPC

---

## 💡 Nasıl Kullanılır?
1. Tarayıcınızda açılan `localhost:5173` sayfasına gidin.
2. Sağ üstten **MetaMask** cüzdanınızı bağlayın (Ağınızın Ethereum Sepolia olduğundan ve bir miktar Test ETH'niz olduğundan emin olun).
3. Ekrana kaybolmasını istemediğiniz bir sayfanın linkini girin (Örn: `https://tr.wikipedia.org/wiki/Blokzincir`) ve **Arşivle** butonuna basın.
4. Sistem arka planda siteyi tarayacak, ekran görüntüsünü IPFS'e atacak ve MetaMask onay ekranını karşınıza çıkartacaktır.
5. MetaMask'tan işlemi onayladığınızda, ekran görüntüsü ve IPFS CID veriniz kalıcı olarak Ethereum ağına kazınacaktır!
