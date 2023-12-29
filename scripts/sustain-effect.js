const moduleID = 'sustain-effect';

const lg = x => console.log(x);


let sustainKey;

Hooks.once('init', () => {
    CONFIG.DND5E.weaponProperties.sustain = 'Sustain';

    const itemProperties = game.settings.get('item-properties', 'itemProperties');
    sustainKey = Object.entries(itemProperties).find(([k, v])=> ['sustain', 'Sustain'].includes(v.name))[0];
});


Hooks.on('dnd5e.useItem', async (item, config, options, templates) => {
    const isSustain = item.system.properties?.sustain || item.getFlag('item-properties', 'itemProperties')?.[sustainKey];
    if (!isSustain) return;

    const variant = options.activationConfig?.variant;
    const toCreate = [];
    for (const effect of item.effects) {
        if (effect.disabled || effect.transfer) continue;
        if (variant && !effect.name.includes(variant)) continue;

        const effectData = effect.toJSON();
        effectData.origin = item.uuid;
        effectData.flags[moduleID] = {
            parentItem: item.uuid
        };
        toCreate.push(effectData);
    }

    if (!toCreate.length) return;

    if (item.getFlag(moduleID, 'sustainActive')) await unsustainItem(item);
    
    const cls = getDocumentClass('ActiveEffect');
    await cls.createDocuments(toCreate, { parent: item.actor });

    return item.setFlag(moduleID, 'sustainActive', true);
});

// Hooks.on('combatTurn', unsustainItems);
// Hooks.on('combatRound', unsustainItems);
Hooks.on('updateCombat', unsustainItems);

async function unsustainItems(combat, diff, options, userID) {
    const { direction } = options;
    if (direction === -1) return;

    const actor = combat.turns[diff.turn].actor;
    if (game.user.isGM && actor.hasPlayerOwner) return;
    if (actor.hasPlayerOwner && !actor.isOwner) return;

    const sustainedItems = actor.items.filter(i => i.getFlag(moduleID, 'sustainActive'));

    if (!sustainedItems.length) return;

    let content = ``;
    for (const item of sustainedItems) {
        const effects = actor.effects.filter(e => e.origin === item.uuid);
        const sustainDuration = effects.reduce((acc, current) => {
            return Math.max(acc, Math.floor(current.duration.remaining));
        }, 0);
        if (sustainDuration < 1) continue;

        content += `
            <label class="flexrow" data-item-uuid="${item.uuid}">
                <img src="${item.img}" />
                ${item.name} | ${sustainDuration} rounds left
                <input type="checkbox" name="${item.uuid}" checked />
            </label>
        `;
    }
    if (!content) return;

    content += `<br>`;

    await Dialog.wait(
        { // data
            title: 'Sustain Effects',
            content,
            buttons: {
                sustain: {
                    label: 'Sustain Selected',
                    callback: async ([html]) => {
                        const checks = html.querySelectorAll('input');
                        let actionCost = 0;
                        for (const check of checks) {
                            const labelParent = check.parentElement;
                            const itemUuid = labelParent.dataset.itemUuid;
                            const item = fromUuidSync(itemUuid);

                            if (check.checked) {
                                actionCost += 1;
                            } else await unsustainItem(item);
                        }

                        if (actionCost) {
                            const newActions = actor.getFlag('action-reaction-count', 'actions.value') - actionCost;
                            await actor.setFlag('action-reaction-count', 'actions.value', newActions);
                        }
                    }
                }
            },
            default: 'sustain'
        },
        { // options
            id: moduleID
        }
    );
}

Hooks.on('deleteActiveEffect', (ae, options, userID) => {
    if (game.user.id !== userID) return;
    
    const actor = ae.parent;
    if (!(actor instanceof Actor)) return;

    const itemUuid = ae.origin;
    const otherEffectsFromItem = actor.effects.filter(e => e.origin === itemUuid);
    if (otherEffectsFromItem.length) return;
    if (ae.duration.remaining === 0) return;

    const item = fromUuidSync(ae.origin);
    if (item) return item.setFlag(moduleID, 'sustainActive', false);
});


async function unsustainItem(item) {
    const { actor } = item;
    const effectsFromItem = actor.effects.filter(e => {
        if (e.flags[moduleID]?.parentItem !== item.uuid) return false;
        if (e.transfer || e.disabled) return false;

        return true;
    });
    const toDelete = effectsFromItem.map(e => e.id);

    await item.setFlag(moduleID, 'sustainActive', false);

    const cls = getDocumentClass('ActiveEffect');
    if (toDelete.length) return cls.deleteDocuments(toDelete, { parent: actor });
}    
