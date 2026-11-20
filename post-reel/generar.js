// Arma el reel (1080×1920, 30 fps) con plantilla.html, las tomas de clips/ y musica.wav.
// Uso (desde esta carpeta):  python3 musica.py 27 && node generar.js   → reel.mp4 y portada.jpg
// Locución opcional: voz.mp3 (o voz-01…voz-09.mp3, una por escena); ver locucion.txt
const {chromium}=require('playwright');const path=require('path');const fs=require('fs');const os=require('os');const {execFileSync}=require('child_process');
const FPS=30,Q=['-v','error','-y'];
(async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'reel-'));
 // 1. Cuadros de cada toma (clips/*.mp4 grabados del juego a 844×390)
 const clips={};
 for(const f of fs.readdirSync('clips').filter(f=>f.endsWith('.mp4'))){const n=f.slice(0,-4),d=path.join(tmp,n);fs.mkdirSync(d);
  execFileSync('ffmpeg',[...Q,'-i',path.join('clips',f),'-q:v','2',path.join(d,'%04d.jpg')]);clips[n]={dir:d,count:fs.readdirSync(d).length};}
 const out=path.join(tmp,'out');fs.mkdirSync(out);
 // 2. Cada cuadro del reel
 const b=await chromium.launch();const p=await b.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});
 await p.goto('file://'+path.resolve('plantilla.html'));await p.evaluate(()=>document.fonts.ready);
 const dur=await p.evaluate(()=>DUR),total=Math.round(dur*FPS);let last='';
 for(let k=0;k<total;k++){const t=k/FPS;
  const r=await p.evaluate(t=>{const r=render(t);return {shot:r.shot,st:r.st};},t);const sh=r.shot;let src,tf='none';
  if(sh.clip){const c=clips[sh.clip];const i=Math.min(c.count,1+(sh.from||0)+Math.floor(r.st*FPS));src='file://'+path.join(c.dir,String(i).padStart(4,'0')+'.jpg');}
  else{src='file://'+path.resolve(sh.still);const z=1.03+0.05*r.st/2.5;tf=`scale(${z}) translateX(${-r.st*6}px)`;}
  await p.evaluate(async([src,tf,ch])=>{const im=document.getElementById('imA');if(ch){im.src=src;await im.decode().catch(()=>{});}im.style.transform=tf;},[src,tf,src!==last]);last=src;
  await p.screenshot({path:path.join(out,String(k).padStart(4,'0')+'.jpg'),type:'jpeg',quality:94});
  if(k===Math.round(4.2*FPS))fs.copyFileSync(path.join(out,String(k).padStart(4,'0')+'.jpg'),'portada.jpg');
  if(k%60===0)process.stdout.write(`${k}/${total} `);}
 await b.close();
 // 3. Vídeo con música y, si está, la locución (voz.mp3/voz.wav o voz-01…voz-09, una por escena)
 const SCENE_T=[0,3,6.5,10,12,15.5,18,20.5,23];
 const one=['voz.mp3','voz.wav'].find(f=>fs.existsSync(f));
 const parts=SCENE_T.map((t,i)=>['mp3','wav'].map(e=>`voz-${String(i+1).padStart(2,'0')}.${e}`).find(f=>fs.existsSync(f))).map((f,i)=>f&&{f,t:SCENE_T[i]}).filter(Boolean);
 const voices=one?[{f:one,t:+(process.env.VOZ_INICIO||0.2)}]:parts;
 const args=[...Q,'-framerate',String(FPS),'-i',path.join(out,'%04d.jpg'),'-i','musica.wav'];
 voices.forEach(v=>args.push('-i',v.f));
 const vcod=['-c:v','libx264','-preset','slow','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart'];
 if(!voices.length)execFileSync('ffmpeg',[...args,...vcod,'-shortest','reel.mp4']);
 else{
  // Voz: limpia, al mismo volumen y en su segundo; la música baja (sidechain) mientras se habla
  const d=voices.map((v,i)=>`[${i+2}:a]aresample=44100,aformat=channel_layouts=stereo,adelay=${Math.round(v.t*1000)}:all=1[v${i}]`).join(';');
  const mixV=voices.length>1?`${voices.map((_,i)=>`[v${i}]`).join('')}amix=inputs=${voices.length}:normalize=0,`:`[v0]`;
  const fc=`${d};${mixV}${voices.length>1?'':'anull,'}loudnorm=I=-16:TP=-1.5,apad,asplit[va][vb];`+
   `[1:a]volume=0.85[m];[m][va]sidechaincompress=threshold=0.02:ratio=10:attack=30:release=400:makeup=1[md];`+
   `[md][vb]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]`;
  execFileSync('ffmpeg',[...args,'-filter_complex',fc,'-map','0:v','-map','[a]',...vcod,'-t',String(dur),'reel.mp4']);
  console.log('\nlocución mezclada:',voices.map(v=>v.f).join(', '));}
 fs.rmSync(tmp,{recursive:true,force:true});console.log('\nreel.mp4 listo');
})();
