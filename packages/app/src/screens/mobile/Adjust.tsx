// TODO（并行开发中）：手动调整
import { useNavigate } from 'react-router-dom';
import { Page, TopBar } from '../../ui/Shell.js';
export default function Adjust() { const nav = useNavigate(); return <Page><TopBar title="手动调整" onBack={() => nav('/m')} /><div className="empty">开发中…</div></Page>; }
