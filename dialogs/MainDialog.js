import { ComponentDialog, WaterfallDialog } from 'botbuilder-dialogs';
import { ApptCreateDialog } from './ApptCreateDialog.js';
import { ApptListDialog } from './ApptListDialog.js';
import { ApptCancelDialog } from './ApptCancelDialog.js';
import { ApptRescheduleDialog } from './ApptRescheduleDialog.js';
import { recognizeCLU } from '../recognizers/cluRecognizer.js';
import { isGreetingOnly, isHelp, normalizeLoose } from '../utils/text.js';

const ID = 'MAIN';
const WF = 'WF';

function confidenceBand(score) {
  if (score >= Number(process.env.CLU_EXECUTE_THRESHOLD || 0.72)) return 'high';
  if (score >= Number(process.env.CLU_CLARIFY_THRESHOLD || 0.45)) return 'medium';
  return 'low';
}

function parseMainMenuOption(text) {
  const t = normalizeLoose(text)
    .replace(/[.,;:]+$/g, '')
    .replace(/^(opcion|opciones|op)\s+/i, '')
    .trim();

  if (/^(1|uno|agendar|agendar cita|agendar una cita|crear cita|reservar cita)$/.test(t)) return 'APPT_CREATE';
  if (/^(2|dos|consultar|consultar citas|consultar mis citas|mis citas|ver citas|ver mis citas|listar citas)$/.test(t)) return 'APPT_LIST';
  if (/^(3|tres|cancelar|cancelar cita|cancelar una cita|anular cita)$/.test(t)) return 'APPT_CANCEL';
  if (/^(4|cuatro|reprogramar|reprogramar cita|reprogramar una cita|reagendar|mover cita|cambiar cita)$/.test(t)) return 'APPT_RESCHEDULE';
  return null;
}

export class MainDialog extends ComponentDialog {
  constructor() {
    super(ID);
    this.addDialog(new ApptCreateDialog());
    this.addDialog(new ApptListDialog());
    this.addDialog(new ApptCancelDialog());
    this.addDialog(new ApptRescheduleDialog());
    this.addDialog(new WaterfallDialog(WF, [this.route.bind(this)]));
    this.initialDialogId = WF;
  }

  async route(step) {
    const textRaw = (step.context.activity.text || '').trim();
    const text = normalizeLoose(textRaw);

    if (!textRaw) {
      await this.sendHelp(step);
      return await step.endDialog();
    }

    if (isGreetingOnly(text)) {
      await step.context.sendActivity('Hola. Puedo ayudarte a agendar, consultar, cancelar o reprogramar citas. También puedes escribirlo directamente.');
      return await step.endDialog();
    }

    if (isHelp(text)) {
      await this.sendHelp(step);
      return await step.endDialog();
    }

    // Las opciones exactas del menú principal no deben enviarse al CLU.
    // Son comandos de navegación de la interfaz, no lenguaje natural del usuario.
    const menuDialogId = parseMainMenuOption(textRaw);
    if (menuDialogId) {
      return await step.beginDialog(menuDialogId, { rawText: textRaw, source: 'main-menu' });
    }

    // Si CLU está activo, primero enviamos la frase al modelo.
    // Las reglas directas quedan como fallback cuando CLU está desactivado o no responde.
    if (process.env.USE_CLU === '1') {
      let clu = null;
      try {
        clu = await recognizeCLU(textRaw, step.context);
      } catch (error) {
        console.error('[MainDialog] CLU route error', error?.message || error);
      }

      const intent = clu?.topIntent || null;
      const topScore = Number(clu?.topScore || 0);
      const band = confidenceBand(topScore);
      const opts = {
        rawText: textRaw,
        clu: {
          entities: clu?.entities || [],
          topIntent: intent,
          topScore
        }
      };

      if (intent === 'ScheduleAppointment' && band !== 'low') {
        return await step.beginDialog('APPT_CREATE', opts);
      }
      if (intent === 'ListAppointments' && band !== 'low') {
        return await step.beginDialog('APPT_LIST', opts);
      }
      if (intent === 'CancelAppointment' && band !== 'low') {
        return await step.beginDialog('APPT_CANCEL', opts);
      }
      if (intent === 'RescheduleAppointment' && band !== 'low') {
        return await step.beginDialog('APPT_RESCHEDULE', opts);
      }

      // Solo usamos reglas cuando CLU no pudo responder por configuración/error.
      // Si CLU respondió None o baja confianza, es mejor pedir reformulación para no contradecir al modelo.
      if (!intent) {
        const directFallback = await this.tryDirectRoute(step, text);
        if (directFallback) return directFallback;
      }

      await step.context.sendActivity('No entendí del todo. Puedo ayudarte a agendar, consultar, cancelar o reprogramar citas. Por ejemplo: "quiero una cita con doctor Miguel mañana 9:00" o "mueve mi cita para el viernes misma hora".');
      return await step.endDialog();
    }

    const direct = await this.tryDirectRoute(step, text);
    if (direct) return direct;

    await step.context.sendActivity('No entendí del todo. Puedo ayudarte a agendar, consultar, cancelar o reprogramar citas. Por ejemplo: "quiero una cita con doctor Miguel mañana 9:00" o "mueve mi cita para el viernes misma hora".');
    return await step.endDialog();
  }

  async tryDirectRoute(step, text) {
    if (/^(4|reprogramar|reagendar|mover|cambiar|aplazar|posponer)/.test(text) || /\b(reprogramar|reagendar|mover|cambiar|aplazar|posponer|pasar la cita|cambiar la cita)\b/.test(text)) {
      return await step.beginDialog('APPT_RESCHEDULE', { rawText: step.context.activity.text || '' });
    }
    if (/\b(no puedo ir|no podre ir|no podré ir|no alcanzo|no puedo asistir)\b/.test(text) && /\b(para|viernes|lunes|martes|miercoles|miércoles|jueves|sabado|sábado|domingo|misma hora|\d{1,2}(:\d{2})?\s*(am|pm)?)\b/.test(text)) {
      return await step.beginDialog('APPT_RESCHEDULE', { rawText: step.context.activity.text || '' });
    }
    if (/^(3|cancelar|anular|quiero cancelar|cancelar una cita)/.test(text) || /\b(cancelar|anular|no puedo ir|no puedo asistir)\b/.test(text)) {
      return await step.beginDialog('APPT_CANCEL', { rawText: step.context.activity.text || '' });
    }
    if (/^(2|mis citas|consultar|listar|ver mis citas|tengo cita|tengo citas|mostrar citas|proximas citas|próximas citas|citas pendientes)/.test(text)
        || /\b(que citas tengo|qué citas tengo|consultar mis citas|ver mis citas|mis proximas citas|mis próximas citas|citas pendientes|tengo cita|tengo una cita)\b/.test(text)) {
      return await step.beginDialog('APPT_LIST', { rawText: step.context.activity.text || '' });
    }
    if (/^(1|agendar|crear|reservar|programar|sacar cita|quiero una cita|necesito una cita|una cita|quiero un control|quiero una revision|quiero una revisión|control con|cita con)/.test(text)
        || /\b(agendar|reservar|programar|cita|control|revision|revisión|chequeo|limpieza|higiene oral|profilaxis|ortodoncia|endodoncia|odontopediatria|periodoncia|odontologia general)\b/.test(text)) {
      return await step.beginDialog('APPT_CREATE', { rawText: step.context.activity.text || '' });
    }
    return null;
  }

  async sendHelp(step) {
    await step.context.sendActivity([
      'Puedo ayudarte con estas opciones:',
      '1. Agendar cita',
      '2. Consultar mis citas',
      '3. Cancelar una cita',
      '4. Reprogramar una cita',
      '',
      'Puedes responder con el número de la opción, por ejemplo: 1, 2, 3 o 4.',
      '',
      'También puedes escribir algo como: "quiero una cita con doctor Miguel mañana 9:00" o "necesito mover la cita con Juan para el viernes misma hora".'
    ].join('\n'));
  }
}
