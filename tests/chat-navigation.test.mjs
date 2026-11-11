import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatNavigator } from '../chat-navigation.js';
function harness() {
    const characters = [{ avatar: 'one.png', chat: 'Current', shallow: true }];
    const groups = [{ id: 'g', chat_id: 'Current Group', chats: ['Current Group', 'Older Group'] }];
    const state = { characterId: null, groupId: null };
    const loads = [], saves = [];
    const context = { characters, groups, getCurrentChatId: () => state.groupId ? groups[0].chat_id : characters[state.characterId]?.chat,
        unshallowCharacter: async id => { characters[id] = { ...characters[id], shallow: false, chat: 'Current' }; },
        selectCharacterById: async id => { state.characterId = id; state.groupId = null; loads.push(characters[id].chat); },
        openCharacterChat: async file => { characters[state.characterId].chat = file; loads.push(file); },
        openGroupChat: async (id,file) => { groups[0].chat_id = file; loads.push(file); },
    };
    const host = { updateRemoteChatName: async (id,file) => saves.push([id,file]) };
    const groupHost = { openGroupById: async id => { state.groupId = id; state.characterId = null; loads.push(groups[0].chat_id); }, editGroup: async (...args) => saves.push(args) };
    const navigate = createChatNavigator({ context: () => ({ ...context,...state }), host, groups: groupHost });
    return { characters, groups, state, context, host, groupHost, navigate, loads, saves, entity: { id:0, avatar:'one.png' } };
}
test('older history is hydrated first and loaded exactly once, saving only its pointer', async () => {
    const h=harness(); assert.equal(await h.navigate(h.entity,'Older'),true);
    assert.deepEqual(h.loads,['Older']); assert.deepEqual(h.saves,[[0,'Older']]);
});
test('opening an already active history does no loading; another file loads once', async () => {
    const h=harness();h.state.characterId=0;
    await h.navigate(h.entity,'Current');assert.deepEqual(h.loads,[]);
    await h.navigate(h.entity,'Older');assert.deepEqual(h.loads,['Older']);assert.deepEqual(h.saves,[]);
});
test('saving and generation guards leave pointers and selection untouched',async()=>{
    for(const flag of ['isChatSaving','is_send_press','is_group_generating']){
        const h=harness();(flag==='is_group_generating'?h.groupHost:h.host)[flag]=true;
        assert.equal(await h.navigate(h.entity,'Older'),false);assert.equal(h.characters[0].chat,'Current');assert.deepEqual(h.loads,[]);assert.deepEqual(h.saves,[]);
    }
});
test('generation beginning during hydration is respected',async()=>{
    const h=harness();h.context.unshallowCharacter=async()=>{h.host.is_send_press=true;};
    assert.equal(await h.navigate(h.entity,'Older'),false);assert.equal(h.characters[0].chat,'Current');assert.deepEqual(h.loads,[]);
});
test('native refusal or selection error restores the previous pointer without saving',async()=>{
    for(const throws of [false,true]){
        const h=harness();h.context.selectCharacterById=async()=>{if(throws)throw Error('refused');};
        if(throws)await assert.rejects(h.navigate(h.entity,'Older'),/refused/);else assert.equal(await h.navigate(h.entity,'Older'),false);
        assert.equal(h.characters[0].chat,'Current');assert.deepEqual(h.saves,[]);
    }
});
test('pointer save failure does not roll back an already displayed chat',async()=>{
    const h=harness();h.host.updateRemoteChatName=async()=>{throw Error('offline');};
    await assert.rejects(h.navigate(h.entity,'Older'),/offline/);assert.deepEqual(h.loads,['Older']);assert.equal(h.characters[0].chat,'Older');
});
test('a host without pointer persistence uses its native history API',async()=>{
    const h=harness();delete h.host.updateRemoteChatName;
    assert.equal(await h.navigate(h.entity,'Older'),true);assert.deepEqual(h.loads,['Current','Older']);
});
test('a stale character index cannot change a different character',async()=>{
    const h=harness();assert.equal(await h.navigate({...h.entity,avatar:'missing.png'},'Older'),false);assert.deepEqual(h.loads,[]);
});
test('a group switches straight to its requested history and persists without reloading',async()=>{
    const h=harness();assert.equal(await h.navigate({group:'g'},'Older Group'),true);
    assert.deepEqual(h.loads,['Older Group']);assert.deepEqual(h.saves,[['g',true,false]]);
});
test('group refusal rolls back and unknown histories never change the group',async()=>{
    const h=harness();h.groupHost.openGroupById=async()=>false;
    assert.equal(await h.navigate({group:'g'},'Older Group'),false);assert.equal(h.groups[0].chat_id,'Current Group');
    assert.equal(await h.navigate({group:'g'},'missing'),false);assert.deepEqual(h.saves,[]);
});
test('same group and history is a no-op; changing only its history uses native API once',async()=>{
    const h=harness();h.state.groupId='g';
    await h.navigate({group:'g'},'Current Group');assert.deepEqual(h.loads,[]);
    await h.navigate({group:'g'},'Older Group');assert.deepEqual(h.loads,['Older Group']);
});


test('a later home navigation cannot be overwritten by late pointer persistence', async () => {
    const h=harness();h.host.updateRemoteChatName=async()=>{h.state.characterId=null;};
    assert.equal(await h.navigate(h.entity,'Older'),false);assert.deepEqual(h.loads,['Older']);
});

test('a later group navigation wins over a delayed group save', async () => {
    const h=harness();h.groupHost.editGroup=async()=>{h.state.groupId='other';};
    assert.equal(await h.navigate({group:'g'},'Older Group'),false);assert.deepEqual(h.loads,['Older Group']);
});
