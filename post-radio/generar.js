const {chromium}=require('playwright');const path=require('path');
(async()=>{const b=await chromium.launch();
const f='file://'+path.resolve(process.argv[2]);
const sizes=[
 ['post-cuadrado.png',1080,1080,{gap:'24px',logo:'90px',badge:'26px',h1:'72px',dw:'800px',tag:'22px',cw:'980px',cgap:'12px',cpad:'8px 18px',p:'23px',url:'50px',bpad:'14px 42px',br:'none'}],
 ['historia.png',1080,1920,{gap:'48px',logo:'130px',badge:'34px',h1:'112px',dw:'980px',tag:'30px',cw:'960px',cgap:'16px',cpad:'10px 24px',p:'32px',url:'68px',bpad:'20px 56px',br:'inline'}],
 ['portada-horizontal.png',1200,630,{horiz:'1',gap:'18px',logo:'60px',badge:'18px',h1:'58px',dw:'620px',tag:'15px',cw:'480px',cgap:'8px',cpad:'6px 14px',p:'17px',url:'34px',bpad:'10px 30px',br:'inline'}]];
for(const [n,w,h,v] of sizes){const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:1});
await p.goto(f);await p.evaluate(([w,h,v])=>{const s=document.documentElement.style;s.setProperty('--w',w+'px');s.setProperty('--h',h+'px');document.body.classList.toggle('h',!!v.horiz);for(const k in v)s.setProperty('--'+k,v[k]);},[w,h,v]);
await p.waitForTimeout(300);
await p.screenshot({path:n});await p.close();}
await b.close();})();
