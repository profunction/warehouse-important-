// TODO（并行开发中）：安排盘点
import { useNavigate } from 'react-router-dom';
import { Page, TopBar } from '../../ui/Shell.js';
export default function CountPlan() { const nav = useNavigate(); return <Page><TopBar title="安排盘点" onBack={() => nav('/m')} /><div className="empty">开发中…</div></Page>; }
