// dialogs/CheckDialog.js
import { ComponentDialog, WaterfallDialog, TextPrompt } from 'botbuilder-dialogs';
import { api } from '../services/api.js';

const ID = 'CHECK';
const WF = 'CHECK_WF';
const TEXT = 'TEXT_C';

export class CheckDialog extends ComponentDialog {
  static Id = ID;
  constructor() {
    super(ID);
    this.addDialog(new TextPrompt(TEXT));
    this.addDialog(new WaterfallDialog(WF, [
      this.getPhone.bind(this),
      this.list.bind(this)
    ]));
    this.initialDialogId = WF;
  }

  async getPhone(step) {
    const fromChannel = (step?.context?.activity?.from?.id || '').replace(/\D/g,'').slice(-10);
    if (fromChannel?.length === 10) return await step.next(fromChannel);
    return await step.prompt(TEXT, '¿Cuál es tu teléfono (10 dígitos)?');
  }

  async list(step) {
    const phone = (step.result || '').replace(/\D/g,'').slice(-10);
    try {
      const items = await api.getAppointments(phone);
      if (!items?.length) {
        await step.context.sendActivity('No encontré citas próximas.');
      } else {
        const lines = items.map(a => `• ${a.appointmentId} — ${a.start} (${a.service})`).join('\n');
        await step.context.sendActivity(`Estas son tus próximas citas:\n${lines}`);
      }
    } catch {
      await step.context.sendActivity('No pude consultar tus citas ahora.');
    }
    return await step.endDialog();
  }
}