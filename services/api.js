// services/api.js
import axios from 'axios';

const client = axios.create({
  baseURL: process.env.BACKEND_BASEURL,
  timeout: 5000
});

client.interceptors.request.use(cfg => {
  if (process.env.BACKEND_BEARER) {
    cfg.headers.Authorization = `Bearer ${process.env.BACKEND_BEARER}`;
  }
  return cfg;
});

export const api = {
  async getAvailability(params) {
    const { data } = await client.get('/availability', { params });
    return data;
  },
  async createAppointment(body) {
    const { data } = await client.post('/appointments', body);
    return data;
  },
  async getAppointments(phone) {
    const { data } = await client.get('/appointments', { params: { phone, from: 'today' } });
    return data;
  },
  async cancelAppointment(id) {
    await client.delete(`/appointments/${id}`);
  }
};