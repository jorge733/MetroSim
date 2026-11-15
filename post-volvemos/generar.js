const {chromium}=require('playwright');const path=require('path');
(async()=>{const b=await chromium.launch();
const f='file://'+path.resolve(process.argv[2]);
const sizes=[
 ['post-cuadrado.png',1080,1080,{t1:'34px',t2:'30px',gap:'20px',logo:'130px',pb:'40px',h1:'84px',badge:'28px',p:'30px',url:'26px',board:'26px',save:'27px',savew:'860px'}],
 ['historia.png',1080,1920,{t1:'150px',t2:'150px',gap:'44px',logo:'260px',h1:'98px',badge:'40px',p:'42px',url:'34px',board:'34px',save:'38px',savew:'900px'}],
 ['portada-horizontal.png',1200,630,{t1:'-6px',t2:'-6px',tape:'48px',tapefs:'18px',logod:'none',boardd:'none',gap:'14px',logo:'110px',h1:'58px',badge:'22px',p:'22px',url:'20px',board:'20px',save:'21px',savew:'1000px',savecols:'repeat(4,auto)'}]];
for(const [n,w,h,v] of sizes){const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:1});
await p.goto(f);await p.evaluate(([w,h,v])=>{const s=document.documentElement.style;s.setProperty('--w',w+'px');s.setProperty('--h',h+'px');for(const k in v)s.setProperty('--'+k,v[k]);},[w,h,v]);
await p.screenshot({path:n});await p.close();}
await b.close();})();
