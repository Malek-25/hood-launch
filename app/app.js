import { BrowserProvider, Contract, Interface, isAddress, parseUnits } from "https://cdn.jsdelivr.net/npm/ethers@6.13.4/+esm";

const HOODIE = "0xC72c01AAB5f5678dc1d6f5C6d2B417d91D402Ba3";
const CHAIN = { chainId:"0x1237", chainName:"Robinhood Chain", nativeCurrency:{name:"Ether",symbol:"ETH",decimals:18}, rpcUrls:["https://rpc.mainnet.chain.robinhood.com"], blockExplorerUrls:["https://robinhoodchain.blockscout.com"] };
const factoryAbi = ["function createLauncher() returns (address)","function launchersFor(address) view returns (address[])","function HOODIE() view returns (address)"];
const launcherAbi = ["function launchToken(string,string,uint256,uint256,uint256,address) returns (address,address)","event TokenLaunched(address indexed token,address indexed pair,address indexed tokenOwner,string name,string symbol,uint256 supply)"];
const erc20Abi = ["function approve(address,uint256) returns (bool)","function balanceOf(address) view returns (uint256)","function decimals() view returns (uint8)"];
const $ = id => document.getElementById(id); let provider, signer, account, launcherAddress, launchpadName, hoodieBalance;
const toast = text => { $("toast").textContent=text; $("toast").classList.add("show"); setTimeout(()=>$("toast").classList.remove("show"),4000); };
const txUrl = hash => `https://robinhoodchain.blockscout.com/tx/${hash}`;
const factoryAddress = () => window.HOODIEPAD_FACTORY_ADDRESS || new URLSearchParams(location.search).get("factory") || "";
const urlParams = new URLSearchParams(location.search);

function showWalletMenu(show){ $("walletMenu").classList.toggle("hidden", !show); }
function setConnected(addr){ account=addr; $("connect").textContent=`${addr.slice(0,6)}…${addr.slice(-4)}`; $("walletAddr").textContent=addr; }
function disconnect(){ signer=undefined; account=undefined; launcherAddress=undefined; $("connect").textContent="Connect wallet"; $("walletMenu").classList.add("hidden"); toast("Wallet disconnected."); }

$("connect").onclick = e => { e.stopPropagation(); signer ? showWalletMenu($("walletMenu").classList.contains("hidden")) : wallet().catch(e=>toast(e.shortMessage||e.message)); };
$("disconnectBtn").onclick = e => { e.stopPropagation(); disconnect(); };
$("copyAddr").onclick = e => { e.stopPropagation(); navigator.clipboard.writeText(account).then(()=>toast("Address copied.")).catch(()=>toast(account)); };
document.addEventListener("click", e => { if(!e.target.closest(".wallet-wrap")) showWalletMenu(false); });
async function wallet(){ if(signer)return; if(!window.ethereum)throw new Error("Connect an EVM wallet to continue."); provider=new BrowserProvider(window.ethereum); await provider.send("eth_requestAccounts",[]); try{await provider.send("wallet_switchEthereumChain",[{chainId:CHAIN.chainId}]);}catch(e){if(e.code===4902)await provider.send("wallet_addEthereumChain",[CHAIN]);else throw e;} signer=await provider.getSigner(); setConnected(await signer.getAddress()); await loadLauncher(); await checkHoodieBalance(); }
async function checkHoodieBalance(){ try{ const hoodieContract=new Contract(HOODIE,erc20Abi,signer); const balance=await hoodieContract.balanceOf(account); hoodieBalance=balance; const formatted=(Number(balance)/1e18).toFixed(2); const balanceEl=document.createElement("p"); balanceEl.id="hoodieBalanceDisplay"; balanceEl.style.cssText="font:12px 'DM Mono',monospace;color:var(--muted);margin:12px 0 0;"; if(balance==0n){ balanceEl.innerHTML=`⚠️ You have <strong style="color:#ff6b6b;">0 $HOODIE</strong>. <a href="https://app.uniswap.org/explore/tokens/robinhood/0xC72c01AAB5f5678dc1d6f5C6d2B417d91D402Ba3" target="_blank" style="color:var(--acid);text-decoration:underline;">Buy on Uniswap ↗</a> or <button onclick="document.getElementById('needHoodie').classList.remove('hidden');this.parentElement.scrollIntoView({behavior:'smooth',block:'center'});" style="background:transparent;border:0;color:var(--acid);text-decoration:underline;cursor:pointer;font:12px 'DM Mono',monospace;padding:0;">see all options</button>`; }else{ balanceEl.innerHTML=`Your balance: <strong style="color:var(--acid);">${formatted} $HOODIE</strong> <a href="https://app.uniswap.org/explore/tokens/robinhood/0xC72c01AAB5f5678dc1d6f5C6d2B417d91D402Ba3" target="_blank" style="color:var(--muted);font-size:11px;text-decoration:none;">(buy more ↗)</a>`; } const badge=$("launchpadBadge"); if(badge && !$("hoodieBalanceDisplay")){ badge.parentNode.insertBefore(balanceEl, badge.nextSibling); } }catch(e){ console.error("Failed to fetch $HOODIE balance:",e); } }
// Live token preview as user types
function updatePreview(){ const name=$("tokenName").value.trim()||"Your Token"; const symbol=$("tokenSymbol").value.trim()||"TOKEN"; const icon=$("tokenIcon").value.trim()||"🚀"; $("previewName").textContent=name; $("previewTicker").textContent=symbol; $("previewIcon").textContent=icon; if(name!=="Your Token"||symbol!=="TOKEN"){ $("tokenPreview").classList.remove("hidden"); }else{ $("tokenPreview").classList.add("hidden"); } }
$("tokenName").oninput=updatePreview;
$("tokenSymbol").oninput=updatePreview;
$("tokenIcon").oninput=updatePreview;
// Fetch stats from blockchain
async function loadStats(){ try{ const factAddr=factoryAddress(); if(!isAddress(factAddr))return; const factoryContract=new Contract(factAddr,factoryAbi,provider||new BrowserProvider(window.ethereum)); const launcherCount=await factoryContract.launcherCount?.(); if(launcherCount!==undefined){ $("statLaunchers").textContent=launcherCount.toString(); } let totalTokens=0; try{ for(let i=0;i<Math.min(Number(launcherCount),50);i++){ const launcherAddr=await factoryContract.launchers?.(i); if(!launcherAddr)continue; const launcher=new Contract(launcherAddr,["function launchCount() view returns (uint256)"],provider||new BrowserProvider(window.ethereum)); const count=await launcher.launchCount?.(); if(count!==undefined)totalTokens+=Number(count); } $("statTokens").textContent=totalTokens.toString(); }catch{} }catch(e){ console.error("Failed to load stats:",e); } }
loadStats();
async function factory(){ const address=factoryAddress(); if(!isAddress(address))throw new Error("HoodiePad is not configured yet. Add the deployed factory address in app/config.js."); const c=new Contract(address,factoryAbi,signer||provider); if((await c.HOODIE()).toLowerCase()!==HOODIE.toLowerCase())throw new Error("This is not the verified $HOODIE HoodiePad factory."); return c; }
async function loadLauncher(){ 
  // Check URL params FIRST (shareable launcher link has priority)
  const urlLauncher = urlParams.get("launcher");
  const urlName = urlParams.get("name");
  
  if(isAddress(urlLauncher||"")) {
    // Using shared launcher link - load it immediately
    launcherAddress = urlLauncher;
    launchpadName = decodeURIComponent(urlName || "Shared Launchpad");
    $("tokenPanel").classList.remove("locked");
    $("tokenStep").classList.add("active");
    $("createPanel").style.display = "none"; // Hide launcher creation completely
    $("launcherResult").innerHTML=`<strong>${launchpadName}</strong> is ready to use. <a href="https://robinhoodchain.blockscout.com/address/${launcherAddress}" target="_blank">${launcherAddress.slice(0,8)}…${launcherAddress.slice(-6)} ↗</a>`;
    $("launchpadBadge").innerHTML=`Using <strong>${launchpadName}</strong> to create tokens paired with $HOODIE.`;
    document.querySelector(".journey").style.display = "none"; // Hide the 2-step journey
    toast(`Connected! You're using ${launchpadName}.`);
    return;
  }
  
  // No shared link - check if user has their own launcher
  const saved=localStorage.getItem("hoodiepad.launcher"); 
  const savedName=localStorage.getItem("hoodiepad.launchpadName"); 
  if(isAddress(saved||"")) launcherAddress=saved; 
  if(savedName) launchpadName=savedName; 
  
  try{
    const launchers=await (await factory()).launchersFor(account); 
    if(launchers.length) launcherAddress=launchers.at(-1);
  }catch{} 
  
  if(launcherAddress){
    localStorage.setItem("hoodiepad.launcher",launcherAddress);
    $("tokenPanel").classList.remove("locked");
    $("tokenStep").classList.add("active");
    $("launcherResult").innerHTML=`<strong>${launchpadName || "Your launchpad"}</strong> is ready to use. <a href="https://robinhoodchain.blockscout.com/address/${launcherAddress}" target="_blank">${launcherAddress.slice(0,8)}…${launcherAddress.slice(-6)} ↗</a> <button id="createNewLauncher" style="margin-left:12px;padding:6px 10px;font-size:12px;background:transparent;color:var(--muted);border:1px solid var(--line);">Create another</button>`;
    $("launchpadBadge").innerHTML=`Using <strong>${launchpadName || "your launchpad"}</strong> to create tokens paired with $HOODIE.`;
    // Add event listener for "Create another" button
    setTimeout(() => {
      const btn = $("createNewLauncher");
      if(btn) btn.onclick = () => {
        launcherAddress = undefined;
        launchpadName = undefined;
        localStorage.removeItem("hoodiepad.launcher");
        localStorage.removeItem("hoodiepad.launchpadName");
        $("launcherResult").innerHTML = "";
        $("launchpadName").value = "";
        $("tokenPanel").classList.add("locked");
        $("tokenStep").classList.remove("active");
        toast("Create a new launchpad below.");
      };
    }, 100);
  } 
}
$("createLauncher").onclick=async()=>{try{await wallet();const name=$("launchpadName").value.trim()||"My Launchpad";const c=await factory();toast("Confirm creation in your wallet…");const tx=await c.createLauncher();$("launcherResult").innerHTML=`Creating <strong>${name}</strong>… <a href="${txUrl(tx.hash)}" target="_blank">view ↗</a>`;await tx.wait();launcherAddress=(await c.launchersFor(account)).at(-1);launchpadName=name;localStorage.setItem("hoodiepad.launcher",launcherAddress);localStorage.setItem("hoodiepad.launchpadName",name);const shareUrl=`${location.origin}${location.pathname}?launcher=${launcherAddress}&name=${encodeURIComponent(name)}`;$("launcherResult").innerHTML=`<strong>${name}</strong> is live! <a href="https://robinhoodchain.blockscout.com/address/${launcherAddress}" target="_blank">${launcherAddress.slice(0,8)}…${launcherAddress.slice(-6)} ↗</a><br><br><div style="background:var(--acid);padding:12px;margin-top:10px;"><strong style="display:block;margin-bottom:6px;font-size:13px;">📋 Share your launchpad:</strong><input readonly value="${shareUrl}" style="width:100%;padding:8px;font-size:11px;border:1px solid #8acc00;" onclick="this.select()"/><button onclick="navigator.clipboard.writeText('${shareUrl}').then(()=>toast('Launchpad link copied!')).catch(()=>toast('${shareUrl}'))" style="margin-top:6px;width:100%;padding:8px;background:var(--ink);color:white;border:0;cursor:pointer;font-size:12px;">Copy link</button></div>`;$("launchpadBadge").innerHTML=`Using <strong>${name}</strong> to create tokens paired with $HOODIE.`;$("tokenPanel").classList.remove("locked");$("tokenStep").classList.add("active");$("createPanel").scrollIntoView({behavior:"smooth"});toast(`${name} created. Scroll down to launch your first token.`);}catch(e){toast(e.shortMessage||e.message);}};
$("launchToken").onclick=async()=>{try{await wallet();if(!launcherAddress)throw new Error("Create your launcher first.");if(hoodieBalance===0n)throw new Error("You need $HOODIE tokens to launch. Get $HOODIE first.");const name=$("tokenName").value.trim(),symbol=$("tokenSymbol").value.trim(),hoodieRaw=$("hoodieLiquidity").value.trim(),icon=$("tokenIcon").value.trim()||"🚀";if(!name||!symbol||!hoodieRaw)throw new Error("Add a name, ticker, and $HOODIE liquidity amount.");const supply=parseUnits($("supply").value,18),tokenLiq=parseUnits($("tokenLiquidity").value,18),hoodieLiq=parseUnits(hoodieRaw,18);if(tokenLiq>=supply)throw new Error("Liquidity tokens must be lower than total supply.");if(hoodieLiq>hoodieBalance)throw new Error(`You only have ${(Number(hoodieBalance)/1e18).toFixed(2)} $HOODIE. Reduce the amount or get more $HOODIE.`);toast("Step 1 of 2: approve $HOODIE…");await (await new Contract(HOODIE,erc20Abi,signer).approve(launcherAddress,hoodieLiq)).wait();toast("Step 2 of 2: launching token…");const l=new Contract(launcherAddress,launcherAbi,signer),tx=await l.launchToken(name,symbol,supply,tokenLiq,hoodieLiq,account);$("launchResult").innerHTML=`Launching… <a href="${txUrl(tx.hash)}" target="_blank">view ↗</a>`;const receipt=await tx.wait();const event=receipt.logs.map(x=>{try{return l.interface.parseLog(x)}catch{return null}}).find(event=>event?.name==="TokenLaunched");const tokenAddr=event?.args?.token;const poolAddr=event?.args?.pair;$("launchResult").innerHTML="";$("successName").innerHTML=`${icon} ${name} (${symbol})`;$("successToken").href=`https://robinhoodchain.blockscout.com/address/${tokenAddr}`;$("successToken").querySelector("span").textContent=`${tokenAddr?.slice(0,10)}…${tokenAddr?.slice(-8)}`;$("successPool").href=`https://robinhoodchain.blockscout.com/address/${poolAddr}`;$("successPool").querySelector("span").textContent=`${poolAddr?.slice(0,10)}…${poolAddr?.slice(-8)}`;$("successTx").href=txUrl(tx.hash);const shareUrl=`${location.href}?token=${tokenAddr}`;$("successShare").onclick=()=>navigator.clipboard.writeText(shareUrl).then(()=>toast("Share link copied.")).catch(()=>toast(shareUrl));$("successCard").classList.remove("hidden");$("successCard").scrollIntoView({behavior:"smooth",block:"center"});$("launchAnother").onclick=()=>{$("successCard").classList.add("hidden");$("tokenName").value="";$("tokenSymbol").value="";$("tokenIcon").value="";$("hoodieLiquidity").value="";$("launchResult").innerHTML="";$("tokenPreview").classList.add("hidden");checkHoodieBalance();};toast(`${name} is live on $HOODIE.`);checkHoodieBalance();loadStats();}catch(e){toast(e.shortMessage||e.message);}};

// Check for shared launcher link on page load (before wallet connection)
(function checkSharedLink(){
  const urlLauncher = urlParams.get("launcher");
  const urlName = urlParams.get("name");
  if(isAddress(urlLauncher||"")) {
    launcherAddress = urlLauncher;
    launchpadName = decodeURIComponent(urlName || "Shared Launchpad");
    $("tokenPanel").classList.remove("locked");
    $("tokenStep").classList.add("active");
    $("createPanel").style.display = "none";
    $("launcherResult").innerHTML=`<strong>${launchpadName}</strong> <span style="color:var(--muted);">(Connect wallet to launch tokens)</span>`;
    $("launchpadBadge").innerHTML=`Using <strong>${launchpadName}</strong> to create tokens paired with $HOODIE.`;
    document.querySelector(".journey").style.display = "none";
    document.querySelector(".hero h1").innerHTML = `Launch tokens on<br/><em>${launchpadName}.</em>`;
    document.querySelector(".hero > p").textContent = `Connect your wallet to launch $HOODIE-paired tokens on this launchpad.`;
  }
})();
