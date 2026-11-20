const c=require('./common');
const st=p=>p.evaluate(()=>{const g=RedMoviSim.game,s=g.player.sim;return {door:s.doorState,v:+(s.speed||s.v||0).toFixed?.(1),notch:s.notch,txt:document.body.innerText.match(/espera [\d:]+|sale [\d:]+/i)?.[0]};});
(async()=>{const {b,p}=await c.open();
await c.click(p,'[data-card="driver"]');await p.waitForTimeout(400);
await c.click(p,'#lineChips [data-line="'+(process.argv[2]||'1')+'"]');await p.waitForTimeout(400);
await c.click(p,'#driverGo');await c.waitGame(p);await p.waitForTimeout(1500);
await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>/Saltar tutorial/.test(x.textContent));b&&b.click();});
for(let i=0;i<60;i++){const s=await st(p);if(i%5==0)console.log(i,JSON.stringify(s));if(s.door==='open'&&(!s.txt||/0:0[0-1]/.test(s.txt)||/sale/i.test(s.txt))){await c.key(p,'d');console.log('cierro',i);break;}await c.ff(p,1);}
for(let i=0;i<30;i++){const s=await st(p);if(s.door==='closed')break;await c.ff(p,1);}
for(let i=0;i<7;i++)await c.key(p,'w');
console.log(JSON.stringify(await st(p)));
const dist=()=>p.evaluate(()=>+(document.body.innerText.match(/Faltan ([\d.]+) m/)||[])[1]);
await c.ff(p,8);let d;for(let i=0;i<400;i++){d=await dist();if(i%10==0){console.log('loop',i,d,JSON.stringify(await st(p)));await p.screenshot({path:'mdbg.png'});}if(d>0&&d<=320)break;await c.ff(p,0.5,100);}console.log('dist',d);
for(let i=0;i<5;i++)await c.key(p,'s');
for(let i=0;i<200;i++){d=await dist();if(d>0&&d<=190)break;await c.ff(p,0.3,100);}console.log('dist',d,JSON.stringify(await st(p)));
await c.rec(p,'clip-metro',150);
await p.screenshot({path:'m2.png'});
await b.close();})();
