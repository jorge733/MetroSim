const {chromium}=require('playwright');const path=require('path');
(async()=>{const b=await chromium.launch();
const f='file://'+path.resolve(process.argv[2]);
const sizes=[
 ['post-cuadrado.png',1080,1080,{gap:'22px',logo:'90px',badge:'24px',h1:'84px',cw:'760px',cgap:'12px',cpad:'12px 24px',bub:'27px',p:'27px',board:'24px',url:'24px'}],
 ['historia.png',1080,1920,{gap:'50px',logo:'190px',badge:'34px',h1:'128px',cw:'900px',cgap:'22px',cpad:'20px 34px',bub:'40px',p:'38px',board:'34px',url:'34px'}],
 ['portada-horizontal.png',1200,630,{horiz:'1',gap:'16px',logo:'70px',badge:'18px',h1:'64px',cw:'500px',cgap:'12px',cpad:'12px 22px',bub:'21px',p:'19px',board:'18px',url:'18px'}]];
for(const [n,w,h,v] of sizes){const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:1});
await p.goto(f);await p.evaluate(([w,h,v])=>{const s=document.documentElement.style;s.setProperty('--w',w+'px');s.setProperty('--h',h+'px');
 const H=!!v.horiz;document.body.classList.toggle('h',H);
 // en vertical: el texto largo, el letrero y la url van bajo la conversación; en horizontal, en la columna izquierda
 document.querySelectorAll('.hp,.hb,.hu').forEach(e=>e.style.display=H?'':'none');
 document.querySelectorAll('.vp,.vb,.vu').forEach(e=>e.style.display=H?'none':'');
 for(const k in v)s.setProperty('--'+k,v[k]);},[w,h,v]);
await p.waitForTimeout(300);
await p.screenshot({path:n});await p.close();}
await b.close();})();
