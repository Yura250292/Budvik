/**
 * Скільки кілометрів домальовує OSRM у розривах — і скільки з того вигадка.
 *
 * Питання, заради якого скрипт існує: домальовка розривів дорогою мала
 * повертати кілометри, які хорда з'їдає, а натомість на планшетах зі слабким
 * приймачем вона їх НАКРУЧУВАЛА. 31.08 у Валентина розриви з прямою 22 км
 * дали «дорогою» 334 км, бо маршрут вели через фікси по вежах.
 *
 * Скрипт бере зміни з чесним одометром (єдина незалежна правда) і рахує
 * пробіг двічі: як він збережений у базі і як вийшов би з фільтром via.
 * Ходить у публічний OSRM, тож виконується хвилини — це інструмент розбору,
 * а не перевірка для CI.
 *
 * Читає лише базу, нічого не пише.
 */

import { PrismaClient } from "@prisma/client";
import { getRoute } from "../src/lib/geo/osrm";
const prisma = new PrismaClient();
const MAX_ACC = 100, SANITY = 4;
function hav(a:number,b:number,c:number,d:number){const R=6371000,r=(x:number)=>x*Math.PI/180;
 const dLat=r(c-a),dLng=r(d-b);const h=Math.sin(dLat/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(dLng/2)**2;
 return 2*R*Math.asin(Math.sqrt(h));}
function offChord(p:any,a:any,b:any){const mLat=111320,mLng=111320*Math.cos(p.lat*Math.PI/180);
 const px=(p.lng-a.lng)*mLng,py=(p.lat-a.lat)*mLat,bx=(b.lng-a.lng)*mLng,by=(b.lat-a.lat)*mLat;
 const L=bx*bx+by*by; if(!L) return Math.hypot(px,py);
 const t=Math.max(0,Math.min(1,(px*bx+py*by)/L)); return Math.hypot(px-t*bx,py-t*by);}
const pick=(arr:any[])=>{const n=3; if(arr.length<=n) return arr;
 const step=(arr.length-1)/(n+1); const o=[]; for(let i=1;i<=n;i++) o.push(arr[Math.round(step*i)]); return o;}

async function road(from:any,via:any[],to:any): Promise<number|null> {
  try {
    const r = await getRoute([[from.lng,from.lat],...via.map((v:any)=>[v.lng,v.lat] as [number,number]),[to.lng,to.lat]]);
    const m = r.totalDistanceKm*1000, straight = hav(from.lat,from.lng,to.lat,to.lng);
    if (m < straight || m > straight*SANITY) return null;
    return m;
  } catch { return null; }
}

const shifts = await prisma.shift.findMany({
  where: { startedAt: { gte: new Date("2026-08-26"), lt: new Date("2026-09-01") }, distanceKm: { not: null } },
  select: { id:true,distanceKm:true,gpsDistanceKm:true,startedAt:true,user:{select:{name:true}} },
  orderBy: { startedAt: "asc" },
});
let totOdo=0, totOld=0, totNew=0;
for (const s of shifts) {
  const pts = await prisma.trackPoint.findMany({ where:{shiftId:s.id}, orderBy:{recordedAt:"asc"},
    select:{lat:true,lng:true,accuracyM:true,roadMetersFromPrev:true,gapGeometry:true} });
  if (pts.length < 20) continue;
  let anchor:any=null, since:any[]=[], oldAdd=0, newAdd=0, kept=0, dropped=0;
  for (const p of pts) {
    const trusted = p.accuracyM==null || p.accuracyM<=MAX_ACC;
    const g:any=p.gapGeometry;
    if (g?.coordinates && anchor) {
      const straight = hav(anchor.lat,anchor.lng,p.lat,p.lng);
      const oldRoad = p.roadMetersFromPrev ?? straight;
      const viaNew = pick(since.filter((v:any)=>v.accuracyM==null || offChord(v,anchor,p)>v.accuracyM));
      if (since.length) { kept+=viaNew.length; dropped+=Math.min(since.length,3)-viaNew.length; }
      const newRoad = viaNew.length === pick(since).length ? oldRoad : (await road(anchor,viaNew,p)) ?? straight;
      oldAdd += oldRoad - straight; newAdd += newRoad - straight;
    }
    if (trusted) { anchor=p; since=[]; } else since.push(p);
  }
  const base = (s.gpsDistanceKm ?? 0) - oldAdd/1000;
  const oldKm = s.gpsDistanceKm ?? 0, newKm = base + newAdd/1000;
  totOdo += s.distanceKm!; totOld += oldKm; totNew += newKm;
  console.log(
    s.startedAt.toISOString().slice(5,10), (s.user.name||"").slice(0,14).padEnd(14),
    "одометр", String(s.distanceKm).padStart(4),
    "| було", oldKm.toFixed(0).padStart(4), `(${((oldKm/s.distanceKm!-1)*100).toFixed(0).padStart(4)}%)`,
    "| стало", newKm.toFixed(0).padStart(4), `(${((newKm/s.distanceKm!-1)*100).toFixed(0).padStart(4)}%)`,
    "| via лишилось", kept, "прибрано", dropped
  );
}
console.log("\nРАЗОМ  одометр", totOdo, " було", totOld.toFixed(0), `(${((totOld/totOdo-1)*100).toFixed(1)}%)`,
  " стало", totNew.toFixed(0), `(${((totNew/totOdo-1)*100).toFixed(1)}%)`);
await prisma.$disconnect();
