// TODO（并行开发中）：我的代理
import { useNavigate } from 'react-router-dom';
import { Page, TopBar } from '../../ui/Shell.js';
export default function Delegation() { const nav = useNavigate(); return <Page><TopBar title="我的代理" onBack={() => nav('/m')} /><div className="empty">开发中…</div></Page>; }
