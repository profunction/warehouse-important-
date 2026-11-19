// TODO（并行开发中）：盘点
import { useNavigate } from 'react-router-dom';
import { Page, TopBar } from '../../ui/Shell.js';
export default function Count() { const nav = useNavigate(); return <Page><TopBar title="盘点" onBack={() => nav('/m')} /><div className="empty">开发中…</div></Page>; }
