// TODO（并行开发中）：我的记录
import { useNavigate } from 'react-router-dom';
import { Page, TopBar } from '../../ui/Shell.js';
export default function MyRecords() { const nav = useNavigate(); return <Page><TopBar title="我的记录" onBack={() => nav('/m')} /><div className="empty">开发中…</div></Page>; }
