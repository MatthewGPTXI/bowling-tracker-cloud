export const cleanBall = value => String(value || '').trim().replace(/\s+/g,' ');
export const ballKey = value => cleanBall(value).toLowerCase();
export const typeOf = game => ['League','Practice','Tournament'].includes(game.sessionType) ? game.sessionType : 'League';
export const sessionKey = game => `${game.date}|||${String(game.sessionName || '').trim().toLowerCase() || 'bowling session'}`;
export const order = (a,b) => Number(a.gameOrder ?? a.createdAt ?? a.id)-Number(b.gameOrder ?? b.createdAt ?? b.id) || a.id-b.id;
export function validDate(date) {
 return /^\d{4}-\d{2}-\d{2}$/.test(date) && !date.startsWith('0000') && Number.isFinite(Date.parse(date+'T00:00:00Z')) && new Date(date+'T00:00:00Z').toISOString().slice(0,10) === date;
}
export function filterGames(games, options={}) {
 if (options.from && !validDate(options.from) || options.through && !validDate(options.through)) throw new Error('Use dates in YYYY-MM-DD format.');
 if (options.from && options.through && options.from > options.through) throw new Error('From must be on or before through.');
 return games.filter(g=>!g.deleted && (!options.from || g.date>=options.from) && (!options.through || g.date<=options.through) && (!options.type || typeOf(g)===options.type) && (!options.ball || ballKey(g.ball)===ballKey(options.ball)));
}
export function sessions(games) {
 const groups=new Map();for(const g of games){const key=sessionKey(g);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(g);}
 return [...groups.values()].map(list=>({games:list.sort(order),date:list[0].date,type:typeOf(list[0])})).sort((a,b)=>b.date.localeCompare(a.date)||Math.max(...b.games.map(g=>g.createdAt||g.id))-Math.max(...a.games.map(g=>g.createdAt||g.id)));
}
export function stats(games, all=games) {
 const n=games.length,total=games.reduce((s,g)=>s+Number(g.score),0),strikes=games.reduce((s,g)=>s+Number(g.strikes),0),opp=games.reduce((s,g)=>s+Number(g.strikeOpportunities||10),0);
 const ids=new Set(games.map(g=>g.id));let bestSeries=null;
 for(const session of sessions(all)){for(let i=0;i<=session.games.length-3;i++){const slice=session.games.slice(i,i+3);if(slice.every(g=>ids.has(g.id)))bestSeries=Math.max(bestSeries||0,slice.reduce((s,g)=>s+g.score,0));}}
 return {games:n,average:n?total/n:null,highGame:n?Math.max(...games.map(g=>g.score)):null,highSeries:bestSeries,strikes,strikePct:opp?strikes/opp*100:null,cleanGames:games.filter(g=>g.openFrames===0).length,openAverage:n?games.reduce((s,g)=>s+g.openFrames,0)/n:null};
}
export function statsText(title,games,all=games) {
 const s=stats(games,all),num=n=>n===null?'—':n.toFixed(1);
 return `**${title}**\nGames: ${s.games} · Average: ${num(s.average)}\nHigh game: ${s.highGame??'—'} · Best consecutive 3: ${s.highSeries??'—'}\nStrike rate: ${num(s.strikePct)}% · Strikes: ${s.strikes}\nClean games: ${s.cleanGames} · Open frames/game: ${num(s.openAverage)}`;
}
export const safeText = value => String(value||'').replace(/[@`*_~|<>\\]/g,'').slice(0,100);
