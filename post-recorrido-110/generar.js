const {chromium}=require('playwright');const path=require('path');
(async()=>{const b=await chromium.launch();
const f='file://'+path.resolve(process.argv[2]);
const sizes=[
 ['post-cuadrado.png',1080,1080,{gap:'18px',logo:'72px',badge:'22px',h1:'68px',dw:'560px',tag:'17px',cw:'880px',cgap:'10px',cpad:'6px 16px',p:'20px',url:'40px',bpad:'10px 36px'}],
 ['post-vertical.png',1080,1350,{gap:'28px',logo:'96px',badge:'26px',h1:'88px',dw:'740px',tag:'22px',cw:'900px',cgap:'12px',cpad:'8px 18px',p:'25px',url:'52px',bpad:'14px 42px'}],
 ['historia.png',1080,1920,{split:'1',gap:'52px',logo:'124px',badge:'32px',h1:'116px',dw:'960px',tag:'28px',cw:'960px',cgap:'16px',cpad:'10px 22px',p:'30px',url:'64px',bpad:'18px 52px'}]];
for(const [n,w,h,v] of sizes){const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:1});
await p.goto(f);await p.evaluate(([w,h,v])=>{const s=document.documentElement.style;s.setProperty('--w',w+'px');s.setProperty('--h',h+'px');document.body.classList.toggle('h',!!v.horiz);document.body.classList.toggle('s2',!!v.split);for(const k in v)s.setProperty('--'+k,v[k]);},[w,h,v]);
await p.waitForTimeout(300);
await p.screenshot({path:n});await p.close();}
await b.close();})();
