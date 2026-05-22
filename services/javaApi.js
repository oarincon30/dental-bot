import axios from 'axios';

const BASE = (process.env.BACKEND_BASEURL || 'http://localhost:8080').replace(/\/+$/, '');
const client = axios.create({ baseURL: BASE, timeout: 8000 });

client.interceptors.request.use(cfg => {
  const token = process.env.BACKEND_BEARER;
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

const PATHS = {
  patients: '/api/patients',
  dentists: '/api/dentists',
  appointments: '/api/appointments'
};

export const javaApi = {
  async getPatientByWhatsapp(whatsappPhone) {
    const { data } = await client.get(`${PATHS.patients}/by-whatsapp/${encodeURIComponent(whatsappPhone)}`);
    return data;
  },

  async searchPatients(q, page = 0, size = 5) {
    const { data } = await client.get(PATHS.patients, { params: { q, page, size } });
    return data;
  },

  async searchDentists(q, page = 0, size = 10) {
    const { data } = await client.get(PATHS.dentists, { params: { q, page, size, sort: 'fullName,asc' } });
    return data;
  },

  async getActiveFutureAppointmentsByPatient(patientId) {
    const { data } = await client.get(`${PATHS.patients}/${patientId}/appointments/active-future`);
    return data;
  },

  async createAppointment({ patientId, dentistId, startAt, endAt, reason }) {
    const body = { patientId, startAt, endAt, reason };
    if (dentistId != null) body.dentistId = dentistId;
    const { data } = await client.post(PATHS.appointments, body);
    return data;
  },

  async getAppointment(id) {
    const { data } = await client.get(`${PATHS.appointments}/${id}`);
    return data;
  },

  async searchAppointments({ patientId, dentistId, status, from, to, page = 0, size = 10, sort = 'startAt,asc' }) {
    const params = { patientId, dentistId, status, from, to, page, size, sort };
    Object.keys(params).forEach(k => params[k] == null && delete params[k]);
    const { data } = await client.get(PATHS.appointments, { params });
    return data;
  },

  async cancelAppointment(id, payload) {
    const { data } = await client.patch(`${PATHS.appointments}/${id}/cancel`, payload || {});
    return data;
  },

  async rescheduleAppointment(id, payload) {
    const { data } = await client.patch(`${PATHS.appointments}/${id}/reschedule`, payload || {});
    return data;
  }
};
