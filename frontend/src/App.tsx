import { useState, useEffect } from 'react';
import { Search, Link as LinkIcon, Clock, ShieldCheck, Database, ArrowRight, Loader2, CheckCircle2, Wallet } from 'lucide-react';
import { BrowserProvider, Contract } from 'ethers';

declare global {
  interface Window {
    ethereum?: any;
  }
}

interface ArchiveHistory {
  id: string;
  url: string;
  cid: string;
  timestamp: string;
  txHash: string;
}

// ChainArchive Contract ABI (Simplified for our needs)
const ChainArchiveABI = [
  "function createArchive(string memory _url, string memory _cid) public",
  "event ArchiveCreated(uint256 indexed archiveId, string url, string cid, address indexed archiver, uint256 timestamp)"
];

// Sepolia'daki Gerçek Akıllı Sözleşme Adresi
const CONTRACT_ADDRESS = "0xA98D252939c9E8413CB98Aa665dcA7384727F9AA"; 

function App() {
  const [url, setUrl] = useState('');
  const [archiveStep, setArchiveStep] = useState<'idle' | 'crawling' | 'wallet_approval' | 'mining'>('idle');
  const [archiveResult, setArchiveResult] = useState<{ cid: string; timestamp: string; txHash?: string; screenshot?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Web3 States
  const [account, setAccount] = useState<string | null>(null);
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [history, setHistory] = useState<ArchiveHistory[]>([]);
  const [isFetchingHistory, setIsFetchingHistory] = useState(false);

  // Check if wallet is already connected
  useEffect(() => {
    if (window.ethereum) {
      const web3Provider = new BrowserProvider(window.ethereum);
      setProvider(web3Provider);
      
      window.ethereum.request({ method: 'eth_accounts' })
        .then((accounts: string[]) => {
          if (accounts.length > 0) setAccount(accounts[0]);
        })
        .catch(console.error);

      window.ethereum.on('accountsChanged', (accounts: string[]) => {
        setAccount(accounts.length > 0 ? accounts[0] : null);
      });
    }
  }, []);

  const connectWallet = async () => {
    if (!window.ethereum) {
      setError("Lütfen tarayıcınıza MetaMask eklentisini kurun.");
      return;
    }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      setAccount(accounts[0]);
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError("Cüzdan bağlantısı reddedildi.");
    }
  };

  const fetchHistory = async () => {
    if (!account || !provider) return;
    
    setIsFetchingHistory(true);
    try {
      const contract = new Contract(CONTRACT_ADDRESS, ChainArchiveABI, provider);
      // Filtre oluştur (ArchiveCreated olayında archiver = account olanlar)
      const filter = contract.filters.ArchiveCreated(null, null, null, account);
      
      // Geçmiş olayları çek
      const logs = await contract.queryFilter(filter);
      
      const parsedHistory: ArchiveHistory[] = logs.map((log: any) => {
        const parsedLog = contract.interface.parseLog(log);
        return {
          id: parsedLog?.args[0].toString() || "",
          url: parsedLog?.args[1] || "",
          cid: parsedLog?.args[2] || "",
          timestamp: new Date(Number(parsedLog?.args[4]) * 1000).toLocaleString(),
          txHash: log.transactionHash
        };
      }).reverse(); // En yeniler en üstte
      
      setHistory(parsedHistory);
    } catch (err) {
      console.error("Geçmiş çekilirken hata:", err);
    } finally {
      setIsFetchingHistory(false);
    }
  };

  useEffect(() => {
    if (account && provider) {
      fetchHistory();
    } else {
      setHistory([]);
    }
  }, [account, provider]);

  const handleArchive = async () => {
    if (!url.trim()) return;
    if (!account || !provider) {
      setError("Lütfen önce cüzdanınızı bağlayın!");
      return;
    }
    
    setArchiveStep('crawling');
    setError(null);
    setArchiveResult(null);

    try {
      // 1. Backend'e İstek At (Ekran görüntüsü ve HTML alma)
      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
      const response = await fetch(`${backendUrl}/api/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      
      const data = await response.json();
      
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Sunucu tarafında arşivleme hatası");
      }
      
      const cid = data.cid;
      const screenshot = data.screenshot;
      
      // 2. Akıllı Sözleşme İşlemi (Blockchain'e yazma - Sepolia Testnet)
      setArchiveStep('wallet_approval');
      const signer = await provider.getSigner();
      const contract = new Contract(CONTRACT_ADDRESS, ChainArchiveABI, signer);
      
      // Kullanıcı MetaMask'ten onaylayacak
      const tx = await contract.createArchive(url, cid);
      
      // İşlemin blokzincire onaylanmasını bekle
      setArchiveStep('mining');
      const receipt = await tx.wait();
      const txHash = receipt.hash;

      setArchiveResult({
        cid,
        timestamp: new Date(data.timestamp).toLocaleString() || new Date().toLocaleString(),
        txHash,
        screenshot
      });
      setUrl('');
      
      // Başarılı işlem sonrası geçmişi yenile
      fetchHistory();
    } catch (err: any) {
      setError(err.message || "Arşivleme sırasında bir hata oluştu.");
    } finally {
      setArchiveStep('idle');
    }
  };

  // Cüzdan adresini kısaltma yardımcı fonksiyonu
  const formatAddress = (addr: string) => `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 font-sans flex flex-col">
      {/* Navbar */}
      <header className="border-b border-white/10 bg-zinc-950/50 backdrop-blur-md sticky top-0 z-50">
        <div className="container max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500 flex items-center justify-center shadow-[0_0_20px_rgba(168,85,247,0.5)]">
              <Database className="w-6 h-6 text-white" />
            </div>
            <span className="font-bold text-2xl tracking-tight">ChainArchive</span>
          </div>
          <button 
            onClick={connectWallet}
            className="px-6 py-2.5 text-base font-medium bg-white/5 hover:bg-white/10 rounded-full transition-colors border border-white/10 flex items-center gap-2"
          >
            <Wallet className="w-4 h-4 text-purple-400" />
            {account ? formatAddress(account) : "Cüzdanı Bağla"}
          </button>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-grow flex flex-col items-center pt-32 pb-20 px-6 relative overflow-hidden">
        {/* Background glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[600px] bg-purple-500/20 blur-[150px] rounded-full pointer-events-none" />
        
        <div className="text-center max-w-4xl z-10 w-full">
          <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight mb-6 bg-gradient-to-br from-white to-white/40 bg-clip-text text-transparent">
            Merkeziyetsiz <br/> Dijital Hafıza
          </h1>
          <p className="text-zinc-400 text-lg md:text-xl mb-8 max-w-2xl mx-auto leading-relaxed">
            İnternet üzerindeki bilginin kaybolmasını, değiştirilmesini veya sansürlenmesini engelleyin. İçerikleri sonsuza kadar blokzincire kazıyın.
          </p>

          {/* Main Input Area */}
          <div className="relative max-w-2xl mx-auto group mb-8">
            <div className="absolute -inset-1 bg-gradient-to-r from-purple-500 to-blue-500 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-500"></div>
            <div className="relative bg-zinc-900 ring-1 ring-white/10 rounded-2xl flex flex-col md:flex-row items-center p-2 shadow-2xl">
              <div className="pl-4 pr-2 text-zinc-500 hidden md:block">
                <LinkIcon className="w-5 h-5" />
              </div>
              <input 
                type="text" 
                placeholder="Arşivlenecek URL'yi girin (örn: https://news.com/...)"
                className="flex-grow w-full bg-transparent border-none outline-none text-zinc-100 placeholder-zinc-500 px-3 py-3 text-lg"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={archiveStep !== 'idle'}
                onKeyDown={(e) => e.key === 'Enter' && handleArchive()}
              />
              <button 
                onClick={handleArchive}
                disabled={archiveStep !== 'idle' || !url.trim()}
                className="w-full md:w-auto bg-purple-500 hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-3 rounded-xl text-base font-medium transition-colors flex items-center justify-center gap-2 mt-2 md:mt-0"
              >
                {archiveStep !== 'idle' ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {archiveStep === 'crawling' && "🌐 Taranıyor (1/3)..."}
                    {archiveStep === 'wallet_approval' && "🔑 Cüzdan Onayı (2/3)..."}
                    {archiveStep === 'mining' && "⛓️ Blokzincir Yazımı (3/3)..."}
                  </span>
                ) : (
                  <>Arşivle <ArrowRight className="w-4 h-4" /></>
                )}
              </button>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="max-w-3xl mx-auto mb-10 p-5 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-base">
              {error}
            </div>
          )}

          {/* Result Card */}
          {archiveResult && (
            <div className="max-w-3xl mx-auto mb-10 p-8 bg-zinc-900/80 border border-emerald-500/30 rounded-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex items-center gap-4 mb-6">
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                <h3 className="text-2xl font-semibold text-emerald-50">Başarıyla Blokzincire Kazındı!</h3>
              </div>
              <div className="space-y-4 text-left">
                <div className="bg-zinc-950/50 p-5 rounded-xl border border-white/5">
                  <div className="text-sm text-zinc-500 mb-2 uppercase tracking-wider">İçerik ID (IPFS CID)</div>
                  <div className="font-mono text-emerald-400 text-base break-all select-all">
                    {archiveResult.cid}
                  </div>
                </div>
                {archiveResult.txHash && (
                  <div className="bg-zinc-950/50 p-5 rounded-xl border border-white/5">
                    <div className="text-sm text-zinc-500 mb-2 uppercase tracking-wider">İşlem Hash'i (Tx)</div>
                    <a 
                      href={`https://sepolia.etherscan.io/tx/${archiveResult.txHash}`} 
                      target="_blank" 
                      rel="noreferrer"
                      className="font-mono text-blue-400 hover:text-blue-300 hover:underline text-base break-all flex items-center gap-2"
                    >
                      {archiveResult.txHash}
                    </a>
                  </div>
                )}
                {archiveResult.screenshot && (
                  <div className="bg-zinc-950/50 p-2 rounded-xl border border-white/5 mt-4">
                    <div className="text-sm text-zinc-500 mb-2 px-3 pt-2 uppercase tracking-wider">Web Sitesi Görüntüsü</div>
                    <img 
                      src={archiveResult.screenshot} 
                      alt="Website Screenshot" 
                      className="w-full rounded-lg object-contain max-h-[400px] shadow-lg border border-white/10"
                    />
                  </div>
                )}
                <div className="flex justify-between items-center px-3 pt-2">
                  <span className="text-base text-zinc-400">Tarih: {archiveResult.timestamp}</span>
                  <a 
                    href={`https://ipfs.io/ipfs/${archiveResult.cid}`} 
                    target="_blank" 
                    rel="noreferrer"
                    className="text-base text-purple-400 hover:text-purple-300 underline underline-offset-4"
                  >
                    Ağda Görüntüle
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Stats/Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl w-full mt-20 z-10">
          <div className="bg-zinc-900/50 border border-white/5 p-6 rounded-3xl backdrop-blur-sm hover:bg-zinc-800/50 transition-colors">
            <ShieldCheck className="w-8 h-8 text-purple-400 mb-4" />
            <h3 className="text-lg font-semibold text-zinc-100 mb-2">Sansüre Dirençli</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              İçerikler merkeziyetsiz ağlarda (IPFS/Arweave) saklanır. Hiçbir otorite tarafından silinemez veya değiştirilemez.
            </p>
          </div>
          <div className="bg-zinc-900/50 border border-white/5 p-6 rounded-3xl backdrop-blur-sm hover:bg-zinc-800/50 transition-colors">
            <Clock className="w-8 h-8 text-blue-400 mb-4" />
            <h3 className="text-lg font-semibold text-zinc-100 mb-2">Kriptografik Zaman Damgası</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Her arşiv, blokzincir üzerinde o saniyeye ait bir zaman damgasıyla imzalanır. Matematiksel olarak kanıtlanabilirdir.
            </p>
          </div>
          <div className="bg-zinc-900/50 border border-white/5 p-6 rounded-3xl backdrop-blur-sm hover:bg-zinc-800/50 transition-colors">
            <Search className="w-8 h-8 text-emerald-400 mb-4" />
            <h3 className="text-lg font-semibold text-zinc-100 mb-2">Şeffaf Doğrulama</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Arşivlenen her içerik açık kaynaklı olarak herkes tarafından anında doğrulanabilir ve görüntülenebilir.
            </p>
          </div>
        </div>

        {/* History Section */}
        {account && (
          <div className="max-w-6xl w-full mt-20 z-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-center gap-2 mb-8">
              <Clock className="w-6 h-6 text-purple-400" />
              <h2 className="text-2xl font-bold text-zinc-100">Geçmiş Arşivleriniz</h2>
              {isFetchingHistory && <Loader2 className="w-5 h-5 animate-spin text-zinc-500 ml-4" />}
            </div>
            
            {history.length === 0 && !isFetchingHistory ? (
              <div className="bg-zinc-900/50 border border-white/5 p-10 rounded-3xl text-center text-zinc-500 backdrop-blur-sm max-w-2xl mx-auto">
                Henüz bu cüzdanla yapılmış bir arşiv bulunmuyor.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {history.map((item, index) => (
                  <div key={index} className="bg-zinc-900/50 border border-white/5 p-6 rounded-2xl backdrop-blur-sm hover:bg-zinc-800/50 transition-colors flex flex-col justify-between overflow-hidden relative">
                    <div className="absolute top-0 right-0 bg-emerald-500/10 text-emerald-400 px-3 py-1 text-[10px] font-semibold rounded-bl-lg border-b border-l border-emerald-500/20 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Onaylandı
                    </div>
                    <div>
                      <div className="text-sm text-purple-400 mb-2 font-mono font-medium">{item.timestamp}</div>
                      <a href={item.url} target="_blank" rel="noreferrer" className="text-lg md:text-xl font-bold text-zinc-100 hover:text-white hover:underline line-clamp-1 mb-3">
                        {item.url}
                      </a>
                    </div>
                    
                    {/* Görsel Önizleme Alanı */}
                    <div className="mb-4 rounded-xl overflow-hidden border border-white/5 bg-black/50 group relative">
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-10 backdrop-blur-sm">
                        <a href={`https://ipfs.io/ipfs/${item.cid}`} target="_blank" rel="noreferrer" className="px-3 py-1.5 bg-purple-500 hover:bg-purple-600 text-white font-medium rounded-lg text-xs transition-colors flex items-center gap-2">
                           <Search className="w-3 h-3" /> Tam Boyut Gör
                        </a>
                      </div>
                      <img 
                        src={`https://ipfs.io/ipfs/${item.cid}`} 
                        alt="Archive Preview" 
                        className="w-full h-32 object-cover opacity-80 group-hover:opacity-100 transition-all duration-500 transform group-hover:scale-105"
                        loading="lazy"
                        onError={(e) => {
                          // IPFS yavaşsa veya yüklenmezse yedek bir ikon göster
                          (e.target as HTMLImageElement).style.display = 'none';
                          (e.target as HTMLImageElement).parentElement!.classList.add('flex', 'items-center', 'justify-center', 'h-40');
                          (e.target as HTMLImageElement).parentElement!.innerHTML = '<div class="text-zinc-600 text-sm flex flex-col items-center"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-8 h-8 mb-2"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>Görsel IPFS\'ten yükleniyor...</div>';
                        }}
                      />
                    </div>

                    <div className="bg-zinc-950/50 p-4 rounded-xl border border-white/5 flex flex-col gap-3 mt-auto">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">IPFS CID</span>
                        <a href={`https://ipfs.io/ipfs/${item.cid}`} target="_blank" rel="noreferrer" className="text-sm font-mono text-emerald-400 hover:text-emerald-300 hover:underline truncate ml-4 max-w-[200px]">
                          {item.cid}
                        </a>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">İşlem (Tx)</span>
                        <a href={`https://sepolia.etherscan.io/tx/${item.txHash}`} target="_blank" rel="noreferrer" className="text-sm font-mono text-blue-400 hover:text-blue-300 hover:underline truncate ml-4 max-w-[200px]">
                          {formatAddress(item.txHash)}
                        </a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
