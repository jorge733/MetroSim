const {chromium}=require('playwright');const path=require('path');
(async()=>{const b=await chromium.launch();
const f='file://'+path.resolve(process.argv[2]);
const sizes=[
 ['post-cuadrado.png',1080,1080,{gap:'24px',logo:'150px',h1:'92px',badge:'30px',p:'30px',url:'26px',board:'27px',rw:'820px',dot:'34px',stop:'24px'}],
 ['historia.png',1080,1920,{gap:'52px',logo:'280px',h1:'124px',badge:'40px',p:'40px',url:'34px',board:'34px',rw:'900px',dot:'44px',stop:'30px'}],
 ['portada-horizontal.png',1200,630,{logod:'none',gap:'14px',h1:'58px',badge:'22px',p:'22px',url:'20px',board:'20px',rw:'760px',dot:'26px',stop:'18px'}]];
for(const [n,w,h,v] of sizes){const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:1});
await p.goto(f);await p.evaluate(([w,h,v])=>{const s=document.documentElement.style;s.setProperty('--w',w+'px');s.setProperty('--h',h+'px');for(const k in v)s.setProperty('--'+k,v[k]);},[w,h,v]);
await p.screenshot({path:n});await p.close();}
await b.close();})();
