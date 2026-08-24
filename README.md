# ChainArchive

ChainArchive, web sayfalarının belirli bir andaki hâlini IPFS ve Ethereum Sepolia üzerinde doğrulanabilir biçimde arşivleyen merkeziyetsiz bir web uygulamasıdır.

Bir arşiv oluşturulduğunda sistem:

1. Sayfayı Puppeteer ile açar.
2. JPEG ekran görüntüsünü ve sayfanın HTML kaynağını alır.
3. Dosyaları ve arşiv metadatasını Pinata üzerinden IPFS'e yükler.
4. Orijinal URL ile IPFS CID değerini MetaMask aracılığıyla Sepolia'daki akıllı sözleşmeye kaydeder.

> IPFS içeriğin adreslenmesini ve dağıtık saklanmasını sağlar; blokzincir kaydı ise URL, CID, arşivleyen cüzdan ve zaman damgası için değiştirilemez bir kanıt oluşturur.

## Özellikler

- Bir web sayfasının ekran görüntüsünü ve HTML kaynağını arşivleme
- Başlık, kategori ve yazar bilgilerini IPFS metadatasında saklama
- MetaMask bağlantısı ve otomatik Sepolia ağına geçiş
- Arşiv kaydını Ethereum işlemiyle doğrulama
- URL'ye göre zincir üzerindeki arşiv geçmişini sorgulama
- Bağlı cüzdanın geçmiş arşivlerini listeleme
- Pinata'daki son ChainArchive kayıtlarını **Keşfet** ekranında görüntüleme
- Başarısız veya kullanıcı tarafından reddedilen işlemlerde yüklenen CID'yi Pinata'dan kaldırma
- API uç noktalarında istek sınırlama

## Mimari

```text
Kullanıcı / MetaMask
        │
        ▼
frontend/  ─────► backend/ ─────► Puppeteer + Pinata/IPFS
    │
    └───────────────────────────► Ethereum Sepolia
                                      │
                                      ▼
                               ChainArchive.sol
```

| Dizin | Açıklama | Temel teknolojiler |
| --- | --- | --- |
| `frontend/` | Arşivleme, sorgulama, geçmiş ve keşfet arayüzü | React 19, TypeScript, Vite, Tailwind CSS, ethers.js |
| `backend/` | Sayfa tarama, IPFS yükleme ve metadata API'si | Node.js, Express, Puppeteer, Pinata API |
| `blockchain/` | Akıllı sözleşme, derleme ve dağıtım yapılandırması | Solidity 0.8.24, Hardhat, Ignition |

### Sepolia sözleşmesi

- Ağ: Ethereum Sepolia (`chainId: 11155111`)
- Adres: [`0xA98D252939c9E8413CB98Aa665dcA7384727F9AA`](https://sepolia.etherscan.io/address/0xA98D252939c9E8413CB98Aa665dcA7384727F9AA)

Akıllı sözleşme her kayıt için URL, IPFS CID, arşivleyen cüzdan adresi ve blok zaman damgasını saklar.

## Gereksinimler

- Node.js 20.19 veya daha yeni bir sürüm
- npm
- MetaMask veya EIP-1193 uyumlu bir tarayıcı cüzdanı
- İşlem ücretleri için Sepolia test ETH
- Gerçek IPFS yüklemeleri için Pinata JWT

## Yerel kurulum

Depoyu klonladıktan sonra backend, frontend ve blockchain bağımlılıklarını ayrı ayrı kurun:

```bash
cd backend
npm install

cd ../frontend
npm install

cd ../blockchain
npm install
```

### 1. Backend ortam değişkenleri

Örnek dosyayı `backend/.env` olarak kopyalayın:

```bash
cd backend
cp .env.example .env
```

Windows PowerShell için:

```powershell
Copy-Item .env.example .env
```

`backend/.env` içeriği:

```env
PINATA_JWT=pinata_jwt_degeriniz

# İsteğe bağlı; varsayılan değer http://localhost:5173
FRONTEND_URL=http://localhost:5173

# İsteğe bağlı; varsayılan değer 3001
PORT=3001
```

`PINATA_JWT` tanımlanmazsa `/api/archive` geliştirme amacıyla sahte bir CID üretir. Bu kayıt IPFS'te bulunmaz; keşfet ve metadata özellikleri için geçerli bir Pinata JWT gerekir.

### 2. Frontend ortam değişkenleri

Yerel geliştirmede ek ayar gerekmez. Backend farklı bir adreste çalışıyorsa `frontend/.env` oluşturun:

```env
VITE_BACKEND_URL=http://localhost:3001
```

Pinata JWT değerini frontend'e koymayın. IPFS işlemleri backend üzerinden yürütülür.

### 3. Uygulamayı çalıştırma

İki ayrı terminal açın.

Backend:

```bash
cd backend
node index.js
```

Backend varsayılan olarak `http://localhost:3001` adresinde çalışır.

Frontend:

```bash
cd frontend
npm run dev
```

Arayüz varsayılan olarak `http://localhost:5173` adresinde açılır.

## Kullanım

1. Backend ve frontend'i başlatın.
2. Arayüzde **Cüzdanı Bağla** seçeneğiyle MetaMask hesabınızı bağlayın.
3. Arşivlemek istediğiniz URL'yi girin; isteğe bağlı olarak başlık, kategori ve yazar ekleyin.
4. **Arşivle** düğmesine basın ve sayfanın taranmasını bekleyin.
5. MetaMask'ta Sepolia işlemini onaylayın.
6. İşlem tamamlandığında IPFS içeriğini ve Etherscan işlem kaydını sonuç ekranından açın.

**Sorgula** sekmesi aynı URL için oluşturulmuş zincir kayıtlarını, **Keşfet** sayfası ise Pinata hesabındaki güncel ChainArchive kayıtlarını gösterir.

## Akıllı sözleşmeyi geliştirme ve dağıtma

Yalnızca mevcut sözleşmeyi değiştirmek veya yeni bir dağıtım yapmak istiyorsanız `blockchain/.env` oluşturun:

```env
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/anahtariniz
PRIVATE_KEY=dagitim_cuzdaninin_ozel_anahtari
```

> Gerçek varlık tuttuğunuz bir cüzdanın özel anahtarını kullanmayın ve `.env` dosyalarını sürüm kontrolüne eklemeyin.

Sözleşmeyi derlemek için:

```bash
cd blockchain
npx hardhat compile
```

Sepolia'ya dağıtmak için:

```bash
cd blockchain
npx hardhat ignition deploy ignition/modules/ChainArchive.cjs --network sepolia
```

Hardhat çıktıları `frontend/src/artifacts/` dizinine yazılır. Yeni bir dağıtımdan sonra frontend'deki `CONTRACT_ADDRESS` değerini de güncelleyin.

## API özeti

| Yöntem | Uç nokta | Açıklama |
| --- | --- | --- |
| `POST` | `/api/archive` | Sayfayı tarar, ekran görüntüsü ve HTML'i IPFS'e yükler |
| `POST` | `/api/metadata` | Verilen CID listesi için Pinata metadatasını döndürür |
| `GET` | `/api/explore` | Pinata'daki son ChainArchive kayıtlarını listeler |
| `DELETE` | `/api/unpin` | İptal edilen bir arşivin CID'sini Pinata'dan kaldırır |

`/api/*` istekleri IP adresi başına dakikada 3 istekle sınırlandırılmıştır.

## Doğrulama komutları

Frontend üretim derlemesi:

```bash
cd frontend
npm run build
```

Frontend lint kontrolü:

```bash
cd frontend
npm run lint
```

Akıllı sözleşme derlemesi:

```bash
cd blockchain
npx hardhat compile
```
