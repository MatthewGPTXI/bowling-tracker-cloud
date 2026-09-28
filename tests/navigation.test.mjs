import assert from 'node:assert/strict';
import {createNavigation} from '../modules/navigation.js';
const panels = ['home','sessions','stats','friends','profile'].map(view=>({id:'view-'+view,hidden:true}));
const buttons = panels.map(panel=>({dataset:{goView:panel.id.slice(5)},setAttribute(){},removeAttribute(){}}));
const writes=[],scrolls=[];
const document = {getElementById:id=>panels.find(panel=>panel.id===id) || {focus(){}},
  querySelectorAll:selector=>selector==='.app-view'?panels:buttons};
const window = {scrollY:123,addEventListener(){},scrollTo:options=>scrolls.push(options.top)};
const storage = {getItem:()=>JSON.stringify({view:'profile',y:321}),setItem:(_,value)=>writes.push(JSON.parse(value))};
const nav = createNavigation({document,window,storage,pathname:'/',pagePosition:()=>({y:123})});
nav.initialize(); assert.equal(panels.find(panel=>!panel.hidden).id,'view-profile');
assert(!writes.some(value=>value.view==='home'),'Restoration never initializes through Home');
nav.restoreScroll();assert.equal(scrolls.at(-1),321);
nav.navigate('stats');nav.rememberPage();assert.equal(writes.at(-1).view,'stats');assert.equal(writes.at(-1).y,123);
nav.navigate('unknown');assert.equal(nav.current(),'stats');
console.log('PASS navigation ownership: direct restored startup, scroll position, persisted active view and invalid-route handling.');
