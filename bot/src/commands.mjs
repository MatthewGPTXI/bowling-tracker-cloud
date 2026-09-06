const str=(name,description,required=false)=>({type:3,name,description,required});
const user=(name,description,required=false)=>({type:6,name,description,required});
const dates=[str('from','First bowling date: YYYY-MM-DD'),str('through','Last bowling date: YYYY-MM-DD'),{...str('type','Limit to a session type'),choices:['League','Practice','Tournament'].map(name=>({name,value:name}))}];
const sub=(name,description,options=[])=>({type:1,name,description,options});
export const commands=[{name:'bowling',description:'Bowling Tracker stats and account tools',type:1,contexts:[0],integration_types:[0],options:[
 sub('link','Open the app to connect your Discord account'),
 sub('stats','Your stats or a linked group member’s stats',[user('player','Player; defaults to you'),...dates]),
 sub('session','Latest bowling session',[user('player','Player; defaults to you')]),
 sub('ball','Stats for a ball; omit ball to list your saved balls',[str('ball','Ball name; omit to list recorded balls'),...dates]),
 sub('leaderboard','Current all-history group rankings',[{...str('metric','Ranking metric'),choices:[['Average','average'],['High game','highGame'],['High series','highSeries'],['Strike percentage','strikePct'],['Clean games','cleanGames']].map(([name,value])=>({name,value}))}]),
 sub('compare','Compare yourself with a selected Discord user',[user('opponent','Player to compare against',true),user('player','First player; defaults to you'),...dates]),
 sub('recap','Group recap for the previous seven complete UTC dates'),
 sub('configure','Server admin + bowling group owner: bind a group and optionally enable weekly recaps',[str('group','Bowling app group invite code',true),{type:7,name:'channel',description:'Private bowling channel for weekly recaps',channel_types:[0,5]},{type:5,name:'weekly',description:'Enable weekly public-to-channel recaps (default false)'}]),
 sub('disable','Server admin: remove the group connection and disable weekly recaps')
]}];
