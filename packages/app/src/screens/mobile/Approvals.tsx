// TODO（并行开发中）：审批
import { useNavigate } from 'react-router-dom';
import { Page, TopBar } from '../../ui/Shell.js';
export default function Approvals() { const nav = useNavigate(); return <Page><TopBar title="审批" onBack={() => nav('/m')} /><div className="empty">开发中…</div></Page>; }
