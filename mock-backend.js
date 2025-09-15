// mock-backend.js (ESM)
// Mock HTTP para el bot: /api/availability, /api/appointments, /api/appointments/:id
import express from 'express';
import cors from 'cors';
import { DateTime } from 'luxon';
import { v4 as uuid } from 'uuid';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.MOCK_PORT || 8080;
const ZONE = 'America/Bogota';

// --- Datos en memoria ---
let appointments = []; // { id, patient:{phone,name,idNumber}, service, startISO, endISO, branch }
const SERVICES = ['LIMPIEZA', 'VALORACION', 'ENDODONCIA', 'ORTODONCIA', 'URGENCIA'];
const BRANCHES = ['Galerías', 'Chapinero', 'Cedritos'];

// Seed: una cita para probar "consultar" y "cancelar"
seed();
function seed() {
  const base = DateTime.now().setZone(ZONE).plus({ days: 1 }).set({ hour: 9, minute: 0, second: 0 });
  appointments.push({
    id: 'A-1001',
    patient: { phone: '3004567890', name: 'Paciente Demo' },
    service: 'LIMPIEZA',
    startISO: base.toISO({ suppressMilliseconds: true }),
    endISO: base.plus({ hours: 1 }).toISO({ suppressMilliseconds: true }),
    branch: 'Galerías'
  });
}

// --- Helpers ---
function normalizeService(s) {
  if (!s) return null;
  const up = s.toString().trim().toUpperCase();
  if (up.includes('PROFILAXIS')) return 'LIMPIEZA';
  if (up.includes('REVISION') || up.includes('VALORACIÓN')) return 'VALORACION';
  if (SERVICES.includes(up)) return up;
  return up;
}
function parseHHMM(v) {
  if (!v) return null;
  const m = String(v).match(/^(\d{1,2})(?::?(\d{2}))?$/);
  if (!m) return null;
  const h = Math.max(0, Math.min(23, parseInt(m[1], 10)));
  const mm = m[2] ? parseInt(m[2], 10) : 0;
  return { h, m: mm };
}
function nextWorkingDay(dt) {
  let d = dt;
  if (d.weekday === 6) d = d.plus({ days: 2 });
  if (d.weekday === 7) d = d.plus({ days: 1 });
  return d;
}
function buildSlots({ from, to, service, branch }) {
  const now = DateTime.now().setZone(ZONE);
  let baseDay = nextWorkingDay(now.plus({ days: 1 })).startOf('day');

  const hf = parseHHMM(from);
  const ht = parseHHMM(to);

  let hours;
  if (hf && ht && (hf.h < ht.h || (hf.h === ht.h && hf.m < ht.m))) {
    const candidates = [];
    let cur = baseDay.set({ hour: hf.h, minute: hf.m, second: 0 });
    const end = baseDay.set({ hour: ht.h, minute: ht.m, second: 0 });
    while (cur.plus({ hours: 1 }) <= end && candidates.length < 5) {
      candidates.push(cur);
      cur = cur.plus({ minutes: 90 });
    }
    hours = candidates.slice(0, 3);
    if (!hours.length) hours = [baseDay.set({ hour: 9 }), baseDay.set({ hour: 11 }), baseDay.set({ hour: 15 })];
  } else {
    hours = [baseDay.set({ hour: 9 }), baseDay.set({ hour: 11 }), baseDay.set({ hour: 15 })];
  }

  return hours.map(h => ({
    start: h.toISO({ suppressMilliseconds: true }),
    end: h.plus({ hours: 1 }).toISO({ suppressMilliseconds: true }),
    providerId: `P-${Math.floor(100 + Math.random() * 900)}`,
    room: 'A1',
    branch: branch || BRANCHES[0],
    service: normalizeService(service) || 'LIMPIEZA'
  }));
}
function findAppt(id) {
  return appointments.find(a => a.id.toUpperCase() === id.toUpperCase());
}

// --- Rutas ---
app.get('/api/availability', (req, res) => {
  const { service, from, to, branch } = req.query;
  const slots = buildSlots({ from, to, service, branch });
  return res.json(slots);
});
app.post('/api/appointments', (req, res) => {
  const b = req.body || {};
  const phone = (b.patient?.phone || '').toString().replace(/\D/g, '').slice(-10);
  if (!phone || phone.length !== 10) return res.status(400).json({ error: 'patient.phone inválido' });
  if (!b.start) return res.status(400).json({ error: 'start requerido (ISO-8601)' });

  const start = DateTime.fromISO(b.start, { zone: ZONE });
  if (!start.isValid) return res.status(400).json({ error: 'start inválido' });

  const end = b.end ? DateTime.fromISO(b.end, { zone: ZONE }) : start.plus({ hours: 1 });
  const service = normalizeService(b.service) || 'LIMPIEZA';
  const branch = b.branch || BRANCHES[0];

  const duplicate = appointments.find(a =>
    a.patient.phone === phone &&
    a.startISO === start.toISO({ suppressMilliseconds: true }) &&
    a.service === service
  );
  const id = duplicate ? duplicate.id : `A-${1000 + appointments.length + 1}`;

  if (!duplicate) {
    appointments.push({
      id,
      patient: { phone, name: b.patient?.name || null, idNumber: b.patient?.idNumber || null },
      service,
      startISO: start.toISO({ suppressMilliseconds: true }),
      endISO: end.toISO({ suppressMilliseconds: true }),
      branch
    });
  }

  return res.status(201).json({
    appointmentId: id,
    summary: {
      start: start.toISO({ suppressMilliseconds: true }),
      end: end.toISO({ suppressMilliseconds: true }),
      service,
      branch
    }
  });
});
app.get('/api/appointments', (req, res) => {
  const phone = (req.query.phone || '').toString().replace(/\D/g, '').slice(-10);
  if (!phone) return res.status(400).json({ error: 'phone requerido' });

  const now = DateTime.now().setZone(ZONE);
  const list = appointments
    .filter(a => a.patient.phone === phone && DateTime.fromISO(a.startISO).diff(now).milliseconds >= -300000)
    .sort((a, b) => DateTime.fromISO(a.startISO) - DateTime.fromISO(b.startISO))
    .map(a => ({ appointmentId: a.id, start: a.startISO, end: a.endISO, service: a.service, branch: a.branch }));

  return res.json(list);
});
app.delete('/api/appointments/:id', (req, res) => {
  const found = findAppt(req.params.id);
  if (!found) return res.status(404).json({ error: 'No existe la cita' });
  appointments = appointments.filter(a => a.id !== found.id);
  return res.status(204).send();
});
app.get('/health', (_req, res) => res.send('ok'));

app.listen(PORT, () => {
  console.log(`Mock backend listening on http://localhost:${PORT}`);
  console.log('GET    /api/availability?service=&from=&to=&branch=');
  console.log('POST   /api/appointments');
  console.log('GET    /api/appointments?phone=');
  console.log('DELETE /api/appointments/:id');
});