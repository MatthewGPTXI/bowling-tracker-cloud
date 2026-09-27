// Run with an authenticated GitHub CLI that has repository administration access.
// The user's requested policy requires PRs and CI, without requiring a second
// maintainer on a personal repository. It also replaces ungated branch publishing.
import {spawnSync} from 'node:child_process';
const repo='MatthewGPTXI/bowling-tracker-cloud';
for (const args of [
  ['api','--method','PUT',`repos/${repo}/branches/main/protection`,'--input','docs/branch-protection.json'],
  ['api','--method','PUT',`repos/${repo}/pages`,'-f','build_type=workflow']
]) {
  const result=spawnSync('gh',args,{stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status||1);
}
