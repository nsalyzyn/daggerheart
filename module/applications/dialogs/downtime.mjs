import { refreshIsAllowed } from '../../helpers/utils.mjs';

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export default class DhpDowntime extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(actor, shortrest) {
        super({});

        this.actor = actor;
        this.shortrest = shortrest;

        this.moveData = foundry.utils.deepClone(
            game.settings.get(CONFIG.DH.id, CONFIG.DH.SETTINGS.gameSettings.Homebrew).restMoves
        );
        this.selectedMoves = [];
        this.nrChoices = {
            shortRest: {
                taken: 0,
                max:
                    (shortrest ? this.moveData.shortRest.nrChoices : 0) +
                    actor.system.bonuses.rest[`${shortrest ? 'short' : 'long'}Rest`].shortMoves
            },
            longRest: {
                taken: 0,
                max:
                    (!shortrest ? this.moveData.longRest.nrChoices : 0) +
                    actor.system.bonuses.rest[`${shortrest ? 'short' : 'long'}Rest`].longMoves
            }
        };

        this.refreshables = this.getRefreshables();
    }

    get title() {
        return '';
    }

    static DEFAULT_OPTIONS = {
        tag: 'form',
        classes: ['daggerheart', 'views', 'dh-style', 'dialog', 'downtime'],
        position: { width: 'auto', height: 'auto' },
        actions: {
            selectMove: this.selectMove,
            removeMove: this.removeMove,
            takeDowntime: this.takeDowntime
        },
        form: { handler: this.updateData, submitOnChange: true, closeOnSubmit: false }
    };

    static PARTS = {
        application: {
            id: 'downtime',
            template: 'systems/daggerheart/templates/dialogs/downtime/downtime.hbs'
        }
    };

    async _prepareContext(_options) {
        const context = await super._prepareContext(_options);
        context.title = game.i18n.localize(
            `DAGGERHEART.APPLICATIONS.Downtime.${this.shortrest ? 'shortRest' : 'longRest'}.title`
        );
        context.selectedActivity = this.selectedActivity;
        context.moveData = this.moveData;

        const shortRestMovesSelected = this.nrSelectedMoves('shortRest');
        const longRestMovesSelected = this.nrSelectedMoves('longRest');
        context.nrChoices = {
            ...this.nrChoices,
            shortRest: {
                ...this.nrChoices.shortRest,
                current: this.nrChoices.shortRest.taken + shortRestMovesSelected
            },
            longRest: {
                ...this.nrChoices.longRest,
                current: this.nrChoices.longRest.taken + longRestMovesSelected
            }
        };

        context.shortRestMoves = this.nrChoices.shortRest.max > 0 ? this.moveData.shortRest : null;
        context.longRestMoves = this.nrChoices.longRest.max > 0 ? this.moveData.longRest : null;

        context.refreshables = this.refreshables;

        context.disabledDowntime = shortRestMovesSelected === 0 && longRestMovesSelected === 0;

        context.selectedMoves = this.selectedMoves;
        context.selfId = this.actor.uuid;
        context.characters = game.actors.filter(x => x.type === 'character').filter(x => x.uuid !== this.actor.uuid);

        return context;
    }

    getRefreshables() {
        const actionItems = this.actor.items.filter(x => this.actor.system.isItemAvailable(x)).reduce((acc, x) => {
            if (x.system.actions) {
                const recoverable = x.system.actions.reduce((acc, action) => {
                    if (refreshIsAllowed([this.shortrest ? 'shortRest' : 'longRest'], action.uses.recovery)) {
                        acc.push({
                            title: x.name,
                            name: action.name,
                            uuid: action.uuid
                        });
                    }

                    return acc;
                }, []);

                if (recoverable) {
                    acc.push(...recoverable);
                }
            }

            return acc;
        }, []);
        const resourceItems = this.actor.items.reduce((acc, x) => {
            if (
                x.system.resource &&
                x.system.resource.type &&
                refreshIsAllowed([this.shortrest ? 'shortRest' : 'longRest'], x.system.resource.recovery)
            ) {
                acc.push({
                    title: game.i18n.localize(`TYPES.Item.${x.type}`),
                    name: x.name,
                    uuid: x.uuid
                });
            }

            return acc;
        }, []);
        return {
            actionItems,
            resourceItems
        };
    }

    static selectMove(_, target) {
        const { category, move } = target.dataset;

        const nrSelected = this.nrSelectedMoves(category);

        if (nrSelected + this.nrChoices[category].taken >= this.nrChoices[category].max) {
            ui.notifications.error(game.i18n.localize('DAGGERHEART.UI.Notifications.noMoreMoves'));
            return;
        }

        const selectedMove = this.moveData[category].moves[move];
        selectedMove.category = category;
        selectedMove.movePath = `${category}.moves.${move}`
        selectedMove.hasTarget = selectedMove.actions.filter(x => x.target.type).length > 0;
        selectedMove.selfTargeted = selectedMove.actions.filter(x => x.target.type === 'self').length > 0;
        if (selectedMove.hasTarget) {
            selectedMove.targetUuid = this.actor.uuid;
        }

        this.selectedMoves.push(selectedMove);

        this.render();
    }

    static removeMove(_, target) {
        const { moveIndex } = target.dataset;

        this.selectedMoves.splice(moveIndex, 1);
        this.render();
    }

    static async takeDowntime() {
        const moves = this.selectedMoves;

        const cls = getDocumentClass('ChatMessage');
        const msg = {
            user: game.user.id,
            system: {
                moves: moves,
                actor: this.actor.uuid
            },
            speaker: cls.getSpeaker(),
            title: game.i18n.localize(
                `DAGGERHEART.APPLICATIONS.Downtime.${this.shortrest ? 'shortRest' : 'longRest'}.title`
            ),
            content: await foundry.applications.handlebars.renderTemplate(
                'systems/daggerheart/templates/ui/chat/downtime.hbs',
                {
                    title: game.i18n.localize(
                        `DAGGERHEART.APPLICATIONS.Downtime.${this.shortrest ? 'shortRest' : 'longRest'}.title`
                    ),
                    actor: { name: this.actor.name, img: this.actor.img },
                    moves: moves
                }
            ),
            flags: {
                daggerheart: {
                    cssClass: 'dh-chat-message dh-style'
                }
            }
        };

        cls.create(msg);

        // Reset selection and update number of taken moves
        for (const selectedMove of this.selectedMoves) {
            this.nrChoices[selectedMove.category].taken += 1;
        }
        this.selectedMoves = [];

        // We can close the window and refresh resources when all moves are taken
        if (
            this.nrChoices.shortRest.taken >= this.nrChoices.shortRest.max &&
            this.nrChoices.longRest.taken >= this.nrChoices.longRest.max
        ) {
            for (var data of this.refreshables.actionItems) {
                const action = await foundry.utils.fromUuid(data.uuid);
                await action.parent.parent.update({ [`system.actions.${action.id}.uses.value`]: 0 });
            }

            for (var data of this.refreshables.resourceItems) {
                const feature = await foundry.utils.fromUuid(data.uuid);
                const increasing =
                    feature.system.resource.progression === CONFIG.DH.ITEM.itemResourceProgression.increasing.id;
                const resetValue = increasing
                    ? 0
                    : feature.system.resource.max
                      ? Roll.replaceFormulaData(feature.system.resource.max, this.actor)
                      : 0;
                await feature.update({ 'system.resource.value': resetValue });
            }

            this.close();
        } else {
            this.render();
        }
    }

    static async updateData(event, target, formData) {
        for (const name in formData.object) {
            if (name.startsWith('downtime-move-')) {
                const index = parseInt(name.substring(14));
                this.selectedMoves[index].targetUuid = formData.object[name];
            }
        }
        this.render();
    }

    nrSelectedMoves(category) {
        return this.selectedMoves.filter(x => x.category === category).length;
    }
}
