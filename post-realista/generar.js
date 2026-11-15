const {chromium}=require('playwright');const path=require('path');
(async()=>{const b=await chromium.launch();
const f='file://'+path.resolve(process.argv[2]);
const sizes=[
 ['post-cuadrado.png',1080,1080,{gap:'30px',logo:'90px',badge:'26px',h1:'70px',dir:'row',arot:'0deg',pw:'440px',pgap:'22px',tag:'24px',cw:'980px',cgap:'12px',cpad:'8px 18px',p:'23px',url:'52px',bpad:'16px 44px'}],
 ['historia.png',1080,1920,{gap:'46px',logo:'130px',badge:'36px',h1:'98px',dir:'column',arot:'90deg',pw:'900px',pgap:'34px',tag:'32px',cw:'920px',cgap:'18px',cpad:'12px 26px',p:'33px',url:'70px',bpad:'22px 56px'}],
 ['portada-horizontal.png',1200,630,{gap:'16px',logo:'54px',badge:'18px',h1:'44px',dir:'row',arot:'0deg',pw:'500px',pgap:'18px',tag:'16px',cw:'720px',cgap:'8px',cpad:'5px 14px',p:'16px',url:'32px',bpad:'9px 30px'}]];
for(const [n,w,h,v] of sizes){const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:1});
await p.goto(f);await p.evaluate(([w,h,v])=>{const s=document.documentElement.style;s.setProperty('--w',w+'px');s.setProperty('--h',h+'px');for(const k in v)s.setProperty('--'+k,v[k]);},[w,h,v]);
await p.waitForTimeout(300);
await p.screenshot({path:n});await p.close();}
await b.close();})();
