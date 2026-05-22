import { ComponentDialog, WaterfallDialog, TextPrompt } from 'botbuilder-dialogs';
import { DateTime } from 'luxon';
import { javaApi } from '../services/javaApi.js';
import { pick } from '../utils/clu.js';
import { parseNaturalDateTime } from '../utils/datetime.js';
import { extractDentistHint, maybeExitFlow, normalizePersonName } from '../utils/text.js';
import { getWhatsappFromStep } from '../utils/whatsapp.js';

const ID = 'APPT_CANCEL';
const WF = 'WF';
const TEXT = 'TEXT';
const TZ = process.env.TZ || 'America/Bogota';

function yesNo(value) {
  const t = (value || '').toString().trim().toLowerCase();
  if (/^(si|sí|s|yes|ok|dale|confirmo|confirmar|correcto|de acuerdo|claro)$/.test(t)) return true;
  if (/^(no|n|negativo)$/.test(t)) return false;
  return null;
}

function formatLocal(iso) {
  return DateTime.fromISO(iso).setZone(TZ).setLocale('es').toFormat("cccc d 'de' LLLL 'de' yyyy, HH:mm");
}

function formatAppointment(item, index) {
  return `${index + 1}. ${formatLocal(item.startAt)} — ${item.dentistName || 'sin profesional específico'} — ${item.status}`;
}

function detail(item) {
  return [
    `• ID: ${item.id}`,
    `• Fecha: ${formatLocal(item.startAt)}`,
    `• Profesional: ${item.dentistName || 'sin profesional específico'}`,
    `• Estado: ${item.status}`
  ].join('\n');
}

function matchDentistHint(appointment, hint) {
  const normalized = normalizePersonName(hint);
  if (!normalized) return true;
  const dentistName = normalizePersonName(appointment.dentistName || '');
  const first = dentistName.split(' ')[0] || '';
  return dentistName.length > 0
    && (dentistName.includes(normalized) || normalized.includes(dentistName) || (first.length >= 3 && normalized.includes(first)));
}

function candidateDateText(rawText) {
  const raw = (rawText || '').toString().replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const matches = Array.from(raw.matchAll(/\b(?:de|del|para|el|la)\s+([^.,;?!]+)/gi));
  if (matches.length) return matches[matches.length - 1][1].trim();
  return raw;
}

function parseDateHint(rawText) {
  const text = candidateDateText(rawText);
  if (!text) return null;

  const hasTime = /\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*(?:am|pm)\b|\ba\s+las\s+\d{1,2}\b|\b\d{1,2}\s+de\s+la\s+(?:mañana|manana|tarde|noche)\b/i.test(text);
  const textWithTime = hasTime ? text : `${text} 9:00`;
  const parsed = parseNaturalDateTime(textWithTime, DateTime.now().setZone(TZ));
  return parsed?.isValid ? parsed.toISODate() : null;
}

function matchDateHint(appointment, rawHint) {
  const dateHint = parseDateHint(rawHint);
  if (!dateHint) return true;
  const appointmentDate = DateTime.fromISO(appointment.startAt).setZone(TZ).toISODate();
  return appointmentDate === dateHint;
}

export class ApptCancelDialog extends ComponentDialog {
  static Id = ID;

  constructor() {
    super(ID);
    this.addDialog(new TextPrompt(TEXT));
    this.addDialog(new WaterfallDialog(WF, [
      this.resolvePatient.bind(this),
      this.selectAppointment.bind(this),
      this.confirmCancellation.bind(this),
      this.cancel.bind(this)
    ]));
    this.initialDialogId = WF;
  }

  async resolvePatient(step) {
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
    const appointments = await javaApi.getActiveFutureAppointmentsByPatient(step.values.patient.id);
    if (!appointments?.length) {
      await step.context.sendActivity('No tienes citas activas futuras para cancelar.');
      return await step.endDialog();
    }

    const entities = step.options?.clu?.entities || [];
    const rawText = step.options?.rawText || '';
    const dentistHint = pick(entities, 'dentistName') || extractDentistHint(rawText);
    const dateHint = pick(entities, 'datetime') || rawText;
    const filtered = appointments.filter((item) => matchDentistHint(item, dentistHint) && matchDateHint(item, dateHint));

    step.values.appointments = filtered.length ? filtered : appointments;

    if (filtered.length === 1) {
      step.values.selectedAppointment = filtered[0];
      return await step.next();
    }

    if (appointments.length === 1) {
      step.values.selectedAppointment = appointments[0];
      return await step.next();
    }

    const intro = filtered.length === 0 && (dentistHint || parseDateHint(dateHint))
      ? 'No encontré una única cita que coincida con tu mensaje. Estas son tus citas activas futuras:'
      : 'Estas son tus citas activas futuras:';

    await step.context.sendActivity(`${intro}\n${step.values.appointments.map(formatAppointment).join('\n')}`);
    return await step.prompt(TEXT, 'Responde con el número de la cita que deseas cancelar.');
  }

  async confirmCancellation(step) {
    if (!step.values.selectedAppointment) {
      const appointments = step.values.appointments || [];
      const raw = (step.result || '').toString().trim();
      const answer = yesNo(raw);

      if (answer === false || maybeExitFlow(raw)) {
        await step.context.sendActivity('Entendido. No cancelaré ninguna cita.');
        return await step.endDialog();
      }

      const index = Number(raw);
      if (!Number.isInteger(index) || index < 1 || index > appointments.length) {
        await step.context.sendActivity('No pude identificar esa opción.');
        return await step.endDialog();
      }

      step.values.selectedAppointment = appointments[index - 1];
    }

    await step.context.sendActivity(`Vas a cancelar esta cita:\n${detail(step.values.selectedAppointment)}`);
    return await step.prompt(TEXT, '¿Confirmas la cancelación? (sí/no)');
  }

  async cancel(step) {
    const answer = yesNo(step.result);
    if (answer !== true) {
      await step.context.sendActivity('Entendido. La cita no fue cancelada.');
      return await step.endDialog();
    }

    try {
      const cancelled = await javaApi.cancelAppointment(step.values.selectedAppointment.id, {
        cancelledByType: 'PATIENT',
        cancelledByPatientId: step.values.patient.id,
        cancellationReason: 'Cancelado desde WhatsApp'
      });
      await step.context.sendActivity(`✅ Cita cancelada con éxito.\n• ID: ${cancelled.id}\n• Fecha: ${formatLocal(cancelled.startAt)}`);
    } catch (e) {
      if (e?.response?.status === 400) {
        await step.context.sendActivity('No pude cancelar esa cita porque no pertenece al paciente identificado.');
      } else {
        await step.context.sendActivity('No pude cancelar la cita en este momento.');
      }
    }
    return await step.endDialog();
  }
}
