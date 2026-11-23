import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { api } from './helpers.js';
import { closePools, adminPool } from '../src/lib/db.js';

const app = buildApp(); const A = () => api(app);
let code: string, boss: string, reqId: string;
const phone = '017' + String(Date.now()).slice(-7);
beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); await closePools(); });

describe('自助开店', () => {
  it('不用登录就能开店，自动给公司代码', async () => {
    const r = await A().post('/signup/company', { shop_name: 'Kedai Ah Seng', boss_name: '阿成', phone, pin: '246810', plan: 'A' });
    expect(r.statusCode).toBe(201); code = r.json().company_code; expect(code).toMatch(/^KEDA\d{3}$/);
  });
  it('马上能用手机号和 PIN 登录，是老板，有模板数据', async () => {
    const r = await A().post('/auth/login', { company_code: code, phone, pin: '246810' }); expect(r.statusCode).toBe(200); boss = r.json().access_token;
    const me = (await A().get('/me', boss)).json(); expect(me.roles).toContain('BOSS'); expect(me.company.plan).toBe('A');
    expect((await A().get('/categories', boss)).json().length).toBeGreaterThan(5);
  });
  it('中文店名也能开（代码 SHOP + 数字）；PIN 不对格式 400', async () => {
    const r = await A().post('/signup/company', { shop_name: '好运杂货店', boss_name: '老王', phone: '0171234567', pin: '135790', plan: 'B' });
    expect(r.statusCode).toBe(201); expect(r.json().company_code).toMatch(/^SHOP\d{4}$/);
    expect((await A().post('/signup/company', { shop_name: '错店', boss_name: 'x', phone: '0170000000', pin: '12' })).statusCode).toBe(400);
  });
  it('SIGNUP_MODE=off 时关闭', async () => {
    process.env.SIGNUP_MODE = 'off';
    expect((await A().post('/signup/company', { shop_name: 'Closed', boss_name: 'x', phone: '0170000001', pin: '111111' })).statusCode).toBe(403);
    expect((await A().get('/signup/config')).json().open).toBe(false);
    delete process.env.SIGNUP_MODE;
  });
});

describe('员工申请加入', () => {
  it('查公司代码只回店名和可申请岗位', async () => {
    const r = await A().get(`/signup/company/${code}`); expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ name: 'Kedai Ah Seng', roles: ['WAREHOUSE', 'CASHIER'] });
    expect((await A().get('/signup/company/NOPE999')).statusCode).toBe(404);
  });
  it('申请老板岗位不行；申请收银员成功，老板收到通知', async () => {
    expect((await A().post('/signup/join', { company_code: code, name: '小美', phone: '0181112222', pin: '112233', role_code: 'BOSS' })).statusCode).toBe(400);
    const r = await A().post('/signup/join', { company_code: code.toLowerCase(), name: '小美', phone: '018-111 2222', pin: '112233', role_code: 'CASHIER', note: '周末班' });
    expect(r.statusCode).toBe(201); reqId = r.json().id;
    const n = (await adminPool.query(`SELECT text FROM notification n JOIN company c ON c.id = n.company_id WHERE c.short_code = $1 AND n.type = 'STAFF_JOIN'`, [code])).rows; expect(n[0].text).toContain('小美');
  });
  it('同一手机重复申请 409；批准前不能登录', async () => {
    expect((await A().post('/signup/join', { company_code: code, name: '小美', phone: '0181112222', pin: '112233', role_code: 'CASHIER' })).statusCode).toBe(409);
    expect((await A().post('/auth/login', { company_code: code, phone: '0181112222', pin: '112233' })).statusCode).toBe(401);
    expect((await A().get(`/signup/join/status?company_code=${code}&phone=0181112222`)).json().status).toBe('PENDING');
  });
  it('老板看到申请并批准（可改岗位）→ 员工用自己的 PIN 登录', async () => {
    const list = (await A().get('/join-requests', boss)).json(); expect(list.map((x: any) => x.id)).toContain(reqId);
    const r = await A().post(`/join-requests/${reqId}/approve`, { role_code: 'WAREHOUSE' }, boss); expect(r.statusCode).toBe(200);
    const l = await A().post('/auth/login', { company_code: code, phone: '0181112222', pin: '112233' }); expect(l.statusCode).toBe(200);
    expect((await A().get('/me', l.json().access_token)).json().roles).toEqual(['WAREHOUSE']);
    expect((await A().get(`/signup/join/status?company_code=${code}&phone=0181112222`)).json().status).toBe('APPROVED');
    expect((await A().post(`/join-requests/${reqId}/approve`, {}, boss)).statusCode).toBe(409);
  });
  it('拒绝；员工不能批', async () => {
    const r = (await A().post('/signup/join', { company_code: code, name: '阿强', phone: '0183334444', pin: '445566', role_code: 'WAREHOUSE' })).json();
    const staff = (await A().post('/auth/login', { company_code: code, phone: '0181112222', pin: '112233' })).json().access_token;
    expect((await A().post(`/join-requests/${r.id}/approve`, {}, staff)).statusCode).toBe(403);
    expect((await A().post(`/join-requests/${r.id}/reject`, { note: '不缺人' }, boss)).statusCode).toBe(200);
    expect((await A().get(`/signup/join/status?company_code=${code}&phone=0183334444`)).json().status).toBe('REJECTED');
  });
});
