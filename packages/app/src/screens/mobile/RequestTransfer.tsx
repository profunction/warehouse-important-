// TODO（并行开发中）：申请调拨
import { useNavigate } from 'react-router-dom';
import { Page, TopBar } from '../../ui/Shell.js';
export default function RequestTransfer() { const nav = useNavigate(); return <Page><TopBar title="申请调拨" onBack={() => nav('/m')} /><div className="empty">开发中…</div></Page>; }
