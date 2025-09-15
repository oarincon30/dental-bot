// dialogs/ScheduleDialog.js
import { ComponentDialog, WaterfallDialog, TextPrompt, ChoicePrompt, ChoiceFactory } from 'botbuilder-dialogs';
import { api } from '../services/api.js';
import { recognizeDateTimeES, normalizeService } from '../utils/datetime.js';

const ID = 'SCHEDULE';
const WF = 'SCHEDULE_WF';
const TEXT = 'TEXT_S';
const CHOICE = 'CHOICE_S';

export class ScheduleDialog extends ComponentDialog {
  static Id = ID;

  constructor() {
    super(ID);
    this.addDialog(new TextPrompt(TEXT));
    this.addDialog(new ChoicePrompt(CHOICE));
    this.addDialog(new WaterfallDialog(WF, [
      this.init.bind(this),
      this.askService.bind(this),
      this.askDateTime.bind(this),
      this.fetchAvailability.bind(this),
      this.confirmSlot.bind(this),
      this.createAppointment.bind(this)
    ]));
    this.initialDialogId = WF;
  }

  async init(step) {
    const e = step.options.entities || [];
    step.values.data = {
      phone: this.getPhoneFromChannel(step),
      service: this.pickText(e, 'service'),
      datePhrase: this.pickText(e, 'date'),
      timePhrase: this.pickText(e, 'timeRange'),
      branch: this.pickText(e, 'branch') || 'Galerías'
    };
    return await step.next();
  }

  async askService(step) {
    if (!step.values.data.service) {
      return await step.prompt(TEXT, '¿Para qué servicio? (limpieza, valoración, endodoncia, ortodoncia, urgencias)');
    }
    return await step.next(step.values.data.service);
  }

  async askDateTime(step) {
    step.values.data.service = normalizeService(step.values.data.service || step.result);
    if (!step.values.data.datePhrase && !step.values.data.timePhrase) {
      return await step.prompt(TEXT, '¿Para cuándo? (ej: "viernes después de las 2", "mañana en la tarde")');
    }
    return await step.next(`${step.values.data.datePhrase || ''} ${step.values.data.timePhrase || ''}`.trim());
  }

  async fetchAvailability(step) {
    const phrase = step.result || '';
    const pref = recognizeDateTimeES(phrase); // { fromISO, toISO }
    const params = {
      service: step.values.data.service,
      from: pref?.fromISO || null,
      to:   pref?.toISO   || null,
      branch: step.values.data.branch
    };

    let slots = [];
    try {
      slots = await api.getAvailability(params);
    } catch {
      await step.context.sendActivity('No pude consultar disponibilidad ahora. Inténtalo de nuevo.');
      return await step.endDialog();
    }

    if (!slots?.length) {
      await step.context.sendActivity('No hay disponibilidad en ese rango. Dime otra fecha u horario.');
      return await step.replaceDialog(this.id, { entities: [] });
    }

    step.values.data.slots = slots.slice(0, 3);
    const choices = step.values.data.slots.map((s, i) => ({
      value: String(i + 1),
      action: { title: `${i + 1}) ${s.start} — ${s.end}` }
    }));
    return await step.prompt(CHOICE, { prompt: 'Tengo estas opciones:', choices: ChoiceFactory.toChoices(choices) });
  }

  async confirmSlot(step) {
    const idx = parseInt(step.result?.value || step.result, 10) - 1;
    step.values.data.chosen = step.values.data.slots[idx];
    // en WhatsApp ya tenemos el teléfono del canal; si no, lo pedimos
    if (!step.values.data.phone) {
      return await step.prompt(TEXT, '¿Me compartes tu teléfono (10 dígitos)?');
    }
    return await step.next(step.values.data.phone);
  }

  async createAppointment(step) {
    step.values.data.phone = step.values.data.phone || (step.result || '').replace(/\D/g, '').slice(-10);

    const body = {
      patient: { phone: step.values.data.phone },
      service: step.values.data.service,
      start: step.values.data.chosen.start,
      channel: 'whatsapp',
      branch: step.values.data.branch
    };

    try {
      const created = await api.createAppointment(body);
      const when = created.summary?.start || body.start;
      await step.context.sendActivity(`✅ Cita creada: **${created.appointmentId}** para ${when}. ¡Te esperamos!`);
    } catch {
      await step.context.sendActivity('Lo siento, no pude crear la cita. Inténtalo de nuevo.');
    }
    return await step.endDialog();
  }

  pickText(entities, category) {
    const hit = entities.find(e => (e.category || '').toLowerCase() === category.toLowerCase());
    return hit?.text || null;
  }

  getPhoneFromChannel(step) {
    // Ej.: Twilio manda "whatsapp:+57XXXXXXXXXX" en from.id. En Emulator no viene.
    const raw = step?.context?.activity?.from?.id || '';
    const phone = raw.replace(/\D/g, '').slice(-10);
    return phone?.length === 10 ? phone : null;
  }
}