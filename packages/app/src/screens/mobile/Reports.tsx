// TODO（并行开发中）：报表
import { useNavigate } from 'react-router-dom';
import { Page, TopBar } from '../../ui/Shell.js';
export default function Reports() { const nav = useNavigate(); return <Page><TopBar title="报表" onBack={() => nav('/m')} /><div className="empty">开发中…</div></Page>; }
