const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = path.resolve(__dirname, '..');
const harness = fs.readFileSync(path.join(__dirname, 'ui-regression.cjs'), 'utf8').split('(async()=>{')[0];
const {app,t,$,game,database} = vm.runInNewContext(harness+'\n({app,t,$,game,database});',
  {require,console,__dirname,setTimeout,clearTimeout,URL,structuredClone,queueMicrotask,setImmediate,process});
const cards = require('../score-cards.js');
const partial = (id, score) => ({...game(id,'2026-09-24',score),scoreOnly:true,strikes:null,openFrames:null,strikeOpportunities:null});
const key = '2026-09-24|||league';
const data = [
  {...game(3,'2026-09-24',180),gameOrder:3,strikes:3,strikeOpportunities:10,openFrames:4},
  {...game(1,'2026-09-24',300),gameOrder:1,strikes:12,strikeOpportunities:12,openFrames:0},
  {...partial(2,210),gameOrder:2},
  {...game(4,'2026-09-24',250),gameOrder:4,noTap:true}
];
t.setState(database(data),data);
assert.equal(app.getScoreCardData(),null,'Startup cannot export another profile’s data');
app.ready=true;
const card = app.getScoreCardData(key);
assert.equal(card.total,690);assert.equal(card.average,230);
assert.equal(card.strikePct,15/22*100,'Weight strike percentages by actual opportunities');
assert.equal(card.closedFramePct,80,'Only recorded ten-frame games enter the denominator');
assert.equal(card.count,3);assert.equal(card.frameCount,2);assert.equal(card.noTapCount,1);
assert.deepEqual(Array.from(card.scores, game=>game.score),[300,210,180,250]);
assert.equal(card.scores[3].noTap,true);
assert(!JSON.stringify(card).includes('Keep notes'));
assert(!Object.hasOwn(card,'uid'));assert(!Object.hasOwn(card,'email'));assert(!Object.hasOwn(card,'alley'));
const safeSnapshot=JSON.stringify(card);card.scores[0].score=1;
assert.equal(app.getGames().find(g=>g.id===1).score,300,'Cards never mutate history');
$('statsFrom').value='2099-01-01';$('statsType').value='Tournament';$('historyScoring').value='no-tap';
const overall=app.getScoreCardData();
assert.equal(overall.count,3);assert.equal(overall.highSeries,690);assert.equal(overall.highGame,300);
assert.equal(overall.scores.length,0);assert.equal(overall.kind,'overall');
assert.equal(app.getScoreCardData('deleted-session'),null);
t.setState(database([partial(2,0)]),[partial(2,0)]);
const zero=app.getScoreCardData(key);assert.equal(zero.average,0);assert.equal(zero.total,0);
assert.equal(zero.strikePct,null);assert.equal(zero.closedFramePct,null);
assert(cards.describe(zero).includes('not recorded'));assert(!cards.describe(zero).includes('100.0%'));
const noTap = [{...data[0],noTap:true},{...partial(2,200),noTap:true}];
t.setState(database(noTap),noTap);
assert.equal(app.getScoreCardData(),null,'No-tap-only history has no overall standard card');
const noTapCard=app.getScoreCardData(key);assert.equal(noTapCard.total,380);assert.equal(noTapCard.noTapOnly,true);
assert.equal(noTapCard.strikePct,30);assert.equal(noTapCard.closedFramePct,60);
assert(cards.describe(noTapCard).includes('No-tap session'));
t.setState(database([]),[]);assert.equal(app.getScoreCardData(),null);

// The renderer must preserve every score across bounded-size PNG pages.
const long={...JSON.parse(safeSnapshot),scores:Array.from({length:61},(_,i)=>({number:i+1,score:100+i,noTap:false})),count:61};
assert.equal(cards.pages(long),3);
const canvas={texts:[],getContext(){return {fillRect(){},beginPath(){},roundRect(){},fill(){},arc(){},stroke(){},createLinearGradient(){return {addColorStop(){}}},measureText(value){return {width:String(value).length*14}},fillText:(value,x,y)=>{assert(y<=canvas.height,'No clipped text');canvas.texts.push(value)}}}};
for(let page=0;page<3;page++) {
  canvas.texts=[];cards.render(long,canvas,page);
  assert(canvas.width===1080&&canvas.height<2300);
  assert(canvas.texts.includes('STANDARD SERIES TOTAL'));
  const gameLabels=canvas.texts.filter(value=>/^GAME /.test(value));
  assert.equal(gameLabels.length,page===2?13:24);
  assert.equal(gameLabels[0],`GAME ${page*24+1}`);
  assert(cards.filename(long,page).endsWith(`-${page+1}.png`));
}
assert.equal(cards.filename(overall),'bowling-tracker-overall-'+overall.date+'.png');
const comparison = {kind:'comparison', date:'2026-09-25', asOf:'Sep 25, 2026', scores:[], bowlers:[
  {name:'Matthew', self:true, updatedAt:Date.now(), games:20, frameCount:15, average:180, highGame:280,
    highSeries:630, strikePct:42, closedFramePct:80, cleanGames:3, totalStrikes:63},
  {name:'A very long bowler name 🎳 '.repeat(5), self:false, updatedAt:null, games:3, frameCount:0, average:0,
    highGame:0, highSeries:0, strikePct:null, closedFramePct:null, cleanGames:null, totalStrikes:null}
]};
canvas.texts=[]; cards.render(comparison,canvas);
assert.equal(canvas.width,1080); assert.equal(canvas.height,1640);
assert.equal(canvas.texts.filter(value=>value==='Closed frame %').length,2);
assert.equal(canvas.texts.filter(value=>value==='—').length,4);
assert(canvas.texts.includes('Matthew')); assert(canvas.texts.includes('0.0'));
assert(canvas.texts.some(value=>value.startsWith('A very long')&&value.endsWith('…')));
assert.equal(cards.pages(comparison),1);
assert.equal(cards.filename(comparison),'bowling-tracker-comparison-2026-09-25.png');
assert(cards.describe(comparison).includes(comparison.bowlers[1].name),'Accessible description preserves the full name');
assert(cards.describe(comparison).includes('Frame details: 0 of 3 games'));
assert(!cards.describe(comparison).includes('undefined'));
assert(fs.readFileSync(path.join(root,'service-worker.js'),'utf8').includes("'./score-cards.js'"));
console.log('PASS: score cards preserve game order, weighted frame stats, missing stats, zero scores, no-tap rules, all-time scope, safe snapshots, and all scores across long-session pages.');
