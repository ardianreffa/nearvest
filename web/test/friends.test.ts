// Add friend + Online (src/friends-logic.ts): only on servers that send `state.friends`, friends on
// top of Farmers of Tandur (not twice), the notice text, the button words and the ping rule
// (only while the tab is visible; "away" when hidden).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FarmerRow, FriendAddView } from '../src/api.ts';
import { addFriendBlocked, friendAddNotice, friendButtonLabel, friendsSupported, othersAfterFriends, presenceOnVisibility } from '../src/friends-logic.ts';

const farmer = (name: string, over: Partial<FarmerRow> = {}): FarmerRow => ({ name, avatar: 'farmer_hat', title: 'Seedling', trees: 1, thirsty: 0, helpedYou: false, judge: false, ...over });
const add = (from: string, over: Partial<FriendAddView> = {}): FriendAddView => ({ id: 1, from, avatar: 'farmer_hat', title: 'Seedling', at: 0, mutual: false, online: false, ...over });

describe('friends: old and new servers', () => {
  it('Add friend and Online only when the server sends state.friends', () => {
    assert.equal(friendsSupported(null), false);
    assert.equal(friendsSupported({}), false, 'old server (nearvest-edfb355): nothing');
    assert.equal(friendsSupported({ friends: { count: 0, max: 50, addsLeft: 20, addsPerDay: 20, onlineMs: 60000, pingMs: 30000 } }), true);
  });
});

describe('Farmers of Tandur sections', () => {
  it('friends on top, the other farmers below without them', () => {
    const farmers = [farmer('ani'), farmer('budi', { friend: true }), farmer('citra')];
    const friends = [farmer('budi', { friend: true, online: true }), farmer('dewi', { friend: true, trees: 0 })];
    assert.deepEqual(
      othersAfterFriends(farmers, friends).map((f) => f.name),
      ['ani', 'citra'],
    );
  });
  it('old servers (no friends list): the list as it was', () => {
    const farmers = [farmer('ani'), farmer('budi')];
    assert.equal(othersAfterFriends(farmers, undefined), farmers);
    assert.equal(othersAfterFriends(farmers, []), farmers);
  });
});

describe('notice and buttons', () => {
  it('"<name> added you as a friend"', () => {
    assert.equal(friendAddNotice([]), '');
    assert.equal(friendAddNotice([add('budi')]), 'budi added you as a friend');
    assert.equal(friendAddNotice([add('budi'), add('ani')]), 'budi and ani added you as a friend');
    assert.equal(friendAddNotice([add('budi'), add('ani'), add('citra')]), 'budi and 2 others added you as a friend');
  });
  it('Add friend / Friends (+ pixel check) / busy', () => {
    assert.equal(friendButtonLabel(false, false), 'Add friend');
    assert.equal(friendButtonLabel(false, false, true), 'Add');
    assert.equal(friendButtonLabel(true, false), 'Friends');
    assert.equal(friendButtonLabel(false, true), 'Adding...');
    assert.equal(friendButtonLabel(true, true), 'Removing...');
  });
  it('blocked at 50 friends or 20 adds today', () => {
    assert.equal(addFriendBlocked(undefined), null);
    assert.equal(addFriendBlocked({ count: 3, max: 50, addsLeft: 17 }), null);
    assert.match(addFriendBlocked({ count: 50, max: 50, addsLeft: 5 })!, /50 friends/);
    assert.match(addFriendBlocked({ count: 20, max: 50, addsLeft: 0 })!, /tomorrow/);
  });
});

describe('presence (the light ping)', () => {
  it('pings only while visible; says away when hidden; nothing on old servers', () => {
    assert.deepEqual(presenceOnVisibility(true, true), { kind: 'ping' });
    assert.deepEqual(presenceOnVisibility(true, false), { kind: 'away' });
    assert.deepEqual(presenceOnVisibility(false, true), { kind: 'none' });
    assert.deepEqual(presenceOnVisibility(false, false), { kind: 'none' });
  });
});
