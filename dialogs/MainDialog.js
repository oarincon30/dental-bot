// dialogs/MainDialog.js
import { ComponentDialog, WaterfallDialog, TextPrompt } from 'botbuilder-dialogs';
import { recognizeCLU } from '../recognizers/cluRecognizer.js';
import { ScheduleDialog } from './ScheduleDialog.js';
import { CheckDialog } from './CheckDialog.js';
import { CancelDialog } from './CancelDialog.js';

const MAIN = 'MAIN';
const WF = 'WF';
const TEXT = 'TEXT';

export class MainDialog extends ComponentDialog {
  constructor() {
    super(MAIN);

    this.addDialog(new TextPrompt(TEXT));
    this.addDialog(new ScheduleDialog());
    this.addDialog(new CheckDialog());
    this.addDialog(new CancelDialog());

    this.addDialog(new WaterfallDialog(WF, [
      this.routeByIntent.bind(this)
    ]));

    this.initialDialogId = WF;
  }

  async routeByIntent(step) {
    const text = step.context.activity.text || '';
    const clu = await recognizeCLU(text);
    const intent = clu.topIntent;

    // guarda entidades para el siguiente diálogo
    step.values.entities = clu.entities;

    switch (intent) {
      case 'ScheduleAppointment':
        return await step.beginDialog(ScheduleDialog.Id, { entities: clu.entities });

      case 'CheckAppointments':
        return await step.beginDialog(CheckDialog.Id, { entities: clu.entities });

      case 'CancelAppointment':
        return await step.beginDialog(CancelDialog.Id, { entities: clu.entities });

      case 'Greet':
        await step.context.sendActivity('¡Hola! Te ayudo a agendar, consultar o cancelar citas.');
        // ✅ finalizar el diálogo para esperar la siguiente entrada del usuario
        return await step.endDialog();

      case 'Help':
        await step.context.sendActivity('Ejemplos: "Agendar limpieza mañana", "Consultar mis citas", "Cancelar la del viernes".');
        // ✅ finalizar, no reiniciar
        return await step.endDialog();

      default:
        await step.context.sendActivity('No entendí bien. ¿Quieres agendar, consultar o cancelar una cita?');
        // ✅ finalizar, no reiniciar (evita bucles)
        return await step.endDialog();
    }
  }
}