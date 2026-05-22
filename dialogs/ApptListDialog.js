import { ComponentDialog, WaterfallDialog, TextPrompt } from 'botbuilder-dialogs';
import { DateTime } from 'luxon';
import { javaApi } from '../services/javaApi.js';
import { getWhatsappFromStep } from '../utils/whatsapp.js';
import { pick } from '../utils/clu.js';
import { parseNaturalDateTime } from '../utils/datetime.js';
import { extractDentistHint, maybeExitFlow, normalizePersonName } from '../utils/text.js';

const ID = 'APPT_LIST';
const WF = 'WF';
const TEXT = 'TEXT';
const TZ = process.env.TZ || 'America/Bogota';

function formatAppointment(item, index) {
  const when = DateTime.fromISO(item.startAt).setZone(TZ).setLocale('es').toFormat("cccc d 'de' LLLL 'de' yyyy, HH:mm");
  return `${index + 1}. ${when} — ${item.dentistName || 'sin profesional específico'} — ${item.status}`;
}

function detail(item) {
  const start = DateTime.fromISO(item.startAt).setZone(TZ).setLocale('es').toFormat("cccc d 'de' LLLL 'de' yyyy, HH:mm");
  const end = DateTime.fromISO(item.endAt).setZone(TZ).toFormat('HH:mm');
  return [
    `• ID: ${item.id}`,
    `• Fecha: ${start} - ${end}`,
    `• Profesional: ${item.dentistName || 'sin profesional específico'}`,
    `• Estado: ${item.status}`,
    item.reason ? `• Motivo: ${item.reason}` : null
  ].filter(Boolean).join('\n');
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

  const matches = Array.from(raw.matchAll(/\b(?:de|del|para|el|la|con)\s+([^.,;?!]+)/gi));
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

export class ApptListDialog extends ComponentDialog {
  static Id = ID;

  constructor() {
    super(ID);
    this.addDialog(new TextPrompt(TEXT));
    this.addDialog(new WaterfallDialog(WF, [
      this.resolvePatient.bind(this),
      this.loadAppointments.bind(this),
      this.showSelection.bind(this)
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

  async loadAppointments(step) {
    const appointments = await javaApi.getActiveFutureAppointmentsByPatient(step.values.patient.id);
    if (!appointments?.length) {
      await step.context.sendActivity('No tienes citas activas futuras en este momento.');
      return await step.endDialog();
    }

    const entities = step.options?.clu?.entities || [];
    const rawText = step.options?.rawText || '';
    const dentistHint = pick(entities, 'dentistName') || extractDentistHint(rawText);
    const dateHint = pick(entities, 'datetime') || rawText;
    const filtered = appointments.filter((item) => matchDentistHint(item, dentistHint) && matchDateHint(item, dateHint));

    step.values.appointments = filtered.length ? filtered : appointments;

    if (filtered.length === 1) {
      await step.context.sendActivity(`Encontré esta cita según tu consulta:\n${detail(filtered[0])}`);
      return await step.endDialog();
    }

    if (appointments.length === 1) {
      await step.context.sendActivity(`Esta es tu próxima cita:\n${detail(appointments[0])}`);
      return await step.endDialog();
    }

    const intro = filtered.length === 0 && (dentistHint || parseDateHint(dateHint))
      ? 'No encontré una cita activa que coincida exactamente con tu mensaje. Estas son tus citas activas futuras:'
      : 'Estas son tus citas activas futuras:';

    await step.context.sendActivity(`${intro}\n${step.values.appointments.map(formatAppointment).join('\n')}`);
    return await step.prompt(TEXT, 'Responde con el número de la cita que quieres consultar en detalle. También puedes escribir "salir".');
  }

  async showSelection(step) {
    const appointments = step.values.appointments || [];
    const raw = (step.result || '').toString().trim();
    if (maybeExitFlow(raw)) {
      await step.context.sendActivity('Entendido. Cerré la consulta de citas.');
      return await step.endDialog();
    }

    const index = Number(raw);
    if (!Number.isInteger(index) || index < 1 || index > appointments.length) {
      await step.context.sendActivity('No pude identificar esa opción.');
      return await step.endDialog();
    }

    const selected = appointments[index - 1];
    await step.context.sendActivity(`Detalle de la cita seleccionada:\n${detail(selected)}`);
    return await step.endDialog();
  }
}
