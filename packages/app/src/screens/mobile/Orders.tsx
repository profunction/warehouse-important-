// TODO（并行开发中）：订货
import { useNavigate } from 'react-router-dom';
import { Page, TopBar } from '../../ui/Shell.js';
export default function Orders() { const nav = useNavigate(); return <Page><TopBar title="订货" onBack={() => nav('/m')} /><div className="empty">开发中…</div></Page>; }
