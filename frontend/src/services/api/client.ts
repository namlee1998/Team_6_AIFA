import axios from 'axios';

export const getBaseURL = () => {
  // Production: use env variable
  // Development: use relative path (proxied by Vite)
  return import.meta.env.VITE_API_URL || '/api/v1';
};

const api = axios.create({
  baseURL: getBaseURL(),
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(async (config) => {
  // Let the browser set multipart/form-data with its generated boundary.
  // Keeping the instance's default application/json header makes multer see
  // an empty request even though FormData contains files.
  if (config.data instanceof FormData) {
    config.headers.delete('Content-Type');
  }

  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    const message = error.response?.data?.message ?? error.message ?? 'Unknown error';
    console.error('[API Error]', message, error.response?.status);

    return Promise.reject(error);
  },
);

export default api;
