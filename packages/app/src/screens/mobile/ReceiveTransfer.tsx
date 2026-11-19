// TODO（并行开发中）：收调拨
import { useNavigate } from 'react-router-dom';
import { Page, TopBar } from '../../ui/Shell.js';
export default function ReceiveTransfer() { const nav = useNavigate(); return <Page><TopBar title="收调拨" onBack={() => nav('/m')} /><div className="empty">开发中…</div></Page>; }
