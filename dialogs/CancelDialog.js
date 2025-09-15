// dialogs/CancelDialog.js
import { ComponentDialog, WaterfallDialog, TextPrompt } from 'botbuilder-dialogs';
import { api } from '../services/api.js';

const ID = 'CANCEL';
const WF = 'CANCEL_WF';
const TEXT = 'TEXT_X';

export class CancelDialog extends ComponentDialog {
  static Id = ID;
  constructor() {
    super(ID);
    this.addDialog(new TextPrompt(TEXT));
    this.addDialog(new WaterfallDialog(WF, [
      this.ask.bind(this),
      this.cancel.bind(this)
    ]));
    this.initialDialogId = WF;
  }

  async ask(step) {
    return await step.prompt(TEXT, 'Dime el **ID de la cita** a cancelar (ej: A-1001).');
  }

  async cancel(step) {
    const id = (step.result || '').trim();
    try {
      await api.cancelAppointment(id);
      await step.context.sendActivity(`✅ Cita **${id}** cancelada.`);
    } catch {
      await step.context.sendActivity('No pude cancelar. Verifica el ID y vuelve a intentar.');
    }
    return await step.endDialog();
  }
}