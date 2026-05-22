import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { parseNaturalDateTime } from '../utils/datetime.js';
import { extractDentistHint, normalizePersonName } from '../utils/text.js';

const base = DateTime.fromISO('2026-04-29T08:00:00', { zone: 'America/Bogota' });
const currentAppointment = DateTime.fromISO('2026-05-04T14:00:00', { zone: 'America/Bogota' });

const schedule = parseNaturalDateTime('lunes 9:00', base);
assert.equal(schedule.toISODate(), '2026-05-04');
assert.equal(schedule.hour, 9);
assert.equal(schedule.minute, 0);

const friendlyAfternoon = parseNaturalDateTime('viernes a las 2', base);
assert.equal(friendlyAfternoon.toISODate(), '2026-05-01');
assert.equal(friendlyAfternoon.hour, 14);
assert.equal(friendlyAfternoon.minute, 0);

const friendlyMeridiem = parseNaturalDateTime('20 de mayo a las 3 de la tarde', base);
assert.equal(friendlyMeridiem.toISODate(), '2026-05-20');
assert.equal(friendlyMeridiem.hour, 15);
assert.equal(friendlyMeridiem.minute, 0);

const fixedDmy = parseNaturalDateTime('20/05/2026 3pm', base);
assert.equal(fixedDmy.toISODate(), '2026-05-20');
assert.equal(fixedDmy.hour, 15);
assert.equal(fixedDmy.minute, 0);

const missingHour = parseNaturalDateTime('lunes', base);
assert.equal(missingHour, null);

const moved = parseNaturalDateTime('viernes misma hora', base, currentAppointment);
assert.equal(moved.toISODate(), '2026-05-01');
assert.equal(moved.hour, 14);
assert.equal(moved.minute, 0);

assert.equal(normalizePersonName(extractDentistHint('necesito mover la cita con Juan para el viernes misma hora.')), 'juan');
assert.equal(normalizePersonName(extractDentistHint('ayudame con una cita para el lunes con el doc Miguel.')), 'miguel');


const tomorrowNine = parseNaturalDateTime('mañana a las 9', base);
assert.equal(tomorrowNine.toISODate(), '2026-04-30');
assert.equal(tomorrowNine.hour, 9);
assert.equal(tomorrowNine.minute, 0);

assert.equal(normalizePersonName(extractDentistHint('tengo cita con Camila Herrera mañana')), 'camila herrera');

console.log('Smoke tests OK');
