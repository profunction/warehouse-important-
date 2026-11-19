// TODO（并行开发中）：顾客呼叫
import { useNavigate } from 'react-router-dom';
import { Page, TopBar } from '../../ui/Shell.js';
export default function CustomerCall() { const nav = useNavigate(); return <Page><TopBar title="顾客呼叫" onBack={() => nav('/m')} /><div className="empty">开发中…</div></Page>; }
