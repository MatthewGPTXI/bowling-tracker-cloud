// Transitional adapter for the preserved VM integration suites. New domain tests
// import modules directly; this file is not shipped in the application.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
function source(file) {
  let text = fs.readFileSync(file, 'utf8');
  if (!file.endsWith('.js')) return text;
  text = text.replace(/^import .*?;\n/gm, '').replace(/^export \{.*?\};?\n/gm, '').replace(/^export /gm, '');
  const name = path.basename(file);
  const exposed = {'app.js':['BowlingApp','app'],'cloud.js':['BowlingCloud','cloud'],'friend-stats.js':['BowlingFriends','friends'],'score-cards.js':['BowlingScoreCards','scoreCards'],'updates.js':['BowlingUpdates','updates']};
  if (exposed[name]) text += `\nwindow.${exposed[name][0]} = ${exposed[name][1]};`;
  return text;
}
function prepare(context) {
  for (const [alias,file] of Object.entries({CloudReader:'cloud-reader',Groups:'groups',Inventory:'inventory',History:'history-renderer',Sessions:'sessions',Stats:'statistics',Game:'games',Backup:'backup',Storage:'storage',Drafts:'drafts',IDs:'ids',Reconciliation:'reconciliation'})) {
    context[alias] = require(path.join(root,'modules',file+'.js'));
  }
  context.History = {...context.History, patchSessions:(container, rows)=>{container.innerHTML=rows.map(row=>row.html).join('');}};
  context.createInventoryEditor = require(path.join(root,'modules/inventory-editor.js')).createInventoryEditor;
  context.Balls = require(path.join(root,'balls.js'));
  for (const [alias,key] of Object.entries({App:'BowlingApp',Cloud:'BowlingCloud',Friends:'BowlingFriends',ScoreCards:'BowlingScoreCards'})) {
    if (!Object.getOwnPropertyDescriptor(context,alias)) Object.defineProperty(context, alias, {get:()=>context.window?.[key],configurable:true});
  }
  context.runtime = {get cloud() {return context.window?.BowlingCloud;}, get updates() {return context.window?.BowlingUpdates;}};
  context.UI = {closeDialog: dialog=>dialog.close(),openDialog: dialog=>dialog.showModal(),rememberPage:()=>context.window?.BowlingUI?.rememberPage()};
  if (context.document && context.window) {
    context.Navigation = require(path.join(root,'modules/navigation.js')).createNavigation({document:context.document,window:context.window,storage:context.sessionStorage,pathname:'/'});
  }
  return context;
}
module.exports = {source, prepare};
