import type { FastifyInstance } from 'fastify';
export function api(app: FastifyInstance, token?: string, extraHeaders: Record<string, string> = {}) {
  const h = (t?: string) => ({ ...(t ? { authorization: `Bearer ${t}` } : {}), ...extraHeaders });
  const dbg = async (p: Promise<any>, label: string) => { const r = await p; if (process.env.DEBUG_API && r.statusCode >= 400) console.error('API', label, r.statusCode, r.body?.slice(0, 400)); return r; };
  return {
    get: (url: string, t = token) => dbg(app.inject({ method: 'GET', url: '/api/v1' + url, headers: h(t) }), 'GET ' + url),
    post: (url: string, body?: any, t = token) => dbg(app.inject({ method: 'POST', url: '/api/v1' + url, headers: body ? { ...h(t), 'content-type': 'application/json' } : h(t), payload: body ? JSON.stringify(body) : undefined }), 'POST ' + url),
    put: (url: string, body?: any, t = token) => dbg(app.inject({ method: 'PUT', url: '/api/v1' + url, headers: { ...h(t), 'content-type': 'application/json' }, payload: JSON.stringify(body ?? {}) }), 'PUT ' + url),
    del: (url: string, t = token) => app.inject({ method: 'DELETE', url: '/api/v1' + url, headers: h(t) }),
    upload: (url: string, filename: string, buf: Buffer, fields: Record<string, string> = {}, t = token) => {
      const boundary = '----wh' + Date.now();
      const parts: Buffer[] = [];
      for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`), buf, Buffer.from(`\r\n--${boundary}--\r\n`));
      return app.inject({ method: 'POST', url: '/api/v1' + url, headers: { ...h(t), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat(parts) });
    },
  };
}
