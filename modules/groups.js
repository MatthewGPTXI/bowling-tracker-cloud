// Stable choice across retries. A sole owner's group is dissolved; no blank
// ownerUid is ever written. Existing members retain the group on transfer.
export function successorFor(ownerUid, members) {
  return [...new Set(members.map(member => member.uid).filter(uid => typeof uid === 'string' && uid && uid !== ownerUid))].sort()[0] || null;
}
export async function leaveMembership({sdk, firestore, groupId, uid, isCurrent}) {
  const assertCurrent = () => { if (!isCurrent()) throw new Error('Account changed. Please try again.'); };
  const groupRef = sdk.doc(firestore, 'groups', groupId);
  const memberRef = sdk.doc(firestore, 'groups', groupId, 'members', uid);
  const group = await sdk.getDoc(groupRef);
  assertCurrent();
  let successor = null;
  if (group.exists() && group.data().ownerUid === uid) {
    const rows = await sdk.getDocs(sdk.collection(firestore, 'groups', groupId, 'members'));
    assertCurrent();
    const members = []; rows.forEach(row => members.push({uid: row.id}));
    successor = successorFor(uid, members);
  }
  await sdk.runTransaction(firestore, async tx => {
    assertCurrent();
    const latest = await tx.get(groupRef);
    const next = successor ? await tx.get(sdk.doc(firestore, 'groups', groupId, 'members', successor)) : null;
    assertCurrent();
    if (latest.exists() && latest.data().ownerUid === uid) {
      if (successor && !next.exists()) throw new Error('Group membership changed. Please try leaving again.');
      if (successor) tx.update(groupRef, {ownerUid: successor, updatedAt: Date.now()});
      else tx.delete(groupRef);
    }
    tx.delete(memberRef);
  });
  return successor;
}
