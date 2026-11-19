// TODO（并行开发中）：拣货
import { useNavigate } from 'react-router-dom';
import { Page, TopBar } from '../../ui/Shell.js';
export default function Pick() { const nav = useNavigate(); return <Page><TopBar title="拣货" onBack={() => nav('/m')} /><div className="empty">开发中…</div></Page>; }
