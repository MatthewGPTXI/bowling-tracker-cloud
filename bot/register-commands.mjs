import {commands} from './src/commands.mjs';

const guild=process.argv[2];
if(!guild || !/^\d{17,20}$/.test(guild))throw new Error('Usage: npm run register -- YOUR_DISCORD_SERVER_ID');
let token=process.env.DISCORD_BOT_TOKEN;
if(!token){
 if(!process.stdin.isTTY)throw new Error('Use an interactive terminal or provide DISCORD_BOT_TOKEN in the environment.');
 process.stdout.write('Paste bot token (hidden), then press Enter: ');
 token=await new Promise((resolve,reject)=>{
  let value='';process.stdin.setRawMode(true);process.stdin.resume();process.stdin.setEncoding('utf8');
  function finish(error){process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');error?reject(error):resolve(value.trim());}
  function onData(text){for(const char of text){if(char==='\u0003'){finish(new Error('Cancelled'));return;}if(char==='\r'||char==='\n'){finish();return;}if(char==='\u007f'){value=value.slice(0,-1);}else value+=char;}}
  process.stdin.on('data',onData);
 });
}
const response=await fetch(`https://discord.com/api/v10/applications/1546004844970770443/guilds/${guild}/commands`,{method:'PUT',headers:{Authorization:`Bot ${token}`,'Content-Type':'application/json'},body:JSON.stringify(commands)});
if(!response.ok)throw new Error(`Command registration failed: HTTP ${response.status}. Check bot token, server ID and installation.`);
console.log('Registered /bowling commands in your server. No token was written to disk.');
