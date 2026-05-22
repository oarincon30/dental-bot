import { ComponentDialog, WaterfallDialog, TextPrompt } from 'botbuilder-dialogs';
import { DateTime } from 'luxon';
import { javaApi } from '../services/javaApi.js';
import { getWhatsappFromStep } from '../utils/whatsapp.js';
import { parseNaturalDateTime, toISO, clampToSlots, isWithinWorkingHours, isMultipleOf30 } from '../utils/datetime.js';
import { pick } from '../utils/clu.js';
import { recognizeCLU } from '../recognizers/cluRecognizer.js';
import { extractDentistHint, isAffirmative, isNegative, maybeExitFlow, normalizeLoose, normalizePersonName } from '../utils/text.js';

const ID = 'APPT_RESCHEDULE';
const WF = 'WF';
const TEXT = 'TEXT';
const TZ = process.env.TZ || 'America/Bogota';

function yesNo(value) {
  const t = (value || '').toString().trim().toLowerCase();
  if (/^(si|sí|s|yes|ok|dale|confirmo|confirmar|correcto|de acuerdo|claro)$/.test(t)) return true;
  if (/^(no|n|negativo)$/.test(t)) return false;
  return null;
}

function formatAppointment(item, index) {
  const when = DateTime.fromISO(item.startAt).setZone(TZ).setLocale('es').toFormat("cccc d 'de' LLLL 'de' yyyy, HH:mm");
  return `${index + 1}. ${when} — ${item.dentistName || 'sin profesional específico'} — ${item.status}`;
}

function detail(item) {
  const start = DateTime.fromISO(item.startAt).setZone(TZ).setLocale('es').toFormat("cccc d 'de' LLLL 'de' yyyy, HH:mm");
  const end = DateTime.fromISO(item.endAt).setZone(TZ).setLocale('es').toFormat('HH:mm');
  return [
    `• ID: ${item.id}`,
    `• Fecha actual: ${start} - ${end}`,
    `• Profesional: ${item.dentistName || 'sin profesional específico'}`,
    `• Estado: ${item.status}`
  ].join('\n');
}

function formatLocal(iso) {
  return DateTime.fromISO(iso).setZone(TZ).setLocale('es').toFormat("cccc d 'de' LLLL 'de' yyyy, HH:mm");
}

function matchDentistHint(appointment, hint) {
  const normalized = normalizePersonName(hint);
  if (!normalized) return false;
  const dentistName = normalizePersonName(appointment.dentistName || '');
  const first = dentistName.split(' ')[0] || '';
  return dentistName.length > 0 && (dentistName.includes(normalized) || normalized.includes(dentistName) || (first.length >= 3 && normalized.includes(first)));
}

export class ApptRescheduleDialog extends ComponentDialog {
  static Id = ID;

  constructor() {
    super(ID);
    this.addDialog(new TextPrompt(TEXT));
    this.addDialog(new WaterfallDialog(WF, [
      this.resolvePatient.bind(this),
      this.selectAppointment.bind(this),
      this.ensureNewDatetime.bind(this),
      this.confirmReschedule.bind(this),
      this.reschedule.bind(this)
    ]));
    this.initialDialogId = WF;
  }

  async resolvePatient(step) {
    const carried = step.options?.state || {};
    if (carried.patient) {
      step.values.patient = carried.patient;
      step.values.selectedAppointment = carried.selectedAppointment || null;
      return await step.next();
    }

    const whatsappPhone = getWhatsappFromStep(step);
    if (!whatsappPhone) {
      await step.context.sendActivity('No pude leer tu número de WhatsApp para identificarte.');
      return await step.endDialog();
    }

    try {
      step.values.patient = await javaApi.getPatientByWhatsapp(whatsappPhone);
      return await step.next();
    } catch (e) {
      if (e?.response?.status === 404) {
        await step.context.sendActivity('No encontré tu registro con este número de WhatsApp.');
      } else {
        await step.context.sendActivity('No pude consultar tu registro en este momento.');
      }
      return await step.endDialog();
    }
  }

  async selectAppointment(step) {
    if (step.values.selectedAppointment) return await step.next();

    const appointments = await javaApi.getActiveFutureAppointmentsByPatient(step.values.patient.id);
    if (!appointments?.length) {
      await step.context.sendActivity('No tienes citas activas futuras para reprogramar.');
      return await step.endDialog();
    }

    const entities = step.options?.clu?.entities || [];
    const rawHint = pick(entities, 'dentistName') || extractDentistHint(step.options?.rawText);
    const hinted = rawHint ? appointments.filter((item) => matchDentistHint(item, rawHint)) : [];

    step.values.appointments = appointments;
    if (hinted.length === 1) {
      step.values.selectedAppointment = hinted[0];
      return await step.next();
    }

    if (appointments.length === 1) {
      step.values.selectedAppointment = appointments[0];
      return await step.next();
    }

    const intro = rawHint && hinted.length === 0
      ? `No encontré una cita activa con "${rawHint}". Estas son tus citas activas futuras:`
      : 'Estas son tus citas activas futuras:';
    await step.context.sendActivity(`${intro}\n${appointments.map(formatAppointment).join('\n')}`);
    return await step.prompt(TEXT, 'Responde con el número de la cita que deseas reprogramar.');
  }

  async ensureNewDatetime(step) {
    if (!step.values.selectedAppointment) {
      const appointments = step.values.appointments || [];
      const raw = (step.result || '').toString().trim();
      if (maybeExitFlow(raw)) {
        await step.context.sendActivity('Entendido. Cancelé la operación actual.');
        return await step.endDialog();
      }
      const index = Number(raw);
      if (!Number.isInteger(index) || index < 1 || index > appointments.length) {
        await step.context.sendActivity('No pude identificar esa opción.');
        return await step.endDialog();
      }
      step.values.selectedAppointment = appointments[index - 1];
    }

    const currentStart = DateTime.fromISO(step.values.selectedAppointment.startAt).setZone(TZ);
    const entities = step.options?.clu?.entities || [];
    const dtText = step.options?.rawText || pick(entities, 'datetime');
    const parsed = this.parseAndValidateDateTime(dtText, currentStart);
    if (parsed.ok) {
      step.values.newStartAt = parsed.startAt;
      step.values.newEndAt = parsed.endAt;
      return await step.next();
    }

    await step.context.sendActivity(`Vas a reprogramar esta cita:\n${detail(step.values.selectedAppointment)}`);
    return await step.prompt(TEXT, '¿Para qué fecha y hora quieres moverla? Ejemplos: "viernes misma hora", "viernes 10:00" o "2026-05-08 14:00".');
  }

  async confirmReschedule(step) {
    if (!step.values.newStartAt || !step.values.newEndAt) {
      if (maybeExitFlow(step.result)) {
        await step.context.sendActivity('Entendido. Cancelé la operación actual.');
        return await step.endDialog();
      }

      const cluTurn = await this.recognizeDateTurn(step, step.result);
      const dtText = pick(cluTurn.entities, 'datetime') || step.result;
      const currentStart = DateTime.fromISO(step.values.selectedAppointment.startAt).setZone(TZ);
      const parsed = this.parseAndValidateDateTime(dtText, currentStart);
      if (!parsed.ok) {
        await step.context.sendActivity(parsed.message);
        return await step.replaceDialog(ID, {
          rawText: step.result || '',
          clu: cluTurn,
          state: { patient: step.values.patient, selectedAppointment: step.values.selectedAppointment }
        });
      }
      step.values.newStartAt = parsed.startAt;
      step.values.newEndAt = parsed.endAt;
    }

    const summary = [
      'Voy a reprogramar esta cita:',
      detail(step.values.selectedAppointment),
      `• Nueva fecha: ${formatLocal(step.values.newStartAt)}`
    ].join('\n');
    await step.context.sendActivity(summary);
    return await step.prompt(TEXT, '¿Confirmas la reprogramación? (sí/no)');
  }

  async reschedule(step) {
    const answer = yesNo(step.result);
    if (answer !== true || isNegative(step.result)) {
      await step.context.sendActivity('Entendido. La cita no fue reprogramada.');
      return await step.endDialog();
    }
    if (!isAffirmative(step.result)) {
      await step.context.sendActivity('No confirmé la reprogramación. La cita queda igual.');
      return await step.endDialog();
    }

    try {
      const selected = step.values.selectedAppointment;
      const payload = {
        patientId: step.values.patient.id,
        startAt: step.values.newStartAt,
        endAt: step.values.newEndAt,
        reason: 'Reprogramado desde WhatsApp'
      };
      if (selected.dentistId != null) payload.dentistId = selected.dentistId;

      const updated = await javaApi.rescheduleAppointment(selected.id, payload);
      await step.context.sendActivity([
        '✅ Cita reprogramada con éxito.',
        `• ID: ${updated.id}`,
        `• Nueva fecha: ${formatLocal(updated.startAt)}`,
        `• Profesional: ${updated.dentistName || selected.dentistName || 'sin profesional específico'}`
      ].join('\n'));
    } catch (e) {
      if (e?.response?.status === 409) {
        await step.context.sendActivity('Ese horario se cruza con otra cita activa. Intenta con otra fecha u hora.');
      } else if (e?.response?.status === 400) {
        const msg = e?.response?.data?.message || e?.response?.data?.error || '';
        await step.context.sendActivity(msg ? `No pude reprogramar la cita: ${msg}` : 'No pude reprogramar la cita por una validación del backend.');
      } else {
        await step.context.sendActivity('No pude reprogramar la cita en este momento.');
      }
    }
    return await step.endDialog();
  }

  extractTargetDateText(text) {
    const raw = (text || '').toString();
    const normalized = raw.replace(/\s+/g, ' ').trim();
    const matches = Array.from(normalized.matchAll(/\b(?:para|al)\s+(?:el\s+|la\s+)?([^.,;?!]+)/gi));
    if (matches.length) return matches[matches.length - 1][1].trim();
    return normalized;
  }

  parseAndValidateDateTime(text, defaultTime) {
    const targetText = this.extractTargetDateText(text);
    const parsed = parseNaturalDateTime(targetText, DateTime.now().setZone(TZ), defaultTime);
    if (!parsed || !parsed.isValid) {
      return { ok: false, message: 'No entendí la nueva fecha y hora. Puedes decir "viernes misma hora", "viernes 10:00" o "2026-05-08 14:00".' };
    }

    const startLocal = clampToSlots(parsed);
    const endLocal = startLocal.plus({ minutes: 30 });
    if (!isMultipleOf30(startLocal, endLocal) || !isWithinWorkingHours(startLocal, endLocal)) {
      return { ok: false, message: 'La cita debe quedar en bloques de 30 minutos y dentro del horario de atención (7:00–11:00 y 13:00–17:00).' };
    }

    return { ok: true, startAt: toISO(startLocal), endAt: toISO(endLocal) };
  }

  async recognizeDateTurn(step, userText) {
    if (process.env.USE_CLU !== '1' || !userText) {
      return { entities: [], topIntent: null, topScore: 0 };
    }
    try {
      const dentistName = step.values.selectedAppointment?.dentistName || 'doctor';
      return await recognizeCLU(`Quiero reprogramar mi cita con ${dentistName} para ${userText}`, step.context);
    } catch {
      return { entities: [], topIntent: null, topScore: 0 };
    }
  }
}
