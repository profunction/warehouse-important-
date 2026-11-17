// 统一图标集（Lucide），不用 emoji，所有手机上长得一样
import { PackageOpen, Boxes, ShoppingCart, ClipboardList, Search, Truck, MapPin, Ticket, CheckCircle2, BarChart3, Settings, History, CreditCard, Undo2, Sigma, ShoppingBag, FileText, Users, CalendarDays, Receipt, Banknote, Lock, ScanLine, Keyboard, Flashlight, Package, LayoutGrid, Store, Warehouse, Mic, LogOut, HelpCircle, ArrowLeft, X, Check, AlertTriangle, Wifi, WifiOff, Camera, type LucideIcon } from 'lucide-react';
export const SCREEN_ICON: Record<string, LucideIcon> = {
  receive: PackageOpen, putaway: Boxes, refill: ShoppingCart, count: ClipboardList, lookup: Search, pick: Truck, assign_shelf: MapPin, tickets: Ticket,
  approvals: CheckCircle2, reports: BarChart3, settings: Settings, my_records: History, pos: CreditCard, returns: Undo2, close_day: Sigma,
  order_proposals: ShoppingBag, purchase_orders: FileText, suppliers: Truck, count_plan: CalendarDays, ar: Receipt, ap: FileText, payments: Banknote, month_end: Lock, users: Users,
};
export const I = { Scan: ScanLine, Keyboard, Torch: Flashlight, Product: Package, Shelf: LayoutGrid, Shop: Store, Warehouse, Mic, LogOut, Help: HelpCircle, Back: ArrowLeft, Close: X, Check, Warn: AlertTriangle, Wifi, WifiOff, Camera, Badge: CreditCard, Ticket, MapPin };
export function Icon({ name, size = 28, ...rest }: { name: LucideIcon; size?: number; className?: string; style?: any; strokeWidth?: number }) {
  const C = name; return <C size={size} strokeWidth={2.25} {...rest} />;
}
