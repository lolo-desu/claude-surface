// Preselect a stored chat before the native selector loads it. The host still
// owns saving/generation guards, character hydration, chat parsing and events.
export function createChatNavigator({ context, host, groups }) {
    const busy = () => host.isChatSaving || host.is_send_press || groups.is_group_generating;
    return async (entity, file) => {
        if (busy()) return false;
        let current = context();
        if (entity.group) {
            const group = current.groups.find(group => group.id === entity.group);
            if (!group || (file && !group.chats?.includes(file))) return false;
            if (current.groupId === entity.group) {
                if (file && current.getCurrentChatId() !== file) await current.openGroupChat(entity.group, file);
                return context().groupId === entity.group;
            }
            const previous = group.chat_id;
            if (file) group.chat_id = file;
            let selected = false;
            try {
                await groups.openGroupById(entity.group);
                selected = context().groupId === entity.group;
            } finally {
                if (!selected && file && group.chat_id === file) group.chat_id = previous;
            }
            if (selected && file && previous !== file) {
                group.date_last_chat = Date.now();
                await groups.editGroup(entity.group, true, false);
            }
            return selected && context().groupId === entity.group;
        }
        const matches = () => !context().groupId && String(context().characterId) === String(entity.id);
        if (matches()) {
            if (file && current.getCurrentChatId() !== file) await current.openCharacterChat(file);
            return matches();
        }
        // Shallow hydration can replace the character object and its chat field.
        if (file) await current.unshallowCharacter?.(entity.id);
        if (busy()) return false;
        current = context();
        const character = current.characters[entity.id];
        if (!character || character.avatar !== entity.avatar) return false;
        const previous = character.chat;
        const preselect = file && typeof host.updateRemoteChatName === 'function';
        if (preselect) character.chat = file;
        let selected = false;
        try {
            await current.selectCharacterById(entity.id, { switchMenu: false });
            selected = matches();
        } finally {
            const latest = context().characters[entity.id];
            if (!selected && preselect && latest?.avatar === entity.avatar && latest.chat === file) latest.chat = previous;
        }
        if (selected && file && context().getCurrentChatId() !== file) {
            await context().openCharacterChat(file);
            return matches();
        }
        // Persist only the chat pointer, without another load or a full card edit.
        if (selected && preselect && previous !== file) await host.updateRemoteChatName(entity.id, file);
        return selected && matches();
    };
}
