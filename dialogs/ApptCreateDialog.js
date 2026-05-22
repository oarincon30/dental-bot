import { ComponentDialog, WaterfallDialog, TextPrompt } from 'botbuilder-dialogs';
import { DateTime } from 'luxon';
import { javaApi } from '../services/javaApi.js';
import { parseNaturalDateTime, toISO, clampToSlots, isWithinWorkingHours, isMultipleOf30 } from '../utils/datetime.js';
import { pick } from '../utils/clu.js';
import { recognizeCLU } from '../recognizers/cluRecognizer.js';
import { getWhatsappFromStep } from '../utils/whatsapp.js';
import { extractDentistHint, isAffirmative, isNegative, maybeExitFlow, normalizeLoose, normalizePersonName } from '../utils/text.js';

const ID = 'APPT_CREATE';
const WF = 'WF';
const TEXT = 'TEXT';
const TZ = process.env.TZ || 'America/Bogota';

function formatDentist(dentist) {
  if (!dentist) return 'sin profesional específico';
  return `${dentist.fullName}${dentist.specialty ? ` (${dentist.specialty})` : ''}`;
}

function formatAppointmentLocal(startAt) {
  return DateTime.fromISO(startAt).setZone(TZ).setLocale('es').toFormat("cccc d 'de' LLLL 'de' yyyy, HH:mm");
}

function listOptions(items) {
  return items.map((item, index) => `${index + 1}. ${formatDentist(item)}`).join('\n');
}

async function resolveDentistByText(rawText) {
  const q = normalizePersonName(rawText);
  if (!q) return { type: 'empty' };

  const queries = Array.from(new Set([q, q.split(' ')[0]].filter(Boolean)));
  let matches = [];
  for (const query of queries) {
    const page = await javaApi.searchDentists(query, 0, 10);
    const items = page?.content || [];
    for (const item of items) {
      if (!matches.some((x) => x.id === item.id)) matches.push(item);
    }
  }
  if (!matches.length) return { type: 'not_found' };

  const exact = matches.filter((dentist) => normalizePersonName(dentist.fullName) === q);
  if (exact.length === 1) return { type: 'resolved', dentist: exact[0] };
  if (exact.length > 1) return { type: 'ambiguous', candidates: exact };

  const partial = matches.filter((dentist) => {
    const full = normalizePersonName(dentist.fullName);
    const specialty = normalizeLoose(dentist.specialty || '');
    return full.includes(q) || q.includes(full) || specialty.includes(q);
  });
  if (partial.length === 1) return { type: 'resolved', dentist: partial[0] };
  if (partial.length > 1) return { type: 'ambiguous', candidates: partial };

  return { type: 'not_found' };
}

export class ApptCreateDialog extends ComponentDialog {
  static Id = ID;

  constructor() {
    super(ID);
    this.addDialog(new TextPrompt(TEXT));
    this.addDialog(new WaterfallDialog(WF, [
      this.resolvePatient.bind(this),
      this.ensureDentist.bind(this),
      this.ensureDatetime.bind(this),
      this.confirm.bind(this),
      this.create.bind(this)
    ]));
    this.initialDialogId = WF;
  }

  async resolvePatient(step) {
    const carried = step.options?.state || {};
    if (carried.patient) {
      step.values.patient = carried.patient;
      step.values.dentist = carried.dentist || null;
      step.values.startAt = carried.startAt || null;
      step.values.endAt = carried.endAt || null;
      return await step.next();
    }

    const whatsappPhone = getWhatsappFromStep(step);
    if (!whatsappPhone) {
      await step.context.sendActivity('No pude leer tu número de WhatsApp para identificarte.');
      return await step.endDialog();
    }

    try {
      step.values.patient = await javaApi.getPatientByWhatsapp(whatsappPhone);
      step.values.whatsappPhone = whatsappPhone;
      return await step.next();
    } catch (error) {
      if (error?.response?.status === 404) {
        await step.context.sendActivity('No encontré tu registro con este número de WhatsApp. Para el prototipo, el paciente debe estar preregistrado.');
      } else {
        await step.context.sendActivity('No pude validar tu registro en este momento.');
      }
      return await step.endDialog();
    }
  }

  async ensureDentist(step) {
    if (step.values.dentist) return await step.next();

    const entities = step.options?.clu?.entities || [];
    const carriedRawDentist = step.options?.state?.rawDentist || null;
    const rawDentist = carriedRawDentist
      || pick(entities, 'dentistName')
      || extractDentistHint(step.options?.rawText)
      || pick(entities, 'specialtyText');

    if (!rawDentist) {
      return await step.prompt(TEXT, 'Claro. ¿Con qué doctor deseas la cita?');
    }

    const resolution = await this.safeResolveDentist(rawDentist);
    if (resolution.type === 'resolved') {
      step.values.dentist = resolution.dentist;
      return await step.next();
    }

    if (resolution.type === 'ambiguous') {
      step.values.pendingDentistChoices = resolution.candidates;
      return await step.prompt(TEXT, `Encontré varias coincidencias para "${rawDentist}".\n${listOptions(resolution.candidates)}\nResponde con el número del profesional.`);
    }

    return await step.prompt(TEXT, `No encontré al doctor o especialista "${rawDentist}". Dime el nombre del profesional con quien deseas la cita.`);
  }

  async ensureDatetime(step) {
    if (!step.values.dentist) {
      const dentistResult = await this.consumeDentistResponse(step, step.result, step.values.pendingDentistChoices);
      if (dentistResult?.exit) {
        await step.context.sendActivity(dentistResult.message);
        return await step.endDialog();
      }
      if (!dentistResult.ok) {
        const retryState = {
          patient: step.values.patient,
          rawDentist: null,
          dentist: null,
          startAt: step.values.startAt,
          endAt: step.values.endAt
        };
        await step.context.sendActivity(dentistResult.message);
        return await step.replaceDialog(ID, { clu: step.options?.clu, state: retryState, rawText: step.result || step.options?.rawText || '' });
      }
      step.values.dentist = dentistResult.dentist;
      step.values.pendingDentistChoices = null;
    }

    const carriedStartAt = step.options?.state?.startAt;
    const carriedEndAt = step.options?.state?.endAt;
    if (carriedStartAt && carriedEndAt) {
      step.values.startAt = carriedStartAt;
      step.values.endAt = carriedEndAt;
      return await step.next();
    }

    const entities = step.options?.clu?.entities || [];
    const dtText = pick(entities, 'datetime') || step.options?.state?.rawDatetime || step.options?.rawText;
    if (dtText) {
      const parsed = this.parseAndValidateDateTime(dtText);
      if (parsed.ok) {
        step.values.startAt = parsed.startAt;
        step.values.endAt = parsed.endAt;
        return await step.next();
      }
    }

    return await step.prompt(TEXT, 'Perfecto. ¿Qué fecha y hora deseas? Ejemplos: "mañana 9:00", "abril 20 2 pm" o "2026/04/20 2pm".');
  }

  async confirm(step) {
    if (!step.values.startAt || !step.values.endAt) {
      if (maybeExitFlow(step.result)) {
        await step.context.sendActivity('Entendido. Cancelé la operación actual.');
        return await step.endDialog();
      }

      const cluTurn = await this.recognizeDateTurn(step, step.result);
      const dtText = pick(cluTurn.entities, 'datetime') || step.result;
      const parsed = this.parseAndValidateDateTime(dtText);
      if (!parsed.ok) {
        const retryState = {
          patient: step.values.patient,
          dentist: step.values.dentist,
          startAt: null,
          endAt: null,
          rawDatetime: null
        };
        await step.context.sendActivity(parsed.message);
        return await step.replaceDialog(ID, {
          rawText: step.result || '',
          clu: cluTurn,
          state: retryState
        });
      }
      step.values.startAt = parsed.startAt;
      step.values.endAt = parsed.endAt;
    }

    const summary = [
      'Voy a agendar esta cita:',
      `• Paciente: ${step.values.patient.fullName}`,
      `• Doctor: ${formatDentist(step.values.dentist)}`,
      `• Fecha y hora: ${formatAppointmentLocal(step.values.startAt)}`
    ].join('\n');

    await step.context.sendActivity(summary);
    return await step.prompt(TEXT, '¿Confirmas la creación de la cita? (sí/no)');
  }

  async create(step) {
    if (isNegative(step.result) || !isAffirmative(step.result)) {
      await step.context.sendActivity('Entendido. No se creó ninguna cita.');
      return await step.endDialog();
    }

    try {
      const created = await javaApi.createAppointment({
        patientId: step.values.patient.id,
        dentistId: step.values.dentist.id,
        startAt: step.values.startAt,
        endAt: step.values.endAt,
        reason: 'Agendado desde WhatsApp'
      });

      await step.context.sendActivity([
        '✅ Cita creada con éxito.',
        `• ID: ${created.id}`,
        `• Fecha y hora: ${formatAppointmentLocal(created.startAt)}`,
        `• Profesional: ${created.dentistName || formatDentist(step.values.dentist)}`
      ].join('\n'));
    } catch (error) {
      if (error?.response?.status === 409) {
        const retryState = {
          patient: step.values.patient,
          dentist: step.values.dentist,
          startAt: null,
          endAt: null,
          rawDatetime: null
        };
        const retryText = `Quiero una cita con ${step.values.dentist.fullName}`;
        const cluTurn = await this.recognizeDateTurn(step, retryText);
        await step.context.sendActivity(`Ese horario se cruza con otra cita activa. Dime otra fecha y hora con ${step.values.dentist.fullName}.`);
        return await step.replaceDialog(ID, { rawText: retryText, clu: cluTurn, state: retryState });
      }
      if (error?.response?.status === 404) {
        await step.context.sendActivity('No encontré el paciente o el profesional en el backend.');
      } else if (error?.response?.status === 400) {
        const msg = error?.response?.data?.message || error?.response?.data?.error || '';
        await step.context.sendActivity(msg ? `No pude crear la cita: ${msg}` : 'No pude crear la cita por una validación del backend.');
      } else {
        await step.context.sendActivity('Ocurrió un error al crear la cita.');
      }
    }
    return await step.endDialog();
  }

  parseAndValidateDateTime(text) {
    const parsed = parseNaturalDateTime(text);
    if (!parsed || !parsed.isValid) {
      return { ok: false, message: 'No entendí la fecha y hora. Usa un formato como "mañana 9:00", "abril 20 2 pm" o "2026-04-20 14:30".' };
    }

    const startLocal = clampToSlots(parsed);
    const endLocal = startLocal.plus({ minutes: 30 });
    if (!isMultipleOf30(startLocal, endLocal) || !isWithinWorkingHours(startLocal, endLocal)) {
      return { ok: false, message: 'La cita debe quedar en bloques de 30 minutos y dentro del horario de atención (7:00–11:00 y 13:00–17:00).' };
    }

    return { ok: true, startAt: toISO(startLocal), endAt: toISO(endLocal) };
  }

  async consumeDentistResponse(step, rawAnswer, pendingChoices) {
    const answer = (rawAnswer || '').toString().trim();
    if (!answer) return { ok: false, message: 'Necesito que me indiques con qué doctor deseas la cita.' };
    if (maybeExitFlow(answer)) return { ok: false, exit: true, message: 'Entendido. Cancelé la operación actual.' };

    if (pendingChoices?.length) {
      const index = Number(answer);
      if (Number.isInteger(index) && index >= 1 && index <= pendingChoices.length) {
        return { ok: true, dentist: pendingChoices[index - 1] };
      }

      const cluTurn = await this.recognizeDentistTurn(step, answer);
      const dentistText = pick(cluTurn.entities, 'dentistName') || pick(cluTurn.entities, 'specialtyText') || extractDentistHint(answer) || answer;
      const normalized = normalizePersonName(dentistText);
      const matches = pendingChoices.filter((item) => {
        const full = normalizePersonName(item.fullName);
        const specialty = normalizeLoose(item.specialty || '');
        return full.includes(normalized) || normalized.includes(full) || specialty.includes(normalized);
      });
      if (matches.length === 1) {
        return { ok: true, dentist: matches[0] };
      }

      return { ok: false, message: 'No pude identificar esa opción. Responde con el número del doctor o con el nombre más completo.' };
    }

    const cluTurn = await this.recognizeDentistTurn(step, answer);
    const dentistText = pick(cluTurn.entities, 'dentistName') || pick(cluTurn.entities, 'specialtyText') || extractDentistHint(answer) || answer;
    const resolution = await this.safeResolveDentist(dentistText);
    if (resolution.type === 'resolved') return { ok: true, dentist: resolution.dentist };
    if (resolution.type === 'ambiguous') {
      return { ok: false, message: `Encontré varias coincidencias para "${dentistText}". Intenta con el nombre más completo.` };
    }
    return { ok: false, message: `No encontré al doctor "${dentistText}". Intenta con otro nombre.` };
  }

  async recognizeTurn(step, text) {
    if (process.env.USE_CLU !== '1' || !text) {
      return { entities: [], topIntent: null, topScore: 0 };
    }

    try {
      return await recognizeCLU(text, step.context);
    } catch {
      return { entities: [], topIntent: null, topScore: 0 };
    }
  }

  async recognizeDentistTurn(step, userText) {
    const contextualText = `Quiero agendar una cita con ${userText}`;
    return await this.recognizeTurn(step, contextualText);
  }

  async recognizeDateTurn(step, userText) {
    const dentistName = step.values.dentist?.fullName || 'doctor';
    const contextualText = `Quiero agendar una cita con ${dentistName} ${userText}`;
    return await this.recognizeTurn(step, contextualText);
  }

  async safeResolveDentist(text) {
    try {
      const res = await resolveDentistByText(text);
      return res;
    } catch {
      return { type: 'not_found' };
    }
  }
}
